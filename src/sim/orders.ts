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
export function haveCount(s: FarmState, species: SpeciesId): number {
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
  let need = order.count;
  for (const st of [1, 2, 3]) {
    const k = `${order.species}:${st}`;
    const take = Math.min(need, s.produce[k] ?? 0);
    if (take) s.produce[k] -= take;
    if (!s.produce[k]) delete s.produce[k];
    need -= take;
  }
  s.coins += order.coins;
  s.xp += order.xp;
  s.orders = { day, done: [...done, idx], xp: boardXp };
  return { ok: true, msg: 'order_filled', vars: { value: order.coins, xp: order.xp } };
}
