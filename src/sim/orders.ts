// Village orders: three a day, picked from the date so both partners see the
// same board. They pay 1.5× the shipping price and give the most XP.
import { vnDay, speciesUnlocked, type ActionResult, type FarmState } from './farm';
import { isUnlocked } from './progression';
import { SPECIES_IDS, sellPrice, type SpeciesId } from './species';
import { seeded } from './weather';

export interface Order {
  species: SpeciesId;
  count: number;
  coins: number;
  xp: number;
}

export const ORDERS_PER_DAY = 3;

export function ordersFor(day: string, xp: number): Order[] {
  const pool = SPECIES_IDS.filter((id) => speciesUnlocked(id, xp));
  return Array.from({ length: ORDERS_PER_DAY }, (_, i) => {
    const species = pool[Math.floor(seeded(`order:${day}:${i}:s`) * pool.length)];
    // Cheap crops are asked for in bigger batches.
    const max = sellPrice(species, 1) < 20 ? 6 : 3;
    const count = 1 + Math.floor(seeded(`order:${day}:${i}:n`) * max);
    return { species, count, coins: Math.round(sellPrice(species, 1) * count * 1.5), xp: 10 + count * 2 };
  });
}

/** The daily duo order: each partner delivers `count`, then both share a double reward. */
export interface DuoOrder extends Order {
  /** Items each partner must hand in. */
  count: number;
}

export function duoFor(day: string, xp: number): DuoOrder {
  const pool = SPECIES_IDS.filter((id) => speciesUnlocked(id, xp));
  const species = pool[Math.floor(seeded(`duo:${day}:s`) * pool.length)];
  const count = 2 + Math.floor(seeded(`duo:${day}:n`) * 3);
  return { species, count, coins: Math.round(sellPrice(species, 1) * count * 2 * 2), xp: 40 };
}

/** Who has delivered their half of today's duo order. */
export function duoDelivered(s: FarmState, now: number): string[] {
  return s.duo?.day === vnDay(now) ? s.duo.by : [];
}

export function deliverDuo(s: FarmState, uid: string, now: number): ActionResult {
  if (!isUnlocked('orders', s.xp)) return { ok: false, msg: 'locked_orders' };
  const day = vnDay(now);
  const boardXp = s.duo?.day === day ? s.duo.xp : s.xp;
  const order = duoFor(day, boardXp);
  const by = duoDelivered(s, now);
  if (by.length >= 2) return { ok: false, msg: 'order_done' };
  if (by.includes(uid)) return { ok: false, msg: 'duo_waiting' };
  if (haveCount(s, order.species) < order.count) {
    return { ok: false, msg: 'order_missing', vars: { species: order.species, n: order.count } };
  }
  take(s, order.species, order.count);
  const next = [...by, uid];
  s.duo = { day, by: next, xp: boardXp };
  if (next.length < 2) return { ok: true, msg: 'duo_half' };
  s.coins += order.coins;
  s.xp += order.xp;
  return { ok: true, msg: 'duo_done', vars: { value: order.coins, xp: order.xp } };
}

/** Removes `n` items of a species from the bag, lowest quality first. Returns the stars taken. */
export function take(s: FarmState, species: string, n: number): number[] {
  let need = n;
  const stars: number[] = [];
  for (const st of [1, 2, 3]) {
    const k = `${species}:${st}`;
    const got = Math.min(need, s.produce[k] ?? 0);
    if (got) s.produce[k] -= got;
    if (!s.produce[k]) delete s.produce[k];
    for (let i = 0; i < got; i++) stars.push(st);
    need -= got;
  }
  return stars;
}

/** Today's completed orders, resetting when the Vietnam day changes. */
export function doneToday(s: FarmState, now: number): number[] {
  return s.orders.day === vnDay(now) ? s.orders.done : [];
}

/** Today's board. Once the first order of the day is filled, its crop pool is frozen. */
export function boardFor(s: FarmState, now: number): Order[] {
  const day = vnDay(now);
  const xp = s.orders.day === day && s.orders.xp !== undefined ? s.orders.xp : s.xp;
  return ordersFor(day, xp);
}

/** Items of a species in the bag, any quality. */
export function haveCount(s: FarmState, species: string): number {
  return [1, 2, 3].reduce((n, st) => n + (s.produce[`${species}:${st}`] ?? 0), 0);
}

/** Hands over the items (lowest quality first) and collects the reward. */
export function fulfill(s: FarmState, idx: number, now: number): ActionResult {
  if (!isUnlocked('orders', s.xp)) return { ok: false, msg: 'locked_orders' };
  const day = vnDay(now);
  const boardXp = s.orders.day === day && s.orders.xp !== undefined ? s.orders.xp : s.xp;
  const order = ordersFor(day, boardXp)[idx];
  if (!order) return { ok: false, msg: 'nothing_here' };
  const done = doneToday(s, now);
  if (done.includes(idx)) return { ok: false, msg: 'order_done' };
  if (haveCount(s, order.species) < order.count) {
    return { ok: false, msg: 'order_missing', vars: { species: order.species, n: order.count } };
  }
  take(s, order.species, order.count);
  s.coins += order.coins;
  s.xp += order.xp;
  s.orders = { day, done: [...done, idx], xp: boardXp };
  return { ok: true, msg: 'order_filled', vars: { value: order.coins, xp: order.xp } };
}
