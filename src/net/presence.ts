// Live avatar positions over Realtime Database. Positions are written only when
// the farmer moves (max ~8/s) and removed automatically on disconnect.
import {
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  onValue,
  ref,
  remove,
  set,
} from 'firebase/database';
import { rtdb } from './firebase';

export interface Pose {
  x: number;
  y: number;
  /** Facing: d/u/l/r */
  f: 'd' | 'u' | 'l' | 'r';
  /** Moving or idle */
  m: boolean;
  t: number;
  /** Last emote and when it was sent (ms). */
  e?: string;
  et?: number;
}

const MIN_INTERVAL_MS = 125;

export class Presence {
  private last = 0;
  private lastKey = '';
  private trailing = 0;
  private readonly mine;

  constructor(
    private worldId: string,
    private uid: string,
    onPartner: (uid: string, pose: Pose | null) => void,
  ) {
    this.mine = ref(rtdb, `worlds/${worldId}/presence/${uid}`);
    // After every (re)connect: re-arm the server-side cleanup and force a fresh
    // publish, because the server already removed our node when the link dropped.
    onValue(ref(rtdb, '.info/connected'), (snap) => {
      if (snap.val() !== true) return;
      void onDisconnect(this.mine).remove();
      this.lastKey = '';
    });
    const all = ref(rtdb, `worlds/${worldId}/presence`);
    const handle = (snap: { key: string | null; val(): Pose }) => {
      if (snap.key && snap.key !== this.uid) onPartner(snap.key, snap.val());
    };
    onChildAdded(all, handle);
    onChildChanged(all, handle);
    onChildRemoved(all, (snap) => snap.key && snap.key !== this.uid && onPartner(snap.key, null));
  }

  /** Throttled: sends only on change and at most every MIN_INTERVAL_MS. */
  private emote?: { e: string; et: number };

  /** Sends an emote with the next pose update (forced through the dedupe). */
  sendEmote(e: string) {
    this.emote = { e, et: Date.now() };
    this.lastKey = '';
  }

  publish(pose: Omit<Pose, 't'>) {
    const k = `${Math.round(pose.x)},${Math.round(pose.y)},${pose.f},${pose.m},${this.emote?.et ?? 0}`;
    const t = Date.now();
    if (k === this.lastKey) return;
    if (t - this.last < MIN_INTERVAL_MS) {
      // Trailing send so the final resting pose always arrives.
      clearTimeout(this.trailing);
      this.trailing = window.setTimeout(() => this.publish(pose), MIN_INTERVAL_MS);
      return;
    }
    clearTimeout(this.trailing);
    this.lastKey = k;
    this.last = t;
    void set(this.mine, { ...pose, ...this.emote, x: Math.round(pose.x), y: Math.round(pose.y), t });
  }

  leave() {
    void remove(this.mine);
  }

  get path() {
    return `worlds/${this.worldId}/presence/${this.uid}`;
  }
}
