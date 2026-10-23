// The kitchen (Garden Heart level 5): turn produce into dishes worth more than
// their ingredients. A dish's quality is the average of what went into it.
import type { ActionResult, FarmState } from './farm';
import { haveCount, take } from './orders';
import { isUnlocked } from './progression';

export interface Recipe {
  id: string;
  inputs: Record<string, number>;
  xp: number;
}

export const RECIPES: Recipe[] = [
  { id: 'rau_xao', inputs: { rau_muong: 2, egg: 1 }, xp: 8 },
  { id: 'mut_dau', inputs: { strawberry: 4 }, xp: 8 },
  { id: 'com_trung', inputs: { rice: 2, egg: 1 }, xp: 10 },
  { id: 'bo_hoa', inputs: { sunflower: 2, rose: 1 }, xp: 20 },
  { id: 'banh_flan', inputs: { egg: 2, milk: 1 }, xp: 25 },
  { id: 'che_bi_do', inputs: { pumpkin: 1, milk: 1 }, xp: 30 },
];

export function canCook(s: FarmState, r: Recipe): boolean {
  return Object.entries(r.inputs).every(([item, n]) => haveCount(s, item) >= n);
}

export function cook(s: FarmState, id: string): ActionResult {
  if (!isUnlocked('kitchen', s.xp)) return { ok: false, msg: 'locked_kitchen' };
  const r = RECIPES.find((x) => x.id === id);
  if (!r) return { ok: false, msg: 'nothing_here' };
  if (!canCook(s, r)) return { ok: false, msg: 'missing_ingredients', vars: { species: r.id } };
  const used = Object.entries(r.inputs).flatMap(([item, n]) => take(s, item, n));
  const stars = Math.min(3, Math.max(1, Math.round(used.reduce((a, b) => a + b, 0) / used.length)));
  const key = `${r.id}:${stars}`;
  s.produce[key] = (s.produce[key] ?? 0) + 1;
  s.xp += r.xp;
  return { ok: true, msg: 'cooked', vars: { species: r.id, stars } };
}
