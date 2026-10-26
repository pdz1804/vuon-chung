import { expect, test, type Page } from '@playwright/test';
import type { FarmState } from '../../src/sim/farm';

// Shape of the `window.__qa` hook the game exposes when the URL hash is #qa.
interface QaHook {
  view: { player: { x: number; y: number; facing: string }; animalPos: Map<string, { x: number; y: number }> };
  farm(): FarmState;
  refresh(): void;
}
type QaWindow = Window & { __qa: QaHook };

// Fast dev clock: 1 real second = 1 game hour, own save slot.
const URL = '/?speed=3600#qa';

// Pin the game clock to 20 Oct 2026 08:00 in Vietnam, a dry day: the weather is
// seeded from the date, so a real "today" can rain and water plots on its own.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vuon-chung:dev-clock', String(Date.UTC(2026, 9, 20, 1, 0))));
});

async function standFacing(page: Page, x: number, y: number) {
  // Stand one tile above the target and face down.
  await page.evaluate(
    ([tx, ty]) => {
      // Player positions are in tiles; stand in the middle of the tile above.
      const p = (window as unknown as QaWindow).__qa.view.player;
      p.x = tx + 0.5;
      p.y = ty - 0.5;
      p.facing = 'down';
    },
    [x, y],
  );
}

test('solo loop: till, plant, water, grow, harvest, ship', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => (window as unknown as QaWindow).__qa);
  const farm = () => page.evaluate(() => (window as unknown as QaWindow).__qa.farm());
  const use = async () => {
    const act = page.locator('#act');
    if (await act.isVisible()) await act.click();
    else await page.keyboard.press('Space');
  };

  await standFacing(page, 12, 11);
  await use(); // till
  expect((await farm()).plots['12,11']).toBeDefined();
  await use(); // plant rau muống
  expect((await farm()).plots['12,11'].crop?.species).toBe('rau_muong');
  await use(); // water
  expect((await farm()).plots['12,11'].crop.waterings.length).toBe(1);
  await expect(page.locator('#toast')).toContainText(/tưới|Watered/);

  // 4 game hours of hydrated growth ≈ 4–5 real seconds.
  await page.waitForTimeout(5500);
  await use(); // harvest
  const f = await farm();
  expect(f.plots['12,11'].crop).toBeUndefined();
  expect(Object.values(f.produce).reduce((a, b) => a + b, 0)).toBe(1);

  await standFacing(page, 9, 4); // shipping bin
  await use();
  expect(Object.keys((await farm()).bin).length).toBe(1);
  await expect(page.locator('#binval')).not.toBeEmpty();
});

test('language toggle switches HUD text', async ({ page }) => {
  await page.goto(URL);
  await page.waitForFunction(() => (window as unknown as QaWindow).__qa);
  await page.evaluate(() => localStorage.removeItem('vuon-chung:lang'));
  await page.reload();
  await page.waitForFunction(() => (window as unknown as QaWindow).__qa);
  await expect(page.locator('#lang')).toHaveText('EN');
  await expect(page.locator('#help, #act').first()).toContainText(/Di chuyển|Làm/);
  await page.locator('#lang').click();
  await expect(page.locator('#lang')).toHaveText('VI');
  await expect(page.locator('#bag')).toContainText('Bag');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(page).toHaveTitle('Vườn Chung');
});

test('order board unlocks at level 2 and pays for a delivery', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => window.__qa);
  await standFacing(page, 21, 4); // order board
  await page.keyboard.press('Space');
  await expect(page.locator('#toast')).toContainText(/cấp 2|level 2/i);

  // Reach level 2 and stock the bag with plenty of every crop.
  await page.evaluate(() => {
    const f = window.__qa.farm() as unknown as { xp: number; produce: Record<string, number> };
    f.xp = 100;
    for (const s of ['rau_muong', 'strawberry', 'sunflower']) f.produce[`${s}:1`] = 10;
    window.__qa.refresh();
  });
  await page.keyboard.press('Space');
  await expect(page.locator('#orders')).toBeVisible();
  const coins = await page.evaluate(() => (window.__qa.farm() as unknown as { coins: number }).coins);
  await page.locator('#orders-list button').first().click();
  await expect(page.locator('#orders-list button').first()).toHaveText('✓');
  expect(await page.evaluate(() => (window.__qa.farm() as unknown as { coins: number }).coins)).toBeGreaterThan(coins);
});

test('typing a letter keeps every key (spaces, WASD, digits)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'physical keyboard only');
  await page.goto(URL);
  await page.waitForFunction(() => window.__qa);
  await standFacing(page, 7, 4); // mailbox
  await page.keyboard.press('Space');
  await expect(page.locator('#mail')).toBeVisible();
  await page.locator('#mail-text').click();
  await page.keyboard.type('hello world wasd e 1234');
  await expect(page.locator('#mail-text')).toHaveValue('hello world wasd e 1234');
});

test('chickens: buy a chick, fill the feeder, pet it and collect an egg', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => window.__qa);
  await page.evaluate(() => {
    const f = window.__qa.farm() as unknown as { xp: number; coins: number };
    f.xp = 100;
    f.coins = 1000;
    window.__qa.refresh();
  });
  await standFacing(page, 2, 8); // coop opens the shop
  await page.keyboard.press('Space');
  await page
    .locator('#shop-list .shop-row', { hasText: /Gà con|Chick/ })
    .locator('button')
    .click();
  await page.locator('#shop-close').click();
  type F = { animals: { id: string; hearts: number }[]; produce: Record<string, number>; feederDay: string };
  await expect.poll(() => page.evaluate(() => (window.__qa.farm() as unknown as F).animals.length)).toBe(1);

  await standFacing(page, 5, 9); // feeder
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window.__qa.farm() as unknown as F).feederDay)).not.toBe('');

  // Walk up to the chicken wherever it wandered and use it twice: pet, then egg.
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const v = window.__qa.view;
      const c = [...v.animalPos.values()][0];
      v.player.x = c.x;
      v.player.y = c.y - 1;
      v.player.facing = 'down';
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }
  const f = await page.evaluate(() => window.__qa.farm() as unknown as F);
  expect(f.animals[0].hearts).toBe(1);
  expect(f.produce['egg:1']).toBe(1);
});

test('roles unlock at level 3 and can be picked', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => window.__qa);
  await expect(page.locator('#roles-btn')).toBeHidden();
  await page.evaluate(() => {
    (window.__qa.farm() as unknown as { xp: number }).xp = 300;
    window.__qa.refresh();
  });
  await page.locator('#roles-btn').click();
  await expect(page.locator('#roles-list .role')).toHaveCount(3);
  await page.locator('#roles-list .role').first().locator('button').click();
  await expect(page.locator('#roles-list .role.mine')).toHaveCount(1);
  await expect(page.locator('#roles-btn')).toHaveAttribute('title', /Nhà nông|Grower/);
});

test('kitchen opens at level 5 from the house door and cooks a dish', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => window.__qa);
  await page.evaluate(() => {
    const f = window.__qa.farm() as unknown as { xp: number; produce: Record<string, number> };
    f.xp = 1100;
    f.produce['strawberry:2'] = 4;
    window.__qa.refresh();
  });
  await standFacing(page, 5, 4); // house front wall
  await page.keyboard.press('Space');
  await expect(page.locator('#kitchen')).toBeVisible();
  await page
    .locator('#kitchen-list .recipe', { hasText: /Mứt dâu|Strawberry jam/ })
    .locator('button')
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window.__qa.farm() as unknown as { produce: Record<string, number> }).produce['mut_dau:2']),
    )
    .toBe(1);
});

test('dialog buttons work from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'physical keyboard only');
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => window.__qa);
  await standFacing(page, 24, 4); // Cô Ba's stall
  await page.keyboard.press('Space');
  await expect(page.locator('#shop')).toBeVisible();
  const coins = await page.evaluate(() => window.__qa.farm().coins);
  await page.locator('#shop-list .shop-row button').first().focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__qa.farm().coins)).toBeLessThan(coins);
  await page.locator('#shop-close').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#shop')).toBeHidden();
});

test('first-time tutorial advances with play and stays skipped after a reload', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  const coach = page.locator('#coach');
  await expect(coach).toBeVisible();
  await expect(coach.locator('small')).toHaveText('1/6');
  await page.keyboard.press('ArrowLeft');
  await expect(coach.locator('small')).toHaveText('2/6');
  await coach.locator('button').click();
  await expect(coach).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => (window as unknown as QaWindow).__qa);
  await expect(coach).toBeHidden();
});

test('tutorial skips ahead when a later step is done first and resumes after a reload', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => (window as unknown as QaWindow).__qa);
  await standFacing(page, 10, 10);
  await page.keyboard.press('Space'); // till without walking first
  await expect(page.locator('#coach small')).toHaveText('3/6');
  await page.reload();
  await expect(page.locator('#coach small')).toHaveText('3/6');
});

test('fishing at the pond: cast, reel on the bite, and the catch pays out', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => (window as unknown as QaWindow).__qa);
  await page.evaluate(() => {
    (window as unknown as QaWindow).__qa.farm().xp = 100;
    (window as unknown as QaWindow).__qa.refresh();
  });
  await standFacing(page, 26, 13); // pond's north shore
  await page.keyboard.press('Space');
  await expect(page.locator('#fish')).toBeVisible();
  const coins = await page.evaluate(() => (window as unknown as QaWindow).__qa.farm().coins);
  await page.locator('#fish-btn').click();
  // Reel from inside the page the moment the bobber dips: a slow CI round trip could
  // otherwise miss the 0.7 s window.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const bobber = document.querySelector('#fish-bobber')!;
        new MutationObserver((_, obs) => {
          if (!bobber.classList.contains('bite')) return;
          obs.disconnect();
          document.querySelector<HTMLButtonElement>('#fish-btn')!.click();
          done();
        }).observe(bobber, { attributes: true });
      }),
  );
  await expect
    .poll(() => page.evaluate(() => (window as unknown as QaWindow).__qa.farm().coins))
    .toBeGreaterThan(coins);
  await page.keyboard.press('Escape');
  await expect(page.locator('#fish')).toBeHidden();
});

test('the meadow gate stays shut until level 3, then the meadow gives seeds', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => (window as unknown as QaWindow).__qa);
  await standFacing(page, 23, 19); // the meadow gate
  await page.keyboard.press('Space');
  await expect(page.locator('#toast')).toContainText(/3/);
  await page.evaluate(() => {
    (window as unknown as QaWindow).__qa.farm().xp = 300;
    (window as unknown as QaWindow).__qa.refresh();
  });
  await standFacing(page, 16, 19); // the gathering spot
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as unknown as QaWindow).__qa.farm().seeds.sunflower)).toBe(2);
});

test('planting brings the first story letter, and villagers say their line', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => (window as unknown as QaWindow).__qa);
  await standFacing(page, 10, 10);
  await page.keyboard.press('Space'); // till
  await page.keyboard.press('Space'); // plant
  await expect.poll(() => page.evaluate(() => (window as unknown as QaWindow).__qa.farm().story?.beat)).toBe(1);
  await standFacing(page, 7, 4); // mailbox
  await page.keyboard.press('Space');
  await expect(page.locator('#mail .letter.story')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await standFacing(page, 20, 5); // Ông Minh
  await page.keyboard.press('Space');
  await expect(page.locator('#toast')).toContainText(/Ông Minh|Grandpa Minh/);
});
