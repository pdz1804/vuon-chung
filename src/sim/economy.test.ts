import { describe, expect, it } from 'vitest';
import { HOUR } from './growth';
import { buySeeds, harvest, isFromNewerApp, migrate, newFarm, plotState, till, plant, water, vnDay } from './farm';
import { boardFor, doneToday, fulfill, ordersFor } from './orders';
import { LEVEL_XP, isUnlocked, levelFor, levelProgress } from './progression';
import { isRainDay, rainWaterings, rainingAt, seeded } from './weather';

const DRY = Date.UTC(2026, 9, 20, 1, 0); // 20 Oct 08:00 VN
const RAINY_MIDNIGHT = Date.UTC(2026, 9, 20, 17, 0); // 21 Oct 00:00 VN

describe('weather', () => {
  it('is deterministic and roughly seasonal', () => {
    expect(isRainDay('2026-10-20')).toBe(false);
    expect(isRainDay('2026-10-21')).toBe(true);
    expect(seeded('a')).toBe(seeded('a'));
    let wet = 0;
    let dry = 0;
    for (let d = 1; d <= 28; d++) {
      if (isRainDay(`2026-08-${String(d).padStart(2, '0')}`)) wet++;
      if (isRainDay(`2026-02-${String(d).padStart(2, '0')}`)) dry++;
    }
    expect(wet).toBeGreaterThan(dry);
  });

  it('waters crops at 06:00 on rain days', () => {
    expect(rainWaterings(RAINY_MIDNIGHT, RAINY_MIDNIGHT + 5 * HOUR)).toEqual([]);
    expect(rainWaterings(RAINY_MIDNIGHT, RAINY_MIDNIGHT + 7 * HOUR)).toEqual([RAINY_MIDNIGHT + 6 * HOUR]);
    expect(rainingAt(RAINY_MIDNIGHT + 7 * HOUR)).toBe(true);
    expect(rainingAt(RAINY_MIDNIGHT + 10 * HOUR)).toBe(false);
  });

  it('rain hydrates a planted crop, so watering is not needed', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    till(s, 1, 1);
    plant(s, 1, 1, 'rau_muong', RAINY_MIDNIGHT + HOUR);
    expect(plotState(s.plots['1,1'], RAINY_MIDNIGHT + 5 * HOUR)).toBe('needs_water');
    expect(plotState(s.plots['1,1'], RAINY_MIDNIGHT + 7 * HOUR)).toBe('growing');
    expect(water(s, 1, 1, RAINY_MIDNIGHT + 7 * HOUR).msg).toBe('already_wet');
  });
});

describe('progression', () => {
  it('maps XP to levels and progress', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(99)).toBe(1);
    expect(levelFor(100)).toBe(2);
    expect(levelFor(LEVEL_XP[9])).toBe(10);
    expect(levelProgress(200)).toBeCloseTo(0.5);
    expect(levelProgress(99999)).toBe(1);
  });

  it('locks roses until level 3', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    s.coins = 1000;
    expect(buySeeds(s, 'rose').msg).toBe('locked');
    s.xp = 300;
    expect(isUnlocked('rose', s.xp)).toBe(true);
    expect(buySeeds(s, 'rose').ok).toBe(true);
  });
});

describe('orders', () => {
  it('are the same for everyone on a given day and only use unlocked crops', () => {
    const a = ordersFor('2026-10-20', 0);
    expect(a).toEqual(ordersFor('2026-10-20', 0));
    expect(a).toHaveLength(3);
    expect(a.every((o) => o.species !== 'rose')).toBe(true);
  });

  it('pays once per order per day and takes lowest quality first', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    expect(fulfill(s, 0, DRY).msg).toBe('locked_orders');
    s.xp = 100;
    const o = ordersFor(vnDay(DRY), s.xp)[0];
    expect(fulfill(s, 0, DRY).msg).toBe('order_missing');
    s.produce[`${o.species}:1`] = o.count - 1;
    s.produce[`${o.species}:3`] = 5;
    const coins = s.coins;
    expect(fulfill(s, 0, DRY).ok).toBe(true);
    expect(s.coins).toBe(coins + o.coins);
    expect(s.produce[`${o.species}:1`]).toBeUndefined();
    expect(s.produce[`${o.species}:3`]).toBe(4);
    expect(fulfill(s, 0, DRY).msg).toBe('order_done');
    // A new day resets the board.
    expect(doneToday(s, DRY + 24 * HOUR)).toEqual([]);
  });
});

describe('migrate', () => {
  it('keeps a v1 save and adds new fields', () => {
    const v1 = { ...newFarm(), schemaVersion: 1, coins: 777 } as Record<string, unknown>;
    delete v1.orders;
    const m = migrate(v1);
    expect(m.coins).toBe(777);
    expect(m.schemaVersion).toBe(2);
    expect(m.orders).toEqual({ day: '', done: [] });
  });

  it('starts fresh on garbage', () => {
    expect(migrate(5).coins).toBe(50);
    expect(migrate({ schemaVersion: 0 }).coins).toBe(50);
  });
});

describe('verifier regressions', () => {
  it("keeps today's board stable when XP crosses an unlock", () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    s.xp = 290;
    const before = boardFor(s, DRY);
    const o = before[0];
    s.produce[`${o.species}:1`] = 20;
    expect(fulfill(s, 0, DRY).ok).toBe(true);
    s.xp = 400; // rose unlocked mid-day
    expect(boardFor(s, DRY)).toEqual(before);
  });

  it('never downgrades a farm written by a newer app', () => {
    const future = migrate({ ...newFarm(), schemaVersion: 3, coins: 9 });
    expect(future.coins).toBe(9);
    expect(isFromNewerApp(future)).toBe(true);
  });

  it('keeps the morning rain when a regrowing crop is harvested on a rain day', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    till(s, 1, 1);
    plant(s, 1, 1, 'strawberry', RAINY_MIDNIGHT - 30 * HOUR);
    water(s, 1, 1, RAINY_MIDNIGHT - 30 * HOUR);
    expect(harvest(s, 1, 1, RAINY_MIDNIGHT + 10 * HOUR).ok).toBe(true);
    expect(plotState(s.plots['1,1'], RAINY_MIDNIGHT + 10 * HOUR)).toBe('growing');
  });
});
