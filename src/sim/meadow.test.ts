import { describe, expect, it } from 'vitest';
import { newFarm } from './farm';
import { MEADOW_SEEDS, gatherMeadow } from './meadow';

const T0 = Date.UTC(2026, 9, 20, 1, 0);

describe('meadow', () => {
  it('opens at level 3 and gives sunflower seeds once a day', () => {
    expect(gatherMeadow(newFarm(), T0).msg).toBe('locked_meadow');
    const s = { ...newFarm(), xp: 300 };
    expect(gatherMeadow(s, T0).ok).toBe(true);
    expect(s.seeds.sunflower).toBe(MEADOW_SEEDS);
    expect(gatherMeadow(s, T0 + 3_600_000).msg).toBe('meadow_done');
    expect(gatherMeadow(s, T0 + 24 * 3_600_000).ok).toBe(true);
  });
});
