import { describe, expect, it } from 'vitest';
import { newFarm } from './farm';
import { deliverFestival, festivalAt } from './festival';

/** A Vietnam-local time on a calendar date (UTC+7). */
const vn = (date: string, h = 9) => Date.parse(`${date}T00:00:00Z`) + (h - 7) * 3_600_000;

describe('festivals', () => {
  it('runs for three Vietnam days from the lunar holiday', () => {
    expect(festivalAt(vn('2026-02-16', 23))).toBeNull();
    expect(festivalAt(vn('2026-02-17', 0))?.kind).toBe('tet');
    expect(festivalAt(vn('2026-02-19', 23))?.kind).toBe('tet');
    expect(festivalAt(vn('2026-02-20', 0))).toBeNull();
    expect(festivalAt(vn('2026-09-26'))?.kind).toBe('trung_thu');
    expect(festivalAt(vn('2027-02-06'))?.id).toBe('tet-2027');
    expect(festivalAt(vn('2027-09-17'))?.id).toBe('trung_thu-2027');
    expect(festivalAt(vn('2026-10-20'))).toBeNull();
  });

  it('pays once when both partners hand in their part', () => {
    const s = { ...newFarm(), xp: 100, produce: { 'strawberry:1': 4 } };
    const at = vn('2026-09-25');
    expect(deliverFestival(s, 'phu', at).msg).toBe('festival_half');
    expect(deliverFestival(s, 'phu', at).msg).toBe('duo_waiting');
    const coins = s.coins;
    expect(deliverFestival(s, 'su', at).msg).toBe('festival_done');
    expect(s.coins).toBe(coins + 100);
    expect(deliverFestival(s, 'su', at).msg).toBe('order_done');
  });

  it('does nothing outside a festival and needs the items', () => {
    const s = { ...newFarm(), xp: 100 };
    expect(deliverFestival(s, 'phu', vn('2026-10-20')).msg).toBe('no_festival');
    expect(deliverFestival(s, 'phu', vn('2026-02-17')).msg).toBe('order_missing');
  });
});
