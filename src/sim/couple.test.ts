import { describe, expect, it } from 'vitest';
import { HOUR } from './growth';
import { harvest, newFarm, plant, till, useTile, water } from './farm';
import {
  LETTER_MAX,
  addMemory,
  awaySummary,
  logEvent,
  partnerTendedToday,
  readLetters,
  sendLetter,
  treeStage,
  unreadFor,
} from './couple';

const T0 = Date.UTC(2026, 9, 20, 1, 0); // 20 Oct 08:00 VN, a dry day

describe('both hands', () => {
  it('gives the third star when both partners care on the same day, hours apart', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    till(s, 1, 1);
    plant(s, 1, 1, 'rau_muong', T0, 'phu');
    water(s, 1, 1, T0, 'phu');
    expect(partnerTendedToday(s.plots['1,1'].crop!, 'su', T0)).toBe(true);
    // Su tends it later that day: the plant is already wet, so it counts as care.
    expect(useTile(s, 1, 1, 'rau_muong', T0 + 3 * HOUR, 'su').msg).toBe('tended_both');
    harvest(s, 1, 1, T0 + 4 * HOUR);
    expect(s.produce['rau_muong:3']).toBe(1);
  });

  it('does not count care on different days', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    till(s, 1, 1);
    s.seeds.sunflower = 1;
    plant(s, 1, 1, 'sunflower', T0, 'phu');
    water(s, 1, 1, T0, 'phu');
    useTile(s, 1, 1, 'sunflower', T0 + 20 * HOUR, 'su'); // next VN day
    harvest(s, 1, 1, T0 + 26 * HOUR);
    expect(s.produce['sunflower:3']).toBeUndefined();
  });

  it('tending twice the same day by the same person does nothing', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    till(s, 1, 1);
    plant(s, 1, 1, 'rau_muong', T0, 'phu');
    water(s, 1, 1, T0, 'phu');
    expect(useTile(s, 1, 1, 'rau_muong', T0 + HOUR, 'phu').msg).toBe('growing');
  });
});

describe('letters', () => {
  it('sends, counts unread for the partner only, and marks read', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    expect(sendLetter(s, 'phu', '   ', T0).msg).toBe('letter_empty');
    sendLetter(s, 'phu', 'Chào em 🌱', T0);
    expect(unreadFor(s, 'su')).toBe(1);
    expect(unreadFor(s, 'phu')).toBe(0);
    expect(readLetters(s, 'su').ok).toBe(true);
    expect(unreadFor(s, 'su')).toBe(0);
    sendLetter(s, 'su', 'x'.repeat(LETTER_MAX + 50), T0);
    expect(s.letters[0].text).toHaveLength(LETTER_MAX);
  });
});

describe('memories', () => {
  it('grows the tree, sorts by date and gives XP', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    expect(addMemory(s, 'phu', 'nope', 'x', T0).msg).toBe('memory_date');
    expect(treeStage(s)).toBe(0);
    addMemory(s, 'phu', '2024-02-14', 'Lần đầu gặp nhau', T0);
    addMemory(s, 'su', '2023-12-24', 'Noel', T0);
    expect(s.memories[0].title).toBe('Noel');
    expect(treeStage(s)).toBe(1);
    expect(s.xp).toBe(30);
  });
});

describe('away summary', () => {
  it("counts only the partner's events since you left", () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    logEvent(s, { t: T0, uid: 'su', msg: 'harvested' });
    logEvent(s, { t: T0 + 1, uid: 'su', msg: 'harvested' });
    logEvent(s, { t: T0 + 2, uid: 'phu', msg: 'shipped' });
    logEvent(s, { t: T0 - 10, uid: 'su', msg: 'letter_sent' });
    expect(awaySummary(s, 'phu', T0 - 1)).toEqual({ harvested: 2 });
  });
});

describe('verifier regressions', () => {
  it('only says "both hands" when both cared today', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    till(s, 1, 1);
    s.seeds.sunflower = 1;
    plant(s, 1, 1, 'sunflower', T0, 'phu');
    water(s, 1, 1, T0, 'phu');
    expect(useTile(s, 1, 1, 'sunflower', T0 + HOUR, 'su').msg).toBe('tended_both');
    // Two days later only Phú tends it: plain "tended".
    expect(useTile(s, 1, 1, 'sunflower', T0 + 30 * HOUR, 'phu').msg).not.toMatch(/both/);
  });

  it('rejects impossible dates and caps memories', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    expect(addMemory(s, 'phu', '2026-13-45', 'x', T0).msg).toBe('memory_date');
    s.memories = Array.from({ length: 400 }, (_, i) => ({
      id: String(i),
      date: '2024-01-01',
      title: 't',
      by: 'p',
      t: 0,
    }));
    expect(addMemory(s, 'phu', '2024-01-02', 'one more', T0).msg).toBe('memory_full');
  });

  it('never splits an emoji when trimming a long letter', () => {
    const s = { ...newFarm(), firstCropUsed: true }; // an established garden: normal growth times
    sendLetter(s, 'phu', '🌱'.repeat(LETTER_MAX + 5), T0);
    expect(Array.from(s.letters[0].text)).toHaveLength(LETTER_MAX);
    expect(s.letters[0].text.endsWith('🌱')).toBe(true);
  });
});
