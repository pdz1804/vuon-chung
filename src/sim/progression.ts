// Garden Heart: one shared level for the farm, filled by XP from everything
// the two of you do. Thresholds match the design doc (L1–10).
export const LEVEL_XP = [0, 100, 300, 650, 1100, 1700, 2500, 3500, 4800, 6500] as const;
export const MAX_LEVEL = LEVEL_XP.length;

export function levelFor(xp: number): number {
  let lv = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lv = i + 1;
  return lv;
}

/** Progress 0..1 toward the next level (1 at max level). */
export function levelProgress(xp: number): number {
  const lv = levelFor(xp);
  if (lv >= MAX_LEVEL) return 1;
  const lo = LEVEL_XP[lv - 1];
  const hi = LEVEL_XP[lv];
  return (xp - lo) / (hi - lo);
}

/** What each level opens up (only implemented features are listed). */
export const UNLOCKS: Record<number, string[]> = {
  2: ['orders', 'chicken', 'fishing'],
  3: ['rose', 'roles', 'meadow'],
  4: ['duck', 'pumpkin'],
  5: ['kitchen', 'rice', 'river'],
  6: ['cow'],
};

export function isUnlocked(feature: string, xp: number): boolean {
  const lv = levelFor(xp);
  return Object.entries(UNLOCKS).some(([l, f]) => Number(l) <= lv && f.includes(feature));
}
