// Push notifications for Vườn Chung, sent with Firebase Cloud Messaging.
//  - notifyPartner: when a garden's activity feed gains a letter, harvest or memory,
//    the other member's devices get a short notification (never the letter text).
//  - farmReminders: three times a day, one "ready to harvest" / "needs water" nudge.
// Bookkeeping lives in the server-only `push` collection: one log doc per sent event
// (so trigger retries never double-send) and one counter doc per person per day.
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import type { FeedEvent } from '../../src/sim/couple';
import { vnDay, type FarmState } from '../../src/sim/farm';
import {
  DAILY_LIMIT,
  eventKey,
  isQuietHour,
  newNotifyEvents,
  notificationText,
  reminderFor,
  type Lang,
} from '../../src/sim/notify';

const DATABASE = 'vuon-chung';
const REGION = 'asia-southeast1';
/** Only the newest few devices of a person are notified. */
const MAX_DEVICES = 3;
/** Someone seen in the game this recently doesn't need a reminder. */
const ACTIVE_MS = 5 * 60_000;

// Connect on first use, not at import: the deploy tool loads this file to read the
// function definitions and must not wait on a database connection.
let firestore: Firestore | undefined;
function database(): Firestore {
  if (!firestore) {
    initializeApp();
    firestore = getFirestore(DATABASE);
  }
  return firestore;
}

interface World {
  members: string[];
  profiles?: Record<string, { name?: string }>;
  test?: boolean;
  farm?: FarmState;
}

interface Device {
  token: string;
  lang?: Lang;
  enabled?: boolean;
  lastSeenAt?: number;
}

async function devicesOf(uid: string) {
  const snap = await database().collection(`users/${uid}/devices`).where('enabled', '==', true).get();
  return snap.docs
    .map((d) => ({ ref: d.ref, ...(d.data() as Device) }))
    .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
    .slice(0, MAX_DEVICES);
}

/**
 * Reserves one send for `uid` today: false when this exact notification was already
 * sent (`logId`) or the person's daily budget for this kind is used up.
 */
async function reserve(uid: string, logId: string, kind: string, now: number): Promise<boolean> {
  const day = vnDay(now);
  const logRef = database().doc(`push/log_${logId}`);
  const dayRef = database().doc(`push/day_${uid}_${day}`);
  return database().runTransaction(async (tx) => {
    const [log, counts] = await Promise.all([tx.get(logRef), tx.get(dayRef)]);
    if (log.exists) return false;
    const used = (counts.data()?.[kind] as number | undefined) ?? 0;
    if (used >= (DAILY_LIMIT[kind] ?? 1)) return false;
    // Logs and counters expire through a Firestore TTL policy on `expiresAt`.
    const expiresAt = new Date(now + 35 * 24 * 3_600_000);
    tx.set(logRef, { uid, kind, at: now, expiresAt });
    tx.set(dayRef, { [kind]: FieldValue.increment(1), expiresAt }, { merge: true });
    return true;
  });
}

/** Undoes a reservation when sending could not even start, so a retry sends it. */
async function release(uid: string, logId: string, kind: string, now: number) {
  await database().doc(`push/log_${logId}`).delete();
  await database()
    .doc(`push/day_${uid}_${vnDay(now)}`)
    .set({ [kind]: FieldValue.increment(-1) }, { merge: true });
}

/** Reserves, then sends; a failure before any device was tried releases the slot. */
async function deliver(uid: string, logId: string, kind: string, worldId: string, now: number, partnerName = '') {
  if (!(await reserve(uid, logId, kind, now))) return;
  try {
    await send(uid, kind, worldId, partnerName);
  } catch (e) {
    await release(uid, logId, kind, now);
    throw e;
  }
}

/** Sends to every enabled device and switches off tokens FCM no longer accepts. */
async function send(uid: string, kind: string, worldId: string, partnerName = '') {
  const devices = await devicesOf(uid);
  await Promise.all(
    devices.map(async (d) => {
      const { title, body } = notificationText(kind, d.lang ?? 'vi', partnerName);
      try {
        await getMessaging().send({
          token: d.token,
          // Data-only: the service worker shows it, so the copy and click target stay ours.
          data: { title, body, url: `/?world=${worldId}`, tag: `${worldId}-${kind}` },
          webpush: { headers: { Urgency: 'normal', TTL: String(6 * 3600) } },
        });
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
          await d.ref.update({ enabled: false });
        } else {
          logger.warn('push failed', { uid, code });
        }
      }
    }),
  );
}

export const notifyPartner = onDocumentUpdated(
  { document: 'worlds/{worldId}', database: DATABASE, region: REGION, retry: true, maxInstances: 1 },
  async (event) => {
    const before = event.data?.before.data() as World | undefined;
    const after = event.data?.after.data() as World | undefined;
    if (!before?.farm || !after || after.test) return;
    const fresh = newNotifyEvents(before.farm?.feed ?? [], after.farm?.feed ?? []);
    if (!fresh.length) return;
    const now = Date.now();
    if (isQuietHour(now)) return;
    const worldId = event.params.worldId;
    for (const e of fresh as FeedEvent[]) {
      const actorName = after.profiles?.[e.uid]?.name ?? '';
      for (const uid of after.members.filter((m) => m !== e.uid)) {
        await deliver(uid, `${worldId}_${eventKey(e)}_${uid}`, e.msg, worldId, now, actorName);
      }
    }
  },
);

export const farmReminders = onSchedule(
  { schedule: '0 8,14,19 * * *', timeZone: 'Asia/Ho_Chi_Minh', region: REGION, maxInstances: 1 },
  async () => {
    const now = Date.now();
    const day = vnDay(now);
    // Only gardens with two members; test rooms never send reminders.
    const worlds = await database().collection('worlds').get();
    for (const doc of worlds.docs) {
      const w = doc.data() as World;
      if (w.test || w.members.length < 2 || !w.farm) continue;
      try {
        const kind = reminderFor(w.farm, now);
        if (!kind) continue;
        for (const uid of w.members) {
          const recent = (await devicesOf(uid)).some((d) => now - (d.lastSeenAt ?? 0) < ACTIVE_MS);
          if (recent) continue;
          // One reminder a day: the 14:00 and 19:00 runs only send if the morning one had nothing to say.
          await deliver(uid, `${doc.id}_${uid}_${day}_reminder`, 'reminder', doc.id, now);
        }
      } catch (e) {
        logger.error('reminder failed for one garden', { world: doc.id, error: String(e) });
      }
    }
  },
);
