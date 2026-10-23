import { expect, test, type Page } from '@playwright/test';
import type { FarmState } from '../../src/sim/farm';

// Shape of the `window.__qa` hook the game exposes when the URL hash is #qa.
interface QaHook {
  scene: { player: { setPosition(x: number, y: number): void }; facing: string };
  farm(): FarmState;
}
type QaWindow = Window & { __qa: QaHook };

// Fast dev clock: 1 real second = 1 game hour, own save slot.
const URL = '/?speed=3600#qa';

async function standFacing(page: Page, x: number, y: number) {
  // Stand one tile above the target and face down.
  await page.evaluate(
    ([tx, ty]) => {
      const s = (window as unknown as QaWindow).__qa.scene;
      s.player.setPosition(tx * 16 + 8, (ty - 1) * 16 + 4);
      s.facing = 'down';
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
    if (await act.isVisible()) await act.dispatchEvent('pointerdown');
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
    (window.__qa.scene as unknown as { refresh(): void }).refresh();
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
    (window.__qa.scene as unknown as { refresh(): void }).refresh();
  });
  await standFacing(page, 2, 8); // coop opens the shop
  await page.keyboard.press('Space');
  await page.locator('#shop-list .shop-row').last().locator('button').click();
  await page.locator('#shop-close').click();
  type F = { animals: { id: string; hearts: number }[]; produce: Record<string, number>; feederDay: string };
  await expect.poll(() => page.evaluate(() => (window.__qa.farm() as unknown as F).animals.length)).toBe(1);

  await standFacing(page, 5, 9); // feeder
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window.__qa.farm() as unknown as F).feederDay)).not.toBe('');

  // Walk up to the chicken wherever it wandered and use it twice: pet, then egg.
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const s = window.__qa.scene as unknown as {
        animalSprites: Map<string, { x: number; y: number }>;
        player: { setPosition(x: number, y: number): void };
        facing: string;
        time: { paused: boolean };
      };
      const c = [...s.animalSprites.values()][0];
      s.player.setPosition(c.x, c.y - 16);
      s.facing = 'down';
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }
  const f = await page.evaluate(() => window.__qa.farm() as unknown as F);
  expect(f.animals[0].hearts).toBe(1);
  expect(f.produce['egg:1']).toBe(1);
});
