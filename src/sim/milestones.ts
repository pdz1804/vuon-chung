// Things that follow from a successful action rather than belonging to one: the couple's
// bond level and story chapter 1. Both stores call `afterAction` inside the same write,
// so a bond point or story beat is saved together with the action that earned it.
import { vnDay, type ActionResult, type FarmState } from './farm';
import type { SpeciesId } from './species';

/** Bond never decreases. Thresholds for levels 1..10. */
export const BOND_POINTS = [0, 20, 50, 90, 140, 200, 270, 350, 440, 540] as const;

type Reward = { coins?: number; seeds?: Partial<Record<SpeciesId, number>> };
/** One-time shared reward when the bond reaches each level (index = level). */
const BOND_REWARDS: Reward[] = [
  {},
  {},
  { seeds: { sunflower: 5 } },
  { coins: 50 },
  { seeds: { strawberry: 5 } },
  { coins: 100 },
  { seeds: { rose: 5 } },
  { coins: 150 },
  { seeds: { pumpkin: 5 } },
  { coins: 200 },
  { coins: 300 },
];

/** Points per result message; `cap` limits how often it counts per Vietnam day. */
const BOND_FOR: Record<string, { points: number; cap?: 'farm' | 'sender' }> = {
  watered_both: { points: 2, cap: 'farm' },
  duo_done: { points: 10 },
  fish_caught_duo: { points: 5 },
  letter_sent: { points: 2, cap: 'sender' },
  memory_added: { points: 3, cap: 'farm' },
  festival_done: { points: 15 },
};

/** Story chapter 1: each beat needs the previous one, then this result message. */
export const STORY_BEATS: Array<{ msg: string; npc: 'co_ba' | 'ong_minh'; reward: Reward }> = [
  { msg: 'planted', npc: 'co_ba', reward: { seeds: { rau_muong: 2 } } },
  { msg: 'harvested', npc: 'co_ba', reward: { coins: 25 } },
  { msg: 'order_filled', npc: 'ong_minh', reward: { coins: 30 } },
  { msg: 'watered_both', npc: 'co_ba', reward: { seeds: { sunflower: 5 } } },
  { msg: 'duo_done', npc: 'ong_minh', reward: { coins: 100 } },
];

export interface BondState {
  points: number;
  /** Highest level whose reward has been paid. */
  paid: number;
  /** Capped category ("farm:msg" or "uid:msg") → Vietnam day it last counted. */
  last: Record<string, string>;
}

export interface StoryState {
  /** Beats completed so far (0..STORY_BEATS.length). */
  beat: number;
  /** Beats each player has read in the mailbox. */
  read: Record<string, number>;
}

export function bondLevel(points: number): number {
  let lv = 1;
  BOND_POINTS.forEach((p, i) => {
    if (points >= p) lv = i + 1;
  });
  return lv;
}

function grant(s: FarmState, r: Reward) {
  s.coins += r.coins ?? 0;
  for (const [sp, n] of Object.entries(r.seeds ?? {})) {
    s.seeds[sp as SpeciesId] = (s.seeds[sp as SpeciesId] ?? 0) + (n ?? 0);
  }
}

function addBond(s: FarmState, r: ActionResult, uid: string, now: number) {
  const rule = BOND_FOR[r.msg];
  if (!rule) return;
  const bond = (s.bond ??= { points: 0, paid: 1, last: {} });
  if (rule.cap) {
    const key = `${rule.cap === 'farm' ? 'farm' : uid}:${r.msg}`;
    const day = vnDay(now);
    if (bond.last[key] === day) return;
    bond.last[key] = day;
  }
  bond.points += rule.points;
  // Pay every level crossed, even several at once.
  const lv = bondLevel(bond.points);
  for (let l = bond.paid + 1; l <= lv; l++) grant(s, BOND_REWARDS[l]);
  bond.paid = Math.max(bond.paid, lv);
}

function advanceStory(s: FarmState, r: ActionResult) {
  const story = (s.story ??= { beat: 0, read: {} });
  const next = STORY_BEATS[story.beat];
  if (!next || next.msg !== r.msg) return;
  story.beat += 1;
  grant(s, next.reward);
}

export function afterAction(s: FarmState, r: ActionResult, uid: string, now: number) {
  if (!r.ok) return;
  addBond(s, r, uid, now);
  advanceStory(s, r);
}

/** Story letters this player hasn't read yet (reading happens in readLetters). */
export function unreadStory(s: FarmState, uid: string): number {
  return Math.max(0, (s.story?.beat ?? 0) - (s.story?.read[uid] ?? 0));
}

/** The villager's line for today: the same for both players all day, no history kept. */
export function npcLineIndex(npc: string, now: number, lines: number): number {
  let h = 0x811c9dc5;
  for (const c of `${npc}|${vnDay(now)}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0) % lines;
}
