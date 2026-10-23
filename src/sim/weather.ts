// Weather is a pure function of the Vietnam calendar date, so both partners'
// phones agree on rain without any server. Rain waters every crop at 06:00.
import { HOUR } from './growth';

const VN_OFFSET_MS = 7 * HOUR;
const DAY_MS = 24 * HOUR;

/**
 * FNV-1a hash with a murmur3 finalizer → [0, 1). Stable across devices and JS
 * engines; the finalizer spreads near-identical inputs ("…-23" vs "…-24").
 */
export function seeded(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

/** Southern Vietnam: rainy season May–November. */
export function rainChance(day: string): number {
  const month = Number(day.slice(5, 7));
  return month >= 5 && month <= 11 ? 0.35 : 0.12;
}

export function isRainDay(day: string): boolean {
  return seeded(`rain:${day}`) < rainChance(day);
}

/** isRainDay by day index (days since epoch, Vietnam time), memoised: drawn every second. */
const rainMemo = new Map<number, boolean>();
function rainOnDayIndex(i: number): boolean {
  let r = rainMemo.get(i);
  if (r === undefined) {
    r = isRainDay(dayString(i * DAY_MS - VN_OFFSET_MS));
    rainMemo.set(i, r);
  }
  return r;
}

/** Midnight (Vietnam) of the day containing ts, as a UTC timestamp. */
export function vnMidnight(ts: number): number {
  return Math.floor((ts + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
}

export function dayString(ts: number): string {
  return new Date(ts + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Rain starts at 06:00 and the shower lasts until 09:00 (for visuals). */
export const RAIN_START_H = 6;
export const RAIN_END_H = 9;

/**
 * Moments rain watered a crop between `from` and `to`: one per rain day, at
 * 06:00, or at planting time if it was planted during that morning's rain.
 */
export function rainWaterings(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = vnMidnight(from); d <= to; d += DAY_MS) {
    if (!rainOnDayIndex(Math.round((d + VN_OFFSET_MS) / DAY_MS))) continue;
    const start = d + RAIN_START_H * HOUR;
    const end = d + RAIN_END_H * HOUR;
    const t = from > start && from < end ? from : start;
    if (t >= from && t <= to) out.push(t);
  }
  return out;
}

/** Is it raining right now (for visuals and the HUD)? */
export function rainingAt(ts: number): boolean {
  const h = (ts - vnMidnight(ts)) / HOUR;
  return isRainDay(dayString(ts)) && h >= RAIN_START_H && h < RAIN_END_H;
}
