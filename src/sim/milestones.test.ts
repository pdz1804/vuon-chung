import { describe, expect, it } from 'vitest';
import { newFarm, type ActionResult } from './farm';
import { readLetters } from './couple';
import { afterAction, bondLevel, npcLineIndex, unreadStory } from './milestones';

const T0 = Date.UTC(2026, 9, 20, 1, 0);
const DAY = 24 * 3_600_000;
const ok = (msg: string): ActionResult => ({ ok: true, msg });

describe('bond', () => {
  it('only grows, and capped events count once a day', () => {
    const s = newFarm();
    afterAction(s, ok('memory_added'), 'phu', T0);
    afterAction(s, ok('memory_added'), 'su', T0 + 1000);
    expect(s.bond?.points).toBe(3);
    afterAction(s, ok('memory_added'), 'su', T0 + DAY);
    expect(s.bond?.points).toBe(6);
    afterAction(s, { ok: false, msg: 'duo_done' }, 'su', T0);
    expect(s.bond?.points).toBe(6);
  });

  it('caps letters per sender, not per garden', () => {
    const s = newFarm();
    afterAction(s, ok('letter_sent'), 'phu', T0);
    afterAction(s, ok('letter_sent'), 'phu', T0);
    afterAction(s, ok('letter_sent'), 'su', T0);
    expect(s.bond?.points).toBe(4);
  });

  it('pays every level crossed at once', () => {
    const s = newFarm();
    const coins = s.coins;
    for (let i = 0; i < 4; i++) afterAction(s, ok('festival_done'), 'phu', T0); // 60 points
    expect(bondLevel(s.bond!.points)).toBe(3);
    expect(s.seeds.sunflower).toBe(5);
    expect(s.coins).toBe(coins + 50);
  });
});

describe('villagers', () => {
  it('say the same line all day and change it on another day', () => {
    expect(npcLineIndex('co_ba', T0, 3)).toBe(npcLineIndex('co_ba', T0 + 3_600_000, 3));
    const days = new Set([0, 1, 2, 3, 4, 5].map((d) => npcLineIndex('co_ba', T0 + d * DAY, 3)));
    expect(days.size).toBeGreaterThan(1);
  });
});

describe('story chapter 1', () => {
  it('advances beat by beat in order and rewards each once', () => {
    const s = newFarm();
    const seeds = s.seeds.rau_muong ?? 0;
    afterAction(s, ok('harvested'), 'phu', T0); // out of order: nothing
    expect(s.story?.beat).toBe(0);
    afterAction(s, ok('planted'), 'phu', T0);
    afterAction(s, ok('planted'), 'phu', T0);
    expect(s.story?.beat).toBe(1);
    expect(s.seeds.rau_muong).toBe(seeds + 2);
    afterAction(s, ok('harvested'), 'su', T0);
    expect(s.story?.beat).toBe(2);
  });

  it('tracks which story letters each player has read', () => {
    const s = newFarm();
    afterAction(s, ok('planted'), 'phu', T0);
    expect(unreadStory(s, 'su')).toBe(1);
    readLetters(s, 'su');
    expect(unreadStory(s, 'su')).toBe(0);
    expect(unreadStory(s, 'phu')).toBe(1);
  });
});
