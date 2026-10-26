import { describe, expect, it } from 'vitest';
import { newFarm, plant, till, water } from './farm';
import { isQuietHour, newNotifyEvents, notificationText, reminderFor } from './notify';

// 08:00 in Vietnam on a dry day.
const T0 = Date.UTC(2026, 9, 20, 1, 0);

describe('notifications', () => {
  it('only new letters, harvests and memories notify', () => {
    const old = { t: 1, uid: 'su', msg: 'harvested' };
    const after = [{ t: 3, uid: 'su', msg: 'letter_sent' }, { t: 2, uid: 'su', msg: 'shipped' }, old];
    expect(newNotifyEvents([old], after).map((e) => e.msg)).toEqual(['letter_sent']);
  });

  it('never puts letter text in the notification', () => {
    const n = notificationText('letter_sent', 'en', 'Su');
    expect(n.body).toBe('Su sent you a letter 💌');
  });

  it('is quiet from 22:00 to 07:30 Vietnam time', () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 20, h - 7, m);
    expect(isQuietHour(at(21, 59))).toBe(false);
    expect(isQuietHour(at(22))).toBe(true);
    expect(isQuietHour(at(7, 29))).toBe(true);
    expect(isQuietHour(at(7, 30))).toBe(false);
  });

  it('reminds about ready crops before thirsty ones', () => {
    const s = { ...newFarm(), firstCropUsed: true };
    expect(reminderFor(s, T0)).toBeNull();
    till(s, 2, 2);
    plant(s, 2, 2, 'rau_muong', T0);
    expect(reminderFor(s, T0)).toBe('thirsty');
    water(s, 2, 2, T0);
    expect(reminderFor(s, T0 + 5 * 3_600_000)).toBe('ready');
  });
});
