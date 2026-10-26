// The meadow (from Garden Heart level 3): once a Vietnam day the garden can gather
// wildflower seeds at its gathering spot.
import { vnDay, type ActionResult, type FarmState } from './farm';
import { isUnlocked } from './progression';

export const MEADOW_SEEDS = 2;

export function gatherMeadow(s: FarmState, now: number): ActionResult {
  if (!isUnlocked('meadow', s.xp)) return { ok: false, msg: 'locked_meadow' };
  const day = vnDay(now);
  if (s.meadowDay === day) return { ok: false, msg: 'meadow_done' };
  s.meadowDay = day;
  s.seeds.sunflower = (s.seeds.sunflower ?? 0) + MEADOW_SEEDS;
  return { ok: true, msg: 'meadow_gathered', vars: { n: MEADOW_SEEDS } };
}
