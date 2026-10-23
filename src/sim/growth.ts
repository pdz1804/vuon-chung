// Pure growth rules. A plant only grows while hydrated; one watering hydrates it for 24 h.
// Everything is derived from timestamps on read, so no timer has to run while nobody plays.

export const HOUR = 3_600_000;
export const WATER_MS = 24 * HOUR;
/** Dry longer than this and the plant droops and loses its "well cared" star. */
export const WILT_MS = 24 * HOUR;

export interface CropTimes {
  plantedAt: number;
  /** Timestamps of each watering (or rain). */
  waterings: number[];
}

/** Merged hydrated intervals, clipped to [from, until]. */
function hydratedIntervals(from: number, waterings: number[], until: number): Array<[number, number]> {
  const raw = waterings
    .map((w): [number, number] => [Math.max(w, from), Math.min(w + WATER_MS, until)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  return merged;
}

export function hydratedMs(crop: CropTimes, now: number): number {
  return hydratedIntervals(crop.plantedAt, crop.waterings, now).reduce((s, [a, b]) => s + (b - a), 0);
}

export function isHydrated(crop: CropTimes, now: number): boolean {
  return crop.waterings.some((w) => w <= now && now < w + WATER_MS);
}

/** How long the plant has currently been dry (0 when hydrated). */
export function dryForMs(crop: CropTimes, now: number): number {
  if (isHydrated(crop, now)) return 0;
  const ends = crop.waterings.filter((w) => w <= now).map((w) => w + WATER_MS);
  const lastWet = ends.length ? Math.max(...ends) : crop.plantedAt;
  return Math.max(0, now - lastWet);
}

export function isWilted(crop: CropTimes, now: number): boolean {
  return dryForMs(crop, now) > WILT_MS;
}

/** Growth progress 0..1 given the hydrated time needed. */
export function progress(crop: CropTimes, growMs: number, now: number): number {
  return Math.min(1, hydratedMs(crop, now) / growMs);
}

/** 0 seed, 1 sprout, 2 young, 3 mature, 4 ready. */
export function stage(crop: CropTimes, growMs: number, now: number): 0 | 1 | 2 | 3 | 4 {
  const p = progress(crop, growMs, now);
  if (p >= 1) return 4;
  return Math.min(3, Math.floor(p * 4)) as 0 | 1 | 2 | 3;
}

/** The moment accumulated hydrated time reached growMs, or null if not yet. */
export function readyAt(crop: CropTimes, growMs: number, now: number): number | null {
  let acc = 0;
  for (const [a, b] of hydratedIntervals(crop.plantedAt, crop.waterings, now)) {
    if (acc + (b - a) >= growMs) return a + (growMs - acc);
    acc += b - a;
  }
  return null;
}

/** Longest dry gap between planting and `until` (used to judge care quality). */
export function longestDryGap(crop: CropTimes, until: number): number {
  const ivs = hydratedIntervals(crop.plantedAt, crop.waterings, until);
  let cursor = crop.plantedAt;
  let longest = 0;
  for (const [a, b] of ivs) {
    longest = Math.max(longest, a - cursor);
    cursor = b;
  }
  return Math.max(longest, until - cursor);
}

/**
 * Quality stars at harvest: 1 base, +1 if never dry longer than WILT_MS,
 * +1 if both partners cared for it on the same day (co-op, supplied by caller).
 */
export function qualityStars(crop: CropTimes, growMs: number, now: number, bothHands = false): 1 | 2 | 3 {
  // Dryness after the plant is ready doesn't hurt it: judge care only up to readiness.
  const until = Math.min(now, readyAt(crop, growMs, now) ?? now);
  let stars = 1;
  if (longestDryGap(crop, until) <= WILT_MS) stars++;
  if (bothHands) stars++;
  return stars as 1 | 2 | 3;
}
