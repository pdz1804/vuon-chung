import { describe, expect, it } from 'vitest';
import { binValue, buySeeds, newFarm } from './farm';
import { RECIPES, canCook, cook } from './kitchen';
import { buyAnimal, collectEgg, fillFeeder } from './animals';

const T0 = Date.UTC(2026, 9, 20, 1, 0);

describe('kitchen', () => {
  it('unlocks at level 5 and turns ingredients into a more valuable dish', () => {
    const s = newFarm();
    expect(cook(s, 'mut_dau').msg).toBe('locked_kitchen');
    s.xp = 1100;
    expect(cook(s, 'mut_dau').msg).toBe('missing_ingredients');
    s.produce['strawberry:1'] = 2;
    s.produce['strawberry:3'] = 2;
    expect(cook(s, 'mut_dau').ok).toBe(true);
    expect(s.produce['mut_dau:2']).toBe(1); // average of 1,1,3,3
    expect(s.produce['strawberry:1']).toBeUndefined();
    // Worth more than its four strawberries sold raw (4 × 8 = 32).
    expect(binValue({ 'mut_dau:1': 1 })).toBeGreaterThan(32);
  });

  it('every recipe is worth more than its ingredients at 1★', () => {
    for (const r of RECIPES) {
      const raw = binValue(Object.fromEntries(Object.entries(r.inputs).map(([k, n]) => [`${k}:1`, n])));
      expect(binValue({ [`${r.id}:1`]: 1 })).toBeGreaterThan(raw);
    }
  });

  it('new crops and animals unlock by level', () => {
    const s = newFarm();
    s.coins = 10_000;
    expect(buySeeds(s, 'pumpkin').msg).toBe('locked');
    expect(buyAnimal(s, 'duck', 'Vịt', T0).msg).toBe('locked_animal');
    s.xp = 1700;
    expect(buySeeds(s, 'pumpkin').ok).toBe(true);
    expect(buySeeds(s, 'rice').ok).toBe(true);
    expect(buyAnimal(s, 'duck', 'Vịt', T0).ok).toBe(true);
    expect(buyAnimal(s, 'cow', 'Bò', T0).ok).toBe(true);
    expect(buyAnimal(s, 'cow', 'Bò 2', T0).ok).toBe(true);
    expect(buyAnimal(s, 'cow', 'Bò 3', T0).msg).toBe('coop_full');
    fillFeeder(s, T0);
    collectEgg(s, s.animals[1].id, T0);
    expect(s.produce['milk:1']).toBe(1);
    expect(
      canCook(
        s,
        RECIPES.find((r) => r.id === 'che_bi_do')!,
      ),
    ).toBe(false);
  });
});
