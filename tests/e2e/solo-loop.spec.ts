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
