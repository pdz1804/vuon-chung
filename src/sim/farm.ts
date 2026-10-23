// Farm state and the actions players take on it. Pure: every action receives `now`,
// so the same code can later run against the shared Firestore world.
import { WATER_MS, isHydrated, isWilted, progress, qualityStars, stage, type CropTimes } from './growth';
import type { Animal } from './animals';
import { bothHandsToday, hadBothHands, markCare, tend, type FeedEvent, type Letter, type Memory } from './couple';
import { isUnlocked } from './progression';
import { activeRank, gainRoleXp, type PlayerState } from './roles';
import { SPECIES, sellPrice, type SpeciesId } from './species';
import { rainWaterings } from './weather';

export const SCHEMA_VERSION = 2;
const VN_OFFSET_MS = 7 * 3_600_000;

export interface Crop extends CropTimes {
  species: SpeciesId;
  /** Number of completed harvests (regrowing plants keep counting). */
  harvests: number;
  /** Vietnam day → uids who cared for it that day ("both hands" bonus). */
  care?: Record<string, string[]>;
}

export interface Plot {
  crop?: Crop;
}

export interface FarmState {
  schemaVersion: number;
  coins: number;
  xp: number;
  /** key "x,y" → tilled plot */
  plots: Record<string, Plot>;
  seeds: Partial<Record<SpeciesId, number>>;
  /** key "species:stars" → count */
  produce: Record<string, number>;
  /** Items in the shipping bin, paid out at the next Vietnam midnight. */
  bin: Record<string, number>;
  binDay: string | null;
  /** Village orders completed today (indices into ordersFor(day)). */
  /** `xp` freezes which crops today's board may ask for, so it can't reshuffle mid-day. */
  orders: { day: string; done: number[]; xp?: number };
  letters: Letter[];
  memories: Memory[];
  feed: FeedEvent[];
  animals: Animal[];
  /** Vietnam day the shared feeder was last filled. */
  feederDay: string;
  /** Today's duo order progress. */
  duo?: { day: string; by: string[]; xp: number };
  /** Per-player role and rank progress, keyed by uid. */
  players: Record<string, PlayerState>;
}

export type ActionResult =
  | { ok: true; msg: string; vars?: Record<string, string | number> }
  | { ok: false; msg: string; vars?: Record<string, string | number> };

export function newFarm(): FarmState {
  return {
    schemaVersion: SCHEMA_VERSION,
    coins: 50,
    xp: 0,
    plots: {},
    seeds: { rau_muong: 6, strawberry: 2 },
    produce: {},
    bin: {},
    binDay: null,
    orders: { day: '', done: [] },
    letters: [],
    memories: [],
    feed: [],
    animals: [],
    feederDay: '',
    players: {},
  };
}

/** Calendar day in Vietnam time, e.g. "2026-10-23". */
export function vnDay(ts: number): string {
  return new Date(ts + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export const key = (x: number, y: number) => `${x},${y}`;

function growMsFor(crop: Crop): number {
  const sp = SPECIES[crop.species];
  return crop.harvests > 0 && sp.regrowMs ? sp.regrowMs : sp.growMs;
}

/** The crop's watering history including the mornings it rained. */
export function withRain(crop: Crop, now: number): CropTimes {
  return { plantedAt: crop.plantedAt, waterings: [...crop.waterings, ...rainWaterings(crop.plantedAt, now)] };
}

export function cropStage(crop: Crop, now: number) {
  return stage(withRain(crop, now), growMsFor(crop), now);
}

export function cropWilted(crop: Crop, now: number) {
  return cropStage(crop, now) < 4 && isWilted(withRain(crop, now), now);
}

export type TileState = 'empty' | 'needs_water' | 'growing' | 'ready';

export function plotState(plot: Plot, now: number): TileState {
  if (!plot.crop) return 'empty';
  if (cropStage(plot.crop, now) === 4) return 'ready';
  return isHydrated(withRain(plot.crop, now), now) ? 'growing' : 'needs_water';
}

export function till(s: FarmState, x: number, y: number): ActionResult {
  const k = key(x, y);
  if (s.plots[k]) return { ok: false, msg: 'already_tilled' };
  s.plots[k] = {};
  return { ok: true, msg: 'tilled' };
}

export function plant(
  s: FarmState,
  x: number,
  y: number,
  species: SpeciesId,
  now: number,
  uid = 'local',
): ActionResult {
  const plot = s.plots[key(x, y)];
  if (!plot) return { ok: false, msg: 'not_tilled' };
  if (plot.crop) return { ok: false, msg: 'occupied' };
  if (!s.seeds[species]) return { ok: false, msg: 'no_seeds', vars: { species } };
  s.seeds[species] -= 1;
  plot.crop = { species, plantedAt: now, waterings: [], harvests: 0 };
  markCare(plot.crop, uid, now);
  return { ok: true, msg: 'planted', vars: { species } };
}

export function water(s: FarmState, x: number, y: number, now: number, uid = 'local'): ActionResult {
  const crop = s.plots[key(x, y)]?.crop;
  if (!crop) return { ok: false, msg: 'nothing_to_water' };
  if (isHydrated(withRain(crop, now), now)) return { ok: false, msg: 'already_wet' };
  crop.waterings.push(now);
  markCare(crop, uid, now);
  const rank = activeRank(s, uid, 'grower');
  if (rank >= 3) {
    const reach = rank >= 5 ? [-1, 0, 1] : [0];
    for (const dy of reach) {
      for (const dx of [-1, 0, 1]) {
        const near = s.plots[key(x + dx, y + dy)]?.crop;
        if (near && near !== crop && !isHydrated(withRain(near, now), now)) {
          near.waterings.push(now);
          markCare(near, uid, now);
        }
      }
    }
  }
  gainRoleXp(s, uid, 'grower', 1);
  return { ok: true, msg: bothHandsToday(crop, now) ? 'watered_both' : 'watered' };
}

export function harvest(s: FarmState, x: number, y: number, now: number, uid = 'local'): ActionResult {
  const plot = s.plots[key(x, y)];
  const crop = plot?.crop;
  if (!plot || !crop) return { ok: false, msg: 'nothing_here' };
  if (cropStage(crop, now) !== 4) return { ok: false, msg: 'not_ready' };
  const sp = SPECIES[crop.species];
  const role = sp.flower ? 'florist' : 'grower';
  const rank = activeRank(s, uid, role);
  // Florist r3: flowers come out one star better. Grower r4 / Florist r4: one extra item.
  const base = qualityStars(withRain(crop, now), growMsFor(crop), now, hadBothHands(crop));
  const stars = Math.min(3, base + (sp.flower && rank >= 3 ? 1 : 0)) as 1 | 2 | 3;
  // The rank-4 bonus item rewards care too: only on a 3★ harvest.
  const amount = sp.yield + (rank >= 4 && stars === 3 ? 1 : 0);
  const item = `${crop.species}:${stars}`;
  s.produce[item] = (s.produce[item] ?? 0) + amount;
  s.xp += sp.xp * stars;
  gainRoleXp(s, uid, role, sp.xp * stars);
  if (sp.regrowMs) {
    // Regrowing plant: restart its clock, keep any watering (or rain) still in effect.
    const wet = withRain(crop, now).waterings.filter((w) => w <= now && now < w + WATER_MS);
    crop.harvests += 1;
    crop.plantedAt = now;
    crop.waterings = wet;
    crop.care = {};
  } else {
    delete plot.crop;
  }
  return { ok: true, msg: 'harvested', vars: { species: crop.species, stars, n: amount } };
}

/** Moves all produce into the shipping bin. */
export function ship(s: FarmState, now: number): ActionResult {
  payout(s, now);
  const n = Object.values(s.produce).reduce((a, b) => a + b, 0);
  if (!n) return { ok: false, msg: 'nothing_to_ship' };
  for (const [item, c] of Object.entries(s.produce)) s.bin[item] = (s.bin[item] ?? 0) + c;
  s.produce = {};
  s.binDay = vnDay(now);
  return { ok: true, msg: 'shipped', vars: { n, value: binValue(s.bin) } };
}

export function binValue(bin: Record<string, number>): number {
  return Object.entries(bin).reduce((sum, [item, c]) => {
    const [id, stars] = item.split(':');
    return sum + sellPrice(id, Number(stars)) * c;
  }, 0);
}

/**
 * Pays the bin once the Vietnam day has changed. Idempotent: running it twice
 * (or from two devices) can't pay twice because the bin is emptied in the same step.
 */
export function payout(s: FarmState, now: number): number {
  if (!s.binDay || s.binDay === vnDay(now)) return 0;
  const value = binValue(s.bin);
  s.coins += value;
  s.bin = {};
  s.binDay = null;
  return value;
}

/** Seed price for this player: Grower r2 −10% on crops, Florist r2 −20% on flowers. */
export function seedPrice(s: FarmState, species: SpeciesId, uid = 'local'): number {
  const sp = SPECIES[species];
  const off = sp.flower ? (activeRank(s, uid, 'florist') >= 2 ? 0.2 : 0) : activeRank(s, uid, 'grower') >= 2 ? 0.1 : 0;
  return Math.max(1, Math.floor(sp.seedCost * (1 - off)));
}

export function buySeeds(s: FarmState, species: SpeciesId, count = 1, uid = 'local'): ActionResult {
  if (!speciesUnlocked(species, s.xp)) return { ok: false, msg: 'locked', vars: { species } };
  const cost = seedPrice(s, species, uid) * count;
  if (s.coins < cost) return { ok: false, msg: 'not_enough_coins' };
  s.coins -= cost;
  s.seeds[species] = (s.seeds[species] ?? 0) + count;
  return { ok: true, msg: 'bought', vars: { species, n: count } };
}

export function speciesUnlocked(id: SpeciesId, xp: number): boolean {
  const unlock = SPECIES[id].unlock;
  return !unlock || isUnlocked(unlock, xp);
}

/**
 * Upgrades an older save to the current schema. New fields get their defaults
 * (v1 → v2 adds `orders`). A save from a NEWER app version is kept as-is (see
 * isFromNewerApp) so this client never overwrites it with a downgraded copy;
 * only unrecognisable data starts a fresh farm.
 */
export function migrate(raw: unknown): FarmState {
  const s = raw as Partial<FarmState> | null;
  const v = s && typeof s === 'object' ? s.schemaVersion : undefined;
  if (typeof v !== 'number' || v < 1) return newFarm();
  return { ...newFarm(), ...s, schemaVersion: Math.max(v, SCHEMA_VERSION) };
}

/** True when the farm was written by a newer app: this client must not write it. */
export function isFromNewerApp(s: FarmState): boolean {
  return s.schemaVersion > SCHEMA_VERSION;
}

/**
 * The single "use" action on a field tile, decided on the state it runs against.
 * Running the decision inside the transaction means two players acting at once
 * can't both harvest the same plant or till the same tile twice.
 */
export function useTile(
  s: FarmState,
  x: number,
  y: number,
  selected: SpeciesId,
  now: number,
  uid = 'local',
): ActionResult {
  const plot = s.plots[key(x, y)];
  if (!plot) return till(s, x, y);
  const state = plotState(plot, now);
  if (state === 'empty') return plant(s, x, y, selected, now, uid);
  if (state === 'needs_water') return water(s, x, y, now, uid);
  if (state === 'ready') return harvest(s, x, y, now, uid);
  // Already watered (or rained on): tending still counts toward "both hands".
  const tended = tend(s, x, y, uid, now);
  if (tended) return tended;
  const crop = plot.crop!;
  return {
    ok: false,
    msg: 'growing',
    vars: { species: crop.species, pct: Math.floor(progress(withRain(crop, now), growMsFor(crop), now) * 100) },
  };
}
