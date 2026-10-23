// Farmer roles (nghề) and ranks. The Garden Heart level belongs to the farm;
// roles and ranks belong to each player, so the farm works best when the two
// of you pick different roles and split the work.
import { vnDay, type ActionResult, type FarmState } from './farm';
import { isUnlocked } from './progression';

export type RoleId = 'grower' | 'rancher' | 'florist';
export const ROLE_IDS: RoleId[] = ['grower', 'rancher', 'florist'];

/** Role XP needed for ranks 1–5: Tập sự → Nông dân → Lành nghề → Bậc thầy → Huyền thoại. */
export const RANK_XP = [0, 150, 500, 1200, 2500];
export const SWITCH_COOLDOWN_DAYS = 7;
/** Partners in different roles earn a little more role XP ("chia việc"). */
export const SYNERGY = 1.1;

export interface PlayerState {
  role?: RoleId;
  roleXp: Partial<Record<RoleId, number>>;
  /** Vietnam day of the last role change. */
  switchedDay?: string;
}

export function playerOf(s: FarmState, uid: string): PlayerState {
  return (s.players[uid] ??= { roleXp: {} });
}

export function rankFor(xp: number): number {
  let r = 1;
  RANK_XP.forEach((need, i) => {
    if (xp >= need) r = i + 1;
  });
  return r;
}

/** Rank of `uid` in `role` — but perks only apply while that role is active. */
export function activeRank(s: FarmState, uid: string, role: RoleId): number {
  const p = s.players[uid];
  if (!p || p.role !== role) return 0;
  return rankFor(p.roleXp[role] ?? 0);
}

export function rankProgress(xp: number): number {
  const r = rankFor(xp);
  if (r >= RANK_XP.length) return 1;
  return (xp - RANK_XP[r - 1]) / (RANK_XP[r] - RANK_XP[r - 1]);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function chooseRole(s: FarmState, uid: string, role: RoleId, now: number): ActionResult {
  if (!isUnlocked('roles', s.xp)) return { ok: false, msg: 'locked_roles' };
  const p = playerOf(s, uid);
  if (p.role === role) return { ok: false, msg: 'role_same' };
  const today = vnDay(now);
  if (p.role && p.switchedDay && daysBetween(p.switchedDay, today) < SWITCH_COOLDOWN_DAYS) {
    return {
      ok: false,
      msg: 'role_cooldown',
      vars: { n: SWITCH_COOLDOWN_DAYS - daysBetween(p.switchedDay, today) },
    };
  }
  p.role = role;
  p.switchedDay = today;
  return { ok: true, msg: 'role_chosen', vars: { role } };
}

/** Both partners have roles and they differ. */
export function hasSynergy(s: FarmState): boolean {
  const roles = Object.values(s.players)
    .map((p) => p.role)
    .filter(Boolean);
  return roles.length >= 2 && new Set(roles).size === roles.length;
}

/**
 * Adds role XP when the action matches the player's active role.
 * Returns the new rank if it went up (for a celebration), else 0.
 */
export function gainRoleXp(s: FarmState, uid: string, role: RoleId, amount: number): number {
  const p = s.players[uid];
  if (!p || p.role !== role || amount <= 0) return 0;
  const before = rankFor(p.roleXp[role] ?? 0);
  // Fractional XP is kept so the +10% synergy isn't rounded away on small gains.
  p.roleXp[role] = (p.roleXp[role] ?? 0) + amount * (hasSynergy(s) ? SYNERGY : 1);
  const after = rankFor(p.roleXp[role] ?? 0);
  return after > before ? after : 0;
}

/** Farmer title from the sum of every role's rank (3 = brand new, 15 = all legends). */
export function titleKey(p: PlayerState | undefined): string {
  const sum = ROLE_IDS.reduce((n, r) => n + rankFor(p?.roleXp[r] ?? 0), 0);
  if (sum >= 13) return 'title.5';
  if (sum >= 10) return 'title.4';
  if (sum >= 7) return 'title.3';
  if (sum >= 5) return 'title.2';
  return 'title.1';
}
