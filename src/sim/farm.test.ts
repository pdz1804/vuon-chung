import { describe, expect, it } from 'vitest';
import { HOUR, dryForMs, hydratedMs, isWilted, qualityStars, stage } from './growth';
import { buySeeds, harvest, newFarm, payout, plant, plotState, ship, till, useTile, vnDay, water } from './farm';

// 08:00 in Vietnam on a dry day (weather is seeded from the date).
const T0 = Date.UTC(2026, 9, 20, 1, 0);

describe('growth', () => {
  it('grows only while hydrated', () => {
    const crop = { plantedAt: T0, waterings: [] as number[] };
    expect(hydratedMs(crop, T0 + 10 * HOUR)).toBe(0);
    crop.waterings.push(T0 + 2 * HOUR);
    expect(hydratedMs(crop, T0 + 10 * HOUR)).toBe(8 * HOUR);
    // Hydration lasts 24 h, then growth pauses.
    expect(hydratedMs(crop, T0 + 40 * HOUR)).toBe(24 * HOUR);
  });

  it('does not double count overlapping waterings', () => {
    const crop = { plantedAt: T0, waterings: [T0, T0 + 12 * HOUR] };
    expect(hydratedMs(crop, T0 + 100 * HOUR)).toBe(36 * HOUR);
  });

  it('maps progress to stages and pauses when dry', () => {
    const crop = { plantedAt: T0, waterings: [T0] };
    const grow = 4 * HOUR;
    expect(stage(crop, grow, T0)).toBe(0);
    expect(stage(crop, grow, T0 + 1 * HOUR)).toBe(1);
    expect(stage(crop, grow, T0 + 3.9 * HOUR)).toBe(3);
    expect(stage(crop, grow, T0 + 4 * HOUR)).toBe(4);
    const dry = { plantedAt: T0, waterings: [] };
    expect(stage(dry, grow, T0 + 100 * HOUR)).toBe(0);
  });

  it('wilts after more than 24 h dry, and recovers when watered', () => {
    const crop = { plantedAt: T0, waterings: [T0] };
    expect(isWilted(crop, T0 + 47 * HOUR)).toBe(false);
    expect(isWilted(crop, T0 + 49 * HOUR)).toBe(true);
    crop.waterings.push(T0 + 49 * HOUR);
    expect(dryForMs(crop, T0 + 50 * HOUR)).toBe(0);
  });

  it('gives a care star only if never dry too long before ready', () => {
    const grow = 30 * HOUR;
    const good = { plantedAt: T0, waterings: [T0, T0 + 24 * HOUR] };
    expect(qualityStars(good, grow, T0 + 30 * HOUR)).toBe(2);
    const neglected = { plantedAt: T0, waterings: [T0, T0 + 60 * HOUR] };
    expect(qualityStars(neglected, grow, T0 + 70 * HOUR)).toBe(1);
    // Leaving a ready plant unharvested for days doesn't cost the star.
    expect(qualityStars(good, grow, T0 + 200 * HOUR)).toBe(2);
    expect(qualityStars(good, grow, T0 + 30 * HOUR, true)).toBe(3);
  });
});

describe('farm actions', () => {
  it('runs the full loop: till, plant, water, harvest, ship, payout', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    expect(till(s, 3, 3).ok).toBe(true);
    expect(plant(s, 3, 3, 'rau_muong', T0).ok).toBe(true);
    expect(plotState(s.plots['3,3'], T0)).toBe('needs_water');
    expect(water(s, 3, 3, T0).ok).toBe(true);
    expect(water(s, 3, 3, T0 + HOUR).msg).toBe('already_wet');
    expect(harvest(s, 3, 3, T0 + 2 * HOUR).msg).toBe('not_ready');
    expect(plotState(s.plots['3,3'], T0 + 4 * HOUR)).toBe('ready');
    const h = harvest(s, 3, 3, T0 + 4 * HOUR);
    expect(h.ok).toBe(true);
    expect(s.produce['rau_muong:2']).toBe(1);
    expect(s.plots['3,3'].crop).toBeUndefined();

    const coins = s.coins;
    expect(ship(s, T0 + 5 * HOUR).ok).toBe(true);
    expect(payout(s, T0 + 6 * HOUR)).toBe(0); // same Vietnam day
    const nextDay = T0 + 20 * HOUR;
    expect(vnDay(nextDay)).not.toBe(vnDay(T0));
    expect(payout(s, nextDay)).toBe(15); // 12 × 1.25 for 2★
    expect(payout(s, nextDay)).toBe(0); // never pays twice
    expect(s.coins).toBe(coins + 15);
  });

  it('keeps regrowing plants and restarts their clock', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    till(s, 1, 1);
    plant(s, 1, 1, 'strawberry', T0);
    water(s, 1, 1, T0);
    expect(harvest(s, 1, 1, T0 + 12 * HOUR).ok).toBe(true);
    const crop = s.plots['1,1'].crop!;
    expect(crop.harvests).toBe(1);
    // Still hydrated from the morning watering: regrows in 8 h.
    expect(plotState(s.plots['1,1'], T0 + 20 * HOUR)).toBe('ready');
  });

  it('refuses invalid actions with a reason', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    expect(plant(s, 0, 0, 'rau_muong', T0).msg).toBe('not_tilled');
    till(s, 0, 0);
    expect(plant(s, 0, 0, 'sunflower', T0).msg).toBe('no_seeds');
    s.coins = 10;
    expect(buySeeds(s, 'sunflower').msg).toBe('not_enough_coins');
    expect(buySeeds(s, 'rau_muong', 2).ok).toBe(true);
    expect(s.coins).toBe(0);
  });
});

describe('useTile', () => {
  it('walks a tile through till, plant, water, growing, harvest', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    expect(useTile(s, 2, 2, 'rau_muong', T0).msg).toBe('tilled');
    expect(useTile(s, 2, 2, 'rau_muong', T0).msg).toBe('planted');
    expect(useTile(s, 2, 2, 'rau_muong', T0).msg).toBe('watered');
    const g = useTile(s, 2, 2, 'rau_muong', T0 + 2 * HOUR);
    expect(g).toMatchObject({ ok: false, msg: 'growing', vars: { pct: 50 } });
    expect(useTile(s, 2, 2, 'rau_muong', T0 + 4 * HOUR).msg).toBe('harvested');
  });
});

describe('fast first crop', () => {
  it('a brand-new garden harvests its first crop after 10 minutes of water', () => {
    const s = newFarm();
    till(s, 2, 2);
    plant(s, 2, 2, 'rau_muong', T0);
    water(s, 2, 2, T0);
    expect(plotState(s.plots['2,2'], T0 + 9 * 60_000)).toBe('growing');
    expect(harvest(s, 2, 2, T0 + 10 * 60_000).ok).toBe(true);
  });

  it('only the first crop is fast, and older gardens never get one', () => {
    const s = newFarm();
    till(s, 2, 2);
    till(s, 3, 2);
    plant(s, 2, 2, 'rau_muong', T0);
    plant(s, 3, 2, 'rau_muong', T0);
    expect(s.plots['3,2'].crop?.quick).toBeUndefined();
    const old = { ...newFarm(), xp: 40 };
    till(old, 2, 2);
    plant(old, 2, 2, 'rau_muong', T0);
    expect(old.plots['2,2'].crop?.quick).toBeUndefined();
  });
});
