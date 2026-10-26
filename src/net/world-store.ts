// A WorldStore owns the farm state and applies actions to it. The local store
// keeps the solo/dev farm in localStorage; the shared store runs every action as
// a Firestore transaction on the world document so two players never clobber
// each other.
import {
  arrayUnion,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { now as clockNow, setClockOffset } from '../clock';
import { loadFarm, saveFarm } from '../save';
import { isFromNewerApp, migrate, newFarm, type ActionResult, type FarmState } from '../sim/farm';
import { FEED_WORTHY, logEvent } from '../sim/couple';
import { afterAction } from '../sim/milestones';
import { levelFor } from '../sim/progression';
import { db } from './firebase';

/** The single player of a solo farm. */
export const LOCAL_UID = 'local';

export type Look = 'phu' | 'su';
export interface Profile {
  name: string;
  look: Look;
}

/** Shape of a world document in Firestore. */
interface WorldDoc {
  members?: string[];
  profiles?: Record<string, Profile>;
  farm?: unknown;
}

/** An action runs on the freshest state with the acting player's uid. */
export type Action = (s: FarmState, now: number, uid: string) => ActionResult;

export interface WorldStore {
  readonly farm: FarmState;
  readonly worldId: string | null;
  readonly uid: string;
  readonly profiles: Record<string, Profile>;
  readonly members: string[];
  apply(action: Action): Promise<ActionResult>;
  onChange(cb: () => void): void;
  /** Saves now (local) — remote stores persist on every action. */
  flush(): void;
}

export class LocalStore implements WorldStore {
  farm: FarmState;
  readonly worldId = null;
  readonly uid = LOCAL_UID;
  readonly profiles: Record<string, Profile> = {};
  readonly members: string[] = [];
  readonly isNew: boolean;

  constructor() {
    const { farm, isNew } = loadFarm();
    this.farm = farm;
    this.isNew = isNew;
  }

  apply(action: Action) {
    const now = clockNow();
    const r = action(this.farm, now, LOCAL_UID);
    if (r.ok) {
      if (FEED_WORTHY.has(r.msg)) logEvent(this.farm, { t: now, uid: LOCAL_UID, msg: r.msg, vars: r.vars });
      afterAction(this.farm, r, LOCAL_UID, now);
      saveFarm(this.farm);
    }
    return Promise.resolve(r);
  }

  onChange() {
    /* only this tab changes a local farm */
  }

  flush() {
    saveFarm(this.farm);
  }
}

export class SharedStore implements WorldStore {
  farm: FarmState = newFarm();
  profiles: Record<string, Profile> = {};
  members: string[] = [];
  private listeners: Array<() => void> = [];

  private constructor(
    readonly worldId: string,
    readonly uid: string,
  ) {}

  /** Opens a world and resolves once its first snapshot arrived. */
  static open(worldId: string, uid: string): Promise<SharedStore> {
    const store = new SharedStore(worldId, uid);
    return new Promise((resolve, reject) => {
      let first = true;
      onSnapshot(
        doc(db, 'worlds', worldId),
        (snap) => {
          const d = snap.data() as WorldDoc | undefined;
          if (!d) return reject(new Error('world_missing'));
          store.farm = migrate(d.farm);
          store.profiles = d.profiles ?? {};
          store.members = d.members ?? [];
          if (first) {
            first = false;
            resolve(store);
          } else store.listeners.forEach((cb) => cb());
        },
        reject,
      );
    });
  }

  async apply(action: Action): Promise<ActionResult> {
    const ref = doc(db, 'worlds', this.worldId);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const farm = migrate((snap.data() as WorldDoc | undefined)?.farm);
      // Never write a farm saved by a newer version of the game: reload instead.
      if (isFromNewerApp(farm)) return { ok: false, msg: 'update_app' };
      const now = clockNow();
      const r = action(farm, now, this.uid);
      if (r.ok) {
        if (FEED_WORTHY.has(r.msg)) logEvent(farm, { t: now, uid: this.uid, msg: r.msg, vars: r.vars });
        afterAction(farm, r, this.uid, now);
        tx.update(ref, { farm, updatedAt: serverTimestamp() });
      }
      return r;
    });
  }

  onChange(cb: () => void) {
    this.listeners.push(cb);
  }

  flush() {
    /* every action is already persisted */
  }
}

/** Aligns the game clock with server time so both phones agree on growth. */
export async function syncServerClock(uid: string) {
  const ref = doc(db, 'users', uid);
  const before = Date.now();
  await setDoc(ref, { ping: serverTimestamp() }, { merge: true });
  const snap = await getDoc(ref);
  const ping = (snap.data() as { ping?: Timestamp } | undefined)?.ping;
  const server = ping?.toMillis();
  if (typeof server === 'number') setClockOffset(server - (before + Date.now()) / 2);
}

/** A room as shown in the lobby list. */
export interface RoomSummary {
  id: string;
  name: string;
  test: boolean;
  members: number;
  partner: string;
  level: number;
}

interface UserDoc {
  rooms?: string[];
  /** Pre-rooms single garden, still honoured. */
  worldId?: string;
  lastRoom?: string;
}

/** Every room this player belongs to, plus the one they played last. */
export async function myRooms(uid: string): Promise<{ rooms: string[]; lastRoom: string | null }> {
  const d = (await getDoc(doc(db, 'users', uid))).data() as UserDoc | undefined;
  const rooms = [...new Set([...(d?.rooms ?? []), ...(d?.worldId ? [d.worldId] : [])])];
  return { rooms, lastRoom: d?.lastRoom ?? d?.worldId ?? null };
}

export async function roomSummary(id: string, uid: string): Promise<RoomSummary | null> {
  try {
    const d = (await getDoc(doc(db, 'worlds', id))).data() as
      (WorldDoc & { name?: string; test?: boolean }) | undefined;
    if (!d) return null;
    const partner = (d.members ?? []).find((m) => m !== uid);
    const farm = migrate(d.farm);
    return {
      id,
      name: d.name ?? '',
      test: !!d.test,
      members: d.members?.length ?? 0,
      partner: partner ? (d.profiles?.[partner]?.name ?? '') : '',
      level: levelFor(farm.xp),
    };
  } catch {
    return null; // not a member any more, or offline
  }
}

export function rememberRoom(uid: string, id: string) {
  return setDoc(doc(db, 'users', uid), { lastRoom: id, rooms: arrayUnion(id) }, { merge: true });
}

export async function worldMemberCount(worldId: string): Promise<number> {
  const snap = await getDoc(doc(db, 'worlds', worldId));
  return (snap.data() as WorldDoc | undefined)?.members?.length ?? 0;
}

/** Creates a room for this player. A player may own or join any number of rooms. */
export async function createWorld(uid: string, profile: Profile, name = '', test = false): Promise<string> {
  const ref = doc(db, 'worlds', randomId(20));
  await setDoc(ref, {
    members: [uid],
    profiles: { [uid]: profile },
    farm: newFarm(),
    name: name.trim().slice(0, 30),
    test,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await rememberRoom(uid, ref.id);
  return ref.id;
}

const INVITE_TTL_MS = 7 * 24 * 3_600_000;

/** Mints a one-time 128-bit invite code for the partner. */
export async function createInvite(worldId: string, uid: string, partnerLook: Look): Promise<string> {
  const code = randomId(26);
  await setDoc(doc(db, 'invites', code), {
    worldId,
    createdBy: uid,
    partnerLook,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return code;
}

/** Joins a world with an invite code; the code is consumed in the same batch. */
export async function joinWithInvite(code: string, uid: string, name: string): Promise<string> {
  const inv = await getDoc(doc(db, 'invites', code));
  const worldId = inv.data()?.worldId as string | undefined;
  if (!worldId) throw new Error('invite_invalid');
  // The creator opening their own link would be refused by the rules anyway; say why.
  if (inv.data()?.createdBy === uid) throw new Error('invite_own');
  // The joiner can't read the world yet, so they take the look the creator didn't
  // pick from the invite's hint (stored on the invite by the creator).
  const look: Look = inv.data()?.partnerLook === 'phu' ? 'phu' : 'su';
  const batch = writeBatch(db);
  batch.update(doc(db, 'worlds', worldId), {
    members: arrayUnion(uid),
    [`profiles.${uid}`]: { name, look },
    joinCode: code,
  });
  batch.delete(doc(db, 'invites', code));
  batch.set(doc(db, 'users', uid), { rooms: arrayUnion(worldId), lastRoom: worldId }, { merge: true });
  await batch.commit();
  return worldId;
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/** Random id from a 32-symbol alphabet: 26 chars ≈ 130 bits. */
function randomId(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}
