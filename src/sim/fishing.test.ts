import { describe, expect, it } from 'vitest';
import { newFarm } from './farm';
import { CATCHES_PER_DAY, DUO_FISH_XP, castsLeft, fishFor, landCatch } from './fishing';

// 08:00 in Vietnam.
const T0 = Date.UTC(2026, 9, 20, 1, 0);
const DAY = 24 * 3_600_000;
const level2 = () => ({ ...newFarm(), xp: 100 });

describe('fishing', () => {
  it('is locked until Garden Heart level 2', () => {
    expect(landCatch(newFarm(), 'phu', T0).msg).toBe('locked_fishing');
  });

  it('pays coins and XP and allows three catches a day per person', () => {
    const s = level2();
    for (let i = 0; i < CATCHES_PER_DAY; i++) expect(landCatch(s, 'phu', T0).ok).toBe(true);
    expect(s.coins).toBeGreaterThan(50);
    expect(castsLeft(s, 'phu', T0)).toBe(0);
    expect(landCatch(s, 'phu', T0).msg).toBe('fish_tired');
    expect(castsLeft(s, 'phu', T0 + DAY)).toBe(CATCHES_PER_DAY);
    expect(landCatch(s, 'phu', T0 + DAY).ok).toBe(true);
  });

  it('gives the together bonus once when both partners catch on the same day', () => {
    const s = level2();
    landCatch(s, 'phu', T0);
    const xp = s.xp;
    const r = landCatch(s, 'su', T0);
    expect(r.msg).toBe('fish_caught_duo');
    expect(s.xp - xp).toBeGreaterThanOrEqual(DUO_FISH_XP);
    expect(landCatch(s, 'su', T0).msg).toBe('fish_caught');
  });

  it('rolls the same fish for the same catch, so a retried write is consistent', () => {
    const a = level2();
    const b = level2();
    landCatch(a, 'phu', T0);
    landCatch(b, 'phu', T0);
    expect(a.coins).toBe(b.coins);
    expect(fishFor(0.99).id).toBe('koi');
    expect(fishFor(0).id).toBe('junk');
  });
});
