// Fishing at the pond. The reaction game (cast, wait for the bite, reel in time) runs
// in the browser; only a successful catch reaches the shared farm through `landCatch`,
// which owns the daily limit, the deterministic reward roll and the together bonus.
import { vnDay, type ActionResult, type FarmState } from './farm';
import { isUnlocked } from './progression';

export const CATCHES_PER_DAY = 3;
/** XP for the garden, once a day, when both partners caught something that day. */
export const DUO_FISH_XP = 10;

export type FishId = 'junk' | 'perch' | 'carp' | 'koi';

/** Cumulative odds, then coins and XP per catch. */
const TABLE: Array<{ id: FishId; upTo: number; coins: number; xp: number }> = [
  { id: 'junk', upTo: 0.2, coins: 1, xp: 1 },
  { id: 'perch', upTo: 0.7, coins: 8, xp: 2 },
  { id: 'carp', upTo: 0.95, coins: 15, xp: 3 },
  { id: 'koi', upTo: 1, coins: 30, xp: 5 },
];

export interface FishingState {
  day: string;
  catches: Record<string, number>;
  duoPaid?: boolean;
}

/** Deterministic 0..1 roll from a string (FNV-1a), so a retried write rolls the same fish. */
function roll(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

export function fishFor(r: number): (typeof TABLE)[number] {
  return TABLE.find((f) => r < f.upTo) ?? TABLE[TABLE.length - 1];
}

function today(s: FarmState, now: number): FishingState {
  const day = vnDay(now);
  if (s.fishing?.day !== day) s.fishing = { day, catches: {} };
  return s.fishing;
}

/** Casts left today for `uid` (used to grey out the button before casting). */
export function castsLeft(s: FarmState, uid: string, now: number): number {
  const f = s.fishing?.day === vnDay(now) ? s.fishing : undefined;
  return CATCHES_PER_DAY - (f?.catches[uid] ?? 0);
}

/** Records one successful reel: picks the fish, pays coins and XP, maybe the duo bonus. */
export function landCatch(s: FarmState, uid: string, now: number): ActionResult {
  if (!isUnlocked('fishing', s.xp)) return { ok: false, msg: 'locked_fishing' };
  const f = today(s, now);
  const n = f.catches[uid] ?? 0;
  if (n >= CATCHES_PER_DAY) return { ok: false, msg: 'fish_tired' };
  const fish = fishFor(roll(`${uid}|${f.day}|${n}`));
  f.catches[uid] = n + 1;
  s.coins += fish.coins;
  s.xp += fish.xp;
  const anglers = Object.keys(f.catches).filter((k) => f.catches[k] > 0);
  if (!f.duoPaid && anglers.length >= 2) {
    f.duoPaid = true;
    s.xp += DUO_FISH_XP;
    return { ok: true, msg: 'fish_caught_duo', vars: { fish: fish.id, value: fish.coins, xp: DUO_FISH_XP } };
  }
  return { ok: true, msg: 'fish_caught', vars: { fish: fish.id, value: fish.coins } };
}
