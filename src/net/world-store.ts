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
import { db } from './firebase';

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

export type Action = (s: FarmState, now: number) => ActionResult;

export interface WorldStore {
  readonly farm: FarmState;
  readonly worldId: string | null;
  readonly uid: string | null;
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
  readonly uid = null;
  readonly profiles: Record<string, Profile> = {};
  readonly members: string[] = [];
  readonly isNew: boolean;

  constructor() {
    const { farm, isNew } = loadFarm();
    this.farm = farm;
    this.isNew = isNew;
  }

  apply(action: Action) {
    const r = action(this.farm, clockNow());
    if (r.ok) saveFarm(this.farm);
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
      const r = action(farm, clockNow());
      if (r.ok) tx.update(ref, { farm, updatedAt: serverTimestamp() });
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

export async function findMyWorld(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return (snap.data()?.worldId as string | undefined) ?? null;
}

export async function worldMemberCount(worldId: string): Promise<number> {
  const snap = await getDoc(doc(db, 'worlds', worldId));
  return (snap.data() as WorldDoc | undefined)?.members?.length ?? 0;
}

export async function createWorld(uid: string, profile: Profile): Promise<string> {
  const ref = doc(db, 'worlds', randomId(20));
  await setDoc(ref, {
    members: [uid],
    profiles: { [uid]: profile },
    farm: newFarm(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'users', uid), { worldId: ref.id }, { merge: true });
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
  batch.set(doc(db, 'users', uid), { worldId }, { merge: true });
  await batch.commit();
  return worldId;
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/** Random id from a 32-symbol alphabet: 26 chars ≈ 130 bits. */
function randomId(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}
