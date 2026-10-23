import { describe, expect, it } from 'vitest';
import { HOUR } from './growth';
import { binValue, newFarm } from './farm';
import { buyAnimal, collectEgg, effectiveHearts, fillFeeder, pet, useAnimal, animalPosition } from './animals';
import { deliverDuo, duoFor } from './orders';

const T0 = Date.UTC(2026, 9, 20, 1, 0); // 20 Oct 08:00 VN
const DAY = 24 * HOUR;

function farmWithChicken() {
  const s = newFarm();
  s.xp = 100;
  s.coins = 1000;
  buyAnimal(s, 'chicken', 'Bông', T0);
  return s;
}

describe('animals', () => {
  it('needs level 2 and coins, and caps the coop', () => {
    const s = newFarm();
    s.coins = 5000;
    expect(buyAnimal(s, 'chicken', 'x', T0).msg).toBe('locked_animal');
    s.xp = 100;
    for (let i = 0; i < 4; i++) expect(buyAnimal(s, 'chicken', `c${i}`, T0).ok).toBe(true);
    expect(buyAnimal(s, 'chicken', 'c5', T0).msg).toBe('coop_full');
  });

  it('lays one egg per fed day, quality follows hearts', () => {
    const s = farmWithChicken();
    const id = s.animals[0].id;
    expect(collectEgg(s, id, T0).msg).toBe('hungry');
    expect(fillFeeder(s, T0).ok).toBe(true);
    expect(fillFeeder(s, T0).msg).toBe('feeder_full');
    expect(collectEgg(s, id, T0).ok).toBe(true);
    expect(s.produce['egg:1']).toBe(1);
    expect(collectEgg(s, id, T0 + HOUR).msg).toBe('no_egg');
    s.animals[0].hearts = 9;
    fillFeeder(s, T0 + DAY);
    collectEgg(s, id, T0 + DAY);
    expect(s.produce['egg:3']).toBe(1);
    expect(binValue({ 'egg:1': 1 })).toBe(30);
  });

  it('gives +1 heart per person per day and +2 when both pet it', () => {
    const s = farmWithChicken();
    const id = s.animals[0].id;
    expect(pet(s, id, 'phu', T0).msg).toBe('petted');
    expect(pet(s, id, 'phu', T0 + HOUR).msg).toBe('already_petted');
    expect(pet(s, id, 'su', T0 + 5 * HOUR).msg).toBe('petted_both');
    expect(s.animals[0].hearts).toBe(3);
    expect(Object.keys(s.animals[0].pets)).toHaveLength(1);
  });

  it('loses hearts only after 3 hungry days and never leaves', () => {
    const s = farmWithChicken();
    const a = s.animals[0];
    a.hearts = 6;
    expect(effectiveHearts(a, T0 + 3 * DAY)).toBe(6);
    expect(effectiveHearts(a, T0 + 5 * DAY)).toBe(4);
    expect(effectiveHearts(a, T0 + 50 * DAY)).toBe(0);
    expect(s.animals).toHaveLength(1);
  });

  it('use = pet first, then collect', () => {
    const s = farmWithChicken();
    fillFeeder(s, T0);
    const id = s.animals[0].id;
    expect(useAnimal(s, id, 'phu', T0).msg).toBe('petted');
    expect(useAnimal(s, id, 'phu', T0).msg).toBe('egg_collected');
    expect(useAnimal(s, id, 'phu', T0).msg).toBe('animal_happy');
  });

  it('wanders deterministically inside the pen', () => {
    const pen = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const a = animalPosition('c1', 0, T0, pen);
    expect(animalPosition('c1', 0, T0, pen)).toEqual(a);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x).toBeLessThanOrEqual(10);
  });
});

describe('duo order', () => {
  it('needs both partners, then pays double', () => {
    const s = newFarm();
    s.xp = 100;
    const o = duoFor('2026-10-20', s.xp);
    s.produce[`${o.species}:1`] = o.count * 2;
    const coins = s.coins;
    expect(deliverDuo(s, 'phu', T0).msg).toBe('duo_half');
    expect(deliverDuo(s, 'phu', T0).msg).toBe('duo_waiting');
    expect(deliverDuo(s, 'su', T0 + HOUR).msg).toBe('duo_done');
    expect(s.coins).toBe(coins + o.coins);
    expect(deliverDuo(s, 'su', T0 + HOUR).msg).toBe('order_done');
  });
});

describe('verifier regressions', () => {
  it('petting a neglected chicken adds hearts instead of double-counting the decay', () => {
    const s = farmWithChicken();
    const a = s.animals[0];
    a.hearts = 5;
    const later = T0 + 5 * DAY; // 2 hungry days past the grace period
    expect(effectiveHearts(a, later)).toBe(3);
    expect(pet(s, a.id, 'phu', later).vars?.n).toBe(4);
    expect(effectiveHearts(a, later)).toBe(4);
    expect(pet(s, a.id, 'su', later).vars?.n).toBe(6);
  });

  it("a chick bought after today's feeding lays from tomorrow", () => {
    const s = farmWithChicken();
    fillFeeder(s, T0);
    buyAnimal(s, 'chicken', 'Mít', T0);
    expect(collectEgg(s, s.animals[1].id, T0).msg).toBe('no_egg');
  });
});
