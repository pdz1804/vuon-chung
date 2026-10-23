// The couple layer: shared care ("both hands"), letters, memories and the
// activity feed. Pure functions on FarmState, so they run inside the same
// transactions as farming and work in solo mode too.
import { key, vnDay, type ActionResult, type Crop, type FarmState } from './farm';

export const LETTER_MAX = 500;
export const LETTERS_KEPT = 60;
export const MEMORY_TITLE_MAX = 80;
export const FEED_KEPT = 50;
export const MEMORY_XP = 15;
/** Keeps the shared world document well under Firestore's 1 MiB limit. */
export const MEMORIES_MAX = 400;

export interface Letter {
  id: string;
  from: string;
  text: string;
  t: number;
  read: boolean;
}

export interface Memory {
  id: string;
  /** Calendar date of the memory, YYYY-MM-DD. */
  date: string;
  title: string;
  by: string;
  t: number;
}

export interface FeedEvent {
  t: number;
  uid: string;
  msg: string;
  vars?: Record<string, string | number>;
}

/** Records that `uid` cared for a crop today. */
export function markCare(crop: Crop, uid: string, now: number) {
  const day = vnDay(now);
  const care = (crop.care ??= {});
  const who = (care[day] ??= []);
  if (!who.includes(uid)) who.push(uid);
}

/** Both partners cared for it on the same calendar day at least once. */
export function hadBothHands(crop: Crop): boolean {
  return Object.values(crop.care ?? {}).some((who) => new Set(who).size >= 2);
}

/** Both partners have cared for it today (drives the ✋✋ message). */
export function bothHandsToday(crop: Crop, now: number): boolean {
  return new Set(crop.care?.[vnDay(now)] ?? []).size >= 2;
}

/** Someone other than `uid` tended this crop today and `uid` hasn't yet. */
export function partnerTendedToday(crop: Crop, uid: string, now: number): boolean {
  const who = crop.care?.[vnDay(now)] ?? [];
  return who.length > 0 && !who.includes(uid);
}

/** Tending a growing crop that needs nothing: counts toward "both hands". */
export function tend(s: FarmState, x: number, y: number, uid: string, now: number): ActionResult | null {
  const crop = s.plots[key(x, y)]?.crop;
  if (!crop) return null;
  const who = crop.care?.[vnDay(now)] ?? [];
  if (who.includes(uid)) return null;
  markCare(crop, uid, now);
  return { ok: true, msg: bothHandsToday(crop, now) ? 'tended_both' : 'tended' };
}

/** A real calendar date in YYYY-MM-DD (rejects 2026-13-45). */
function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

function newId(now: number, salt: string) {
  return `${now.toString(36)}${salt.slice(0, 4)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function sendLetter(s: FarmState, uid: string, text: string, now: number): ActionResult {
  // Cut by code point so an emoji is never split in half.
  const body = Array.from(text.trim()).slice(0, LETTER_MAX).join('');
  if (!body) return { ok: false, msg: 'letter_empty' };
  s.letters = [{ id: newId(now, uid), from: uid, text: body, t: now, read: false }, ...s.letters].slice(
    0,
    LETTERS_KEPT,
  );
  return { ok: true, msg: 'letter_sent' };
}

/** Marks every letter addressed to `uid` (i.e. not written by them) as read. */
export function readLetters(s: FarmState, uid: string): ActionResult {
  let changed = false;
  for (const l of s.letters) {
    if (l.from !== uid && !l.read) {
      l.read = true;
      changed = true;
    }
  }
  return changed ? { ok: true, msg: 'letters_read' } : { ok: false, msg: 'letters_read' };
}

export function unreadFor(s: FarmState, uid: string): number {
  return s.letters.filter((l) => l.from !== uid && !l.read).length;
}

export function addMemory(s: FarmState, uid: string, date: string, title: string, now: number): ActionResult {
  const name = title.trim().slice(0, MEMORY_TITLE_MAX);
  if (!name) return { ok: false, msg: 'memory_empty' };
  if (!isRealDate(date)) return { ok: false, msg: 'memory_date' };
  if (s.memories.length >= MEMORIES_MAX) return { ok: false, msg: 'memory_full' };
  s.memories = [...s.memories, { id: newId(now, uid), date, title: name, by: uid, t: now }].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  s.xp += MEMORY_XP;
  return { ok: true, msg: 'memory_added', vars: { xp: MEMORY_XP } };
}

/** Memory Tree growth: 0 sapling … 4 full tree. */
export function treeStage(s: FarmState): 0 | 1 | 2 | 3 | 4 {
  const n = s.memories.length;
  return n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0;
}

/** Messages worth showing in the feed and the "while you were away" card. */
export const FEED_WORTHY = new Set([
  'harvested',
  'shipped',
  'order_filled',
  'bought',
  'letter_sent',
  'memory_added',
  'payout',
  'tended_both',
]);

export function logEvent(s: FarmState, e: FeedEvent) {
  s.feed = [e, ...s.feed].slice(0, FEED_KEPT);
}

/** Summary of what the partner did since `since`, grouped by message. */
export function awaySummary(s: FarmState, uid: string, since: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of s.feed) {
    if (e.t <= since || e.uid === uid) continue;
    out[e.msg] = (out[e.msg] ?? 0) + 1;
  }
  return out;
}
