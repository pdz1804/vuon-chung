// Farm state and the actions players take on it. Pure: every action receives `now`,
// so the same code can later run against the shared Firestore world.
import { WATER_MS, isHydrated, qualityStars, stage, type CropTimes } from './growth';
import { SPECIES, sellPrice, type SpeciesId } from './species';

export const SCHEMA_VERSION = 1;
const VN_OFFSET_MS = 7 * 3_600_000;

export interface Crop extends CropTimes {
  species: SpeciesId;
  /** Number of completed harvests (regrowing plants keep counting). */
  harvests: number;
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

export function cropStage(crop: Crop, now: number) {
  return stage(crop, growMsFor(crop), now);
}

export type TileState = 'empty' | 'needs_water' | 'growing' | 'ready';

export function plotState(plot: Plot, now: number): TileState {
  if (!plot.crop) return 'empty';
  if (cropStage(plot.crop, now) === 4) return 'ready';
  return isHydrated(plot.crop, now) ? 'growing' : 'needs_water';
}

export function till(s: FarmState, x: number, y: number): ActionResult {
  const k = key(x, y);
  if (s.plots[k]) return { ok: false, msg: 'already_tilled' };
  s.plots[k] = {};
  return { ok: true, msg: 'tilled' };
}

export function plant(s: FarmState, x: number, y: number, species: SpeciesId, now: number): ActionResult {
  const plot = s.plots[key(x, y)];
  if (!plot) return { ok: false, msg: 'not_tilled' };
  if (plot.crop) return { ok: false, msg: 'occupied' };
  if (!s.seeds[species]) return { ok: false, msg: 'no_seeds', vars: { species } };
  s.seeds[species]! -= 1;
  plot.crop = { species, plantedAt: now, waterings: [], harvests: 0 };
  return { ok: true, msg: 'planted', vars: { species } };
}

export function water(s: FarmState, x: number, y: number, now: number): ActionResult {
  const crop = s.plots[key(x, y)]?.crop;
  if (!crop) return { ok: false, msg: 'nothing_to_water' };
  if (isHydrated(crop, now)) return { ok: false, msg: 'already_wet' };
  crop.waterings.push(now);
  return { ok: true, msg: 'watered' };
}

export function harvest(s: FarmState, x: number, y: number, now: number): ActionResult {
  const plot = s.plots[key(x, y)];
  const crop = plot?.crop;
  if (!plot || !crop) return { ok: false, msg: 'nothing_here' };
  if (cropStage(crop, now) !== 4) return { ok: false, msg: 'not_ready' };
  const sp = SPECIES[crop.species];
  const stars = qualityStars(crop, growMsFor(crop), now);
  const item = `${crop.species}:${stars}`;
  s.produce[item] = (s.produce[item] ?? 0) + sp.yield;
  s.xp += sp.xp * stars;
  if (sp.regrowMs) {
    // Regrowing plant: restart its clock, keep any watering still in effect.
    crop.harvests += 1;
    crop.plantedAt = now;
    crop.waterings = crop.waterings.filter((w) => w <= now && now < w + WATER_MS);
  } else {
    delete plot.crop;
  }
  return { ok: true, msg: 'harvested', vars: { species: crop.species, stars, n: sp.yield } };
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
    return sum + sellPrice(id as SpeciesId, Number(stars)) * c;
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

export function buySeeds(s: FarmState, species: SpeciesId, count = 1): ActionResult {
  const cost = SPECIES[species].seedCost * count;
  if (s.coins < cost) return { ok: false, msg: 'not_enough_coins' };
  s.coins -= cost;
  s.seeds[species] = (s.seeds[species] ?? 0) + count;
  return { ok: true, msg: 'bought', vars: { species, n: count } };
}

/** Upgrades an older save to the current schema. */
export function migrate(raw: unknown): FarmState {
  const s = raw as Partial<FarmState> | null;
  if (!s || typeof s !== 'object' || s.schemaVersion !== SCHEMA_VERSION) return newFarm();
  return { ...newFarm(), ...s };
}
