// Animals: buy chicks, fill the shared feeder once a day, pet them for hearts,
// collect eggs. Everything is derived from Vietnam calendar days so it works
// lazily (no server tick) and identically for both partners.
import { vnDay, type ActionResult, type FarmState } from './farm';
import { isUnlocked } from './progression';

export type AnimalSpecies = 'chicken';

export interface Animal {
  id: string;
  species: AnimalSpecies;
  name: string;
  /** 0–10. */
  hearts: number;
  /** Vietnam day → uids who petted it that day. */
  pets: Record<string, string[]>;
  /** Last day an egg was collected. */
  collectedDay: string;
  /** Last day the feeder was full while this animal was around (neglect tracking). */
  fedDay: string;
}

export const ANIMALS = {
  chicken: { cost: 300, product: 'egg', productPrice: 30, unlock: 'chicken', capacity: 4, feedCost: 3 },
} as const;

export const MAX_HEARTS = 10;
/** Days without food before hearts start dropping (one per extra day, never below 0). */
export const GRACE_DAYS = 3;

const DAY_MS = 86_400_000;
function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export function fedToday(s: FarmState, now: number): boolean {
  return s.feederDay === vnDay(now);
}

/** Hearts after neglect (computed lazily; persisted on the next feed). */
export function effectiveHearts(a: Animal, now: number): number {
  const hungry = daysBetween(a.fedDay, vnDay(now)) - GRACE_DAYS;
  return Math.max(0, a.hearts - Math.max(0, hungry));
}

export function eggReady(s: FarmState, a: Animal, now: number): boolean {
  return fedToday(s, now) && a.collectedDay !== vnDay(now);
}

/** Egg quality: 1★, +1 at 5 hearts, +1 at 9 hearts. */
export function eggStars(a: Animal, now: number): 1 | 2 | 3 {
  const h = effectiveHearts(a, now);
  return (1 + (h >= 5 ? 1 : 0) + (h >= 9 ? 1 : 0)) as 1 | 2 | 3;
}

export function buyAnimal(s: FarmState, species: AnimalSpecies, name: string, now: number): ActionResult {
  const spec = ANIMALS[species];
  if (!isUnlocked(spec.unlock, s.xp)) return { ok: false, msg: 'locked_animal' };
  if (s.animals.filter((a) => a.species === species).length >= spec.capacity) return { ok: false, msg: 'coop_full' };
  if (s.coins < spec.cost) return { ok: false, msg: 'not_enough_coins' };
  s.coins -= spec.cost;
  const day = vnDay(now);
  const clean = name.trim().slice(0, 16) || `${species}-${s.animals.length + 1}`;
  s.animals.push({
    id: `${now.toString(36)}${s.animals.length}`,
    species,
    name: clean,
    hearts: 0,
    pets: {},
    // Arriving after today's feeding: no free egg until tomorrow.
    collectedDay: s.feederDay === day ? day : '',
    fedDay: day,
  });
  return { ok: true, msg: 'animal_bought', vars: { name: clean } };
}

/** One fill covers every animal for the whole Vietnam day. */
export function fillFeeder(s: FarmState, now: number): ActionResult {
  if (!s.animals.length) return { ok: false, msg: 'no_animals' };
  if (fedToday(s, now)) return { ok: false, msg: 'feeder_full' };
  const cost = s.animals.reduce((sum, a) => sum + ANIMALS[a.species].feedCost, 0);
  if (s.coins < cost) return { ok: false, msg: 'not_enough_coins' };
  s.coins -= cost;
  const day = vnDay(now);
  for (const a of s.animals) {
    a.hearts = effectiveHearts(a, now); // settle neglect before resetting it
    a.fedDay = day;
  }
  s.feederDay = day;
  return { ok: true, msg: 'feeder_filled', vars: { value: cost } };
}

/** Pet once per person per day: +1 heart, +1 more when the partner petted it today too. */
export function pet(s: FarmState, id: string, uid: string, now: number): ActionResult {
  const a = s.animals.find((x) => x.id === id);
  if (!a) return { ok: false, msg: 'nothing_here' };
  const day = vnDay(now);
  const who = (a.pets[day] ??= []);
  if (who.includes(uid)) return { ok: false, msg: 'already_petted', vars: { name: a.name } };
  who.push(uid);
  // Keep only today's entry: older days never matter again.
  a.pets = { [day]: who };
  const both = new Set(who).size >= 2;
  // `hearts` stays raw: neglect is still subtracted lazily from `fedDay`, so
  // settling it here as well would count the hungry days twice.
  a.hearts = Math.min(MAX_HEARTS, a.hearts + (both ? 2 : 1));
  return { ok: true, msg: both ? 'petted_both' : 'petted', vars: { name: a.name, n: effectiveHearts(a, now) } };
}

export function collectEgg(s: FarmState, id: string, now: number): ActionResult {
  const a = s.animals.find((x) => x.id === id);
  if (!a) return { ok: false, msg: 'nothing_here' };
  if (!fedToday(s, now)) return { ok: false, msg: 'hungry', vars: { name: a.name } };
  if (!eggReady(s, a, now)) return { ok: false, msg: 'no_egg', vars: { name: a.name } };
  const stars = eggStars(a, now);
  const item = `egg:${stars}`;
  s.produce[item] = (s.produce[item] ?? 0) + 1;
  a.collectedDay = vnDay(now);
  s.xp += 2 * stars;
  return { ok: true, msg: 'egg_collected', vars: { stars } };
}

/** The single "use" on an animal: pet first, then collect, then show its mood. */
export function useAnimal(s: FarmState, id: string, uid: string, now: number): ActionResult {
  const a = s.animals.find((x) => x.id === id);
  if (!a) return { ok: false, msg: 'nothing_here' };
  if (!(a.pets[vnDay(now)] ?? []).includes(uid)) return pet(s, id, uid, now);
  if (eggReady(s, a, now)) return collectEgg(s, id, now);
  return {
    ok: false,
    msg: fedToday(s, now) ? 'animal_happy' : 'hungry',
    vars: { name: a.name, n: effectiveHearts(a, now) },
  };
}

/**
 * Where an animal is standing: a deterministic wander inside its pen, derived
 * from the clock, so both partners see their chickens in the same places.
 */
export function animalPosition(
  id: string,
  index: number,
  now: number,
  pen: { x0: number; y0: number; x1: number; y1: number },
) {
  const step = Math.floor(now / 4000);
  const pick = (k: number, salt: string) => {
    let h = 2166136261;
    const text = `${id}:${k}:${salt}`;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return ((h >>> 0) % 1000) / 1000;
  };
  const at = (k: number) => ({
    x: pen.x0 + pick(k, 'x') * (pen.x1 - pen.x0),
    y: pen.y0 + pick(k, 'y') * (pen.y1 - pen.y0),
  });
  const a = at(step + index * 7);
  const b = at(step + 1 + index * 7);
  const f = Math.min(1, ((now % 4000) / 4000) * 2); // walk for 2 s, rest 2 s
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, moving: f < 1, left: b.x < a.x };
}
