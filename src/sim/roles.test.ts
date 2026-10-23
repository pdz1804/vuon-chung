import { describe, expect, it } from 'vitest';
import { HOUR } from './growth';
import { buySeeds, harvest, newFarm, plant, seedPrice, till, useTile, water } from './farm';
import { buyAnimal, collectEgg, fillFeeder, pet } from './animals';
import { RANK_XP, activeRank, chooseRole, gainRoleXp, hasSynergy, playerOf, rankFor, titleKey } from './roles';

const T0 = Date.UTC(2026, 9, 20, 1, 0); // 20 Oct 08:00 VN, dry
const DAY = 24 * HOUR;

function farmAt(xp: number) {
  const s = newFarm();
  s.xp = xp;
  s.coins = 5000;
  return s;
}

describe('roles', () => {
  it('unlock at level 3 and switch at most weekly', () => {
    const s = farmAt(0);
    expect(chooseRole(s, 'phu', 'grower', T0).msg).toBe('locked_roles');
    s.xp = 300;
    expect(chooseRole(s, 'phu', 'grower', T0).ok).toBe(true);
    expect(chooseRole(s, 'phu', 'rancher', T0 + 2 * DAY).msg).toBe('role_cooldown');
    expect(chooseRole(s, 'phu', 'rancher', T0 + 7 * DAY).ok).toBe(true);
  });

  it('keeps rank per role across switches and only applies the active one', () => {
    const s = farmAt(300);
    chooseRole(s, 'phu', 'grower', T0);
    playerOf(s, 'phu').roleXp.grower = RANK_XP[2];
    expect(activeRank(s, 'phu', 'grower')).toBe(3);
    chooseRole(s, 'phu', 'rancher', T0 + 8 * DAY);
    expect(activeRank(s, 'phu', 'grower')).toBe(0);
    expect(playerOf(s, 'phu').roleXp.grower).toBe(RANK_XP[2]);
  });

  it('ranks, synergy and titles', () => {
    expect(rankFor(0)).toBe(1);
    expect(rankFor(2500)).toBe(5);
    const s = farmAt(300);
    chooseRole(s, 'phu', 'grower', T0);
    chooseRole(s, 'su', 'rancher', T0);
    expect(hasSynergy(s)).toBe(true);
    gainRoleXp(s, 'phu', 'grower', 100);
    expect(playerOf(s, 'phu').roleXp.grower).toBeCloseTo(110);
    gainRoleXp(s, 'phu', 'grower', 1);
    expect(playerOf(s, 'phu').roleXp.grower).toBeCloseTo(111.1);
    expect(gainRoleXp(s, 'phu', 'rancher', 100)).toBe(0); // not the active role
    expect(titleKey(playerOf(s, 'phu'))).toBe('title.1');
  });
});

describe('perks', () => {
  it('grower: cheaper seeds (r2), wider watering (r3), extra harvest (r4)', () => {
    const s = farmAt(300);
    chooseRole(s, 'phu', 'grower', T0);
    playerOf(s, 'phu').roleXp.grower = RANK_XP[3];
    expect(seedPrice(s, 'rau_muong', 'phu')).toBe(4);
    expect(seedPrice(s, 'strawberry', 'phu')).toBe(13);
    buySeeds(s, 'rau_muong', 3, 'phu');
    for (const x of [1, 2, 3]) {
      till(s, x, 1);
      plant(s, x, 1, 'rau_muong', T0, 'phu');
    }
    water(s, 2, 1, T0, 'phu');
    expect(s.plots['1,1'].crop!.waterings).toHaveLength(1);
    expect(s.plots['3,1'].crop!.waterings).toHaveLength(1);
    harvest(s, 2, 1, T0 + 4 * HOUR, 'phu');
    expect(s.produce['rau_muong:2']).toBe(1); // bonus item only on 3★
    useTile(s, 1, 1, 'rau_muong', T0 + HOUR, 'su'); // partner tends: both hands
    harvest(s, 1, 1, T0 + 4 * HOUR, 'phu');
    expect(s.produce['rau_muong:3']).toBe(2);
  });

  it('florist: flowers +1 star at r3', () => {
    const s = farmAt(300);
    chooseRole(s, 'su', 'florist', T0);
    playerOf(s, 'su').roleXp.florist = RANK_XP[2];
    s.seeds.sunflower = 1;
    till(s, 1, 1);
    plant(s, 1, 1, 'sunflower', T0, 'su');
    water(s, 1, 1, T0, 'su');
    harvest(s, 1, 1, T0 + 24 * HOUR, 'su');
    expect(s.produce['sunflower:3']).toBe(1);
  });

  it('rancher: extra heart (r2), half feed (r3), better and double eggs (r4, r5)', () => {
    const s = farmAt(300);
    buyAnimal(s, 'chicken', 'Bông', T0);
    chooseRole(s, 'phu', 'rancher', T0);
    playerOf(s, 'phu').roleXp.rancher = RANK_XP[4];
    const coins = s.coins;
    fillFeeder(s, T0, 'phu');
    expect(coins - s.coins).toBe(2);
    pet(s, s.animals[0].id, 'phu', T0);
    expect(s.animals[0].hearts).toBe(2);
    pet(s, s.animals[0].id, 'su', T0);
    collectEgg(s, s.animals[0].id, T0, 'phu');
    expect(s.produce['egg:2']).toBe(2);
  });
});
