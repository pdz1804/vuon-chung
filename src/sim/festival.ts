// Festivals: Tết and Mid-Autumn, three Vietnam days from the lunar holiday. Lunar dates
// don't map to a simple rule, so the dates are a small checked table; outside it, no
// festival runs. Each festival has a shared order: both partners hand in two items,
// and the garden is paid once when the second one does.
import { vnDay, type ActionResult, type FarmState } from './farm';
import { haveCount, take } from './orders';
import { isUnlocked } from './progression';
import type { SpeciesId } from './species';

export type FestivalKind = 'tet' | 'trung_thu';

/** First day of each festival (the lunar holiday itself), Vietnam calendar. */
const FESTIVALS: Array<{ id: string; kind: FestivalKind; start: string }> = [
  { id: 'tet-2026', kind: 'tet', start: '2026-02-17' },
  { id: 'trung_thu-2026', kind: 'trung_thu', start: '2026-09-25' },
  { id: 'tet-2027', kind: 'tet', start: '2027-02-06' },
  { id: 'trung_thu-2027', kind: 'trung_thu', start: '2027-09-15' },
];
const DAYS = 3;
const DAY_MS = 24 * 3_600_000;

export const FESTIVAL_ORDER: Record<FestivalKind, { species: SpeciesId; count: number; coins: number; xp: number }> = {
  tet: { species: 'rau_muong', count: 2, coins: 100, xp: 30 },
  trung_thu: { species: 'strawberry', count: 2, coins: 100, xp: 30 },
};

export interface FestivalState {
  id: string;
  by: string[];
}

/** The festival running on this Vietnam day, if any. */
export function festivalAt(now: number): { id: string; kind: FestivalKind } | null {
  const today = vnDay(now);
  for (const f of FESTIVALS) {
    const start = Date.parse(`${f.start}T00:00:00Z`);
    for (let d = 0; d < DAYS; d++) {
      if (new Date(start + d * DAY_MS).toISOString().slice(0, 10) === today) return { id: f.id, kind: f.kind };
    }
  }
  return null;
}

/** Who has handed in their part of the current festival order. */
export function festivalDelivered(s: FarmState, now: number): string[] {
  const f = festivalAt(now);
  return f && s.festival?.id === f.id ? s.festival.by : [];
}

export function deliverFestival(s: FarmState, uid: string, now: number): ActionResult {
  const f = festivalAt(now);
  if (!f) return { ok: false, msg: 'no_festival' };
  if (!isUnlocked('orders', s.xp)) return { ok: false, msg: 'locked_orders' };
  const order = FESTIVAL_ORDER[f.kind];
  const by = festivalDelivered(s, now);
  if (by.length >= 2) return { ok: false, msg: 'order_done' };
  if (by.includes(uid)) return { ok: false, msg: 'duo_waiting' };
  if (haveCount(s, order.species) < order.count) {
    return { ok: false, msg: 'order_missing', vars: { species: order.species, n: order.count } };
  }
  take(s, order.species, order.count);
  const next = [...by, uid];
  s.festival = { id: f.id, by: next };
  if (next.length < 2) return { ok: true, msg: 'festival_half' };
  s.coins += order.coins;
  s.xp += order.xp;
  return { ok: true, msg: 'festival_done', vars: { value: order.coins, xp: order.xp } };
}
