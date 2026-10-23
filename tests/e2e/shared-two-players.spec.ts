import { expect, test, type Page } from '@playwright/test';

// Runs against the Firebase emulators (npm run test:shared): two separate
// browser contexts sign in as two people and share one garden.

interface Qa {
  scene: { player: { setPosition(x: number, y: number): void }; facing: string };
  farm(): { plots: Record<string, { crop?: { species: string } }> };
  partners: Map<string, unknown>;
}
declare global {
  interface Window {
    __qa: Qa;
  }
}

async function signIn(page: Page, name: string) {
  await page.locator('#test-name').fill(name);
  await page.locator('#test-login button').click();
}

async function standFacing(page: Page, x: number, y: number) {
  await page.evaluate(
    ([tx, ty]) => {
      window.__qa.scene.player.setPosition(tx * 16 + 8, (ty - 1) * 16 + 4);
      window.__qa.scene.facing = 'down';
    },
    [x, y],
  );
}

test('two partners share one garden and see each other', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Alice creates the garden and gets an invite link.
  await a.goto('/?emu=1#qa');
  await signIn(a, 'alice');
  await a.locator('#looks button[data-look="su"]').click();
  await a.locator('#create').click();
  await expect(a.locator('#invite-link')).toHaveValue(/\?join=[a-z2-9]{26}$/);
  const link = await a.locator('#invite-link').inputValue();
  await a.locator('#enter').click();
  await a.waitForFunction(() => window.__qa);
  await expect(a.locator('#invite')).toBeVisible();

  // Bob opens the link, signs in, and lands in the same garden.
  const url = new URL(link);
  await b.goto(`/?join=${url.searchParams.get('join')}&emu=1#qa`);
  await signIn(b, 'bob');
  await b.waitForFunction(() => window.__qa);

  // Each sees the other's avatar; Alice's invite button disappears.
  await a.waitForFunction(() => window.__qa.partners.size === 1);
  await b.waitForFunction(() => window.__qa.partners.size === 1);
  await expect(a.locator('#invite')).toBeHidden();

  // Alice tills and plants; Bob's copy of the farm updates.
  await standFacing(a, 12, 11);
  await a.keyboard.press('Space');
  await b.waitForFunction(() => '12,11' in window.__qa.farm().plots);
  await a.waitForTimeout(400);
  await a.keyboard.press('Space');
  await b.waitForFunction(() => window.__qa.farm().plots['12,11'].crop?.species === 'rau_muong');

  // An invite can't be reused by a third person.
  const c = await (await browser.newContext()).newPage();
  await c.goto(`/?join=${url.searchParams.get('join')}&emu=1`);
  await signIn(c, 'carol');
  await expect(c.locator('#lobby-error')).not.toBeEmpty();
});

test('an invite wins over a garden you started alone', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();

  // Bob starts a solo garden first.
  await b.goto('/?emu=1#qa');
  await signIn(b, 'bob2');
  await b.locator('#create').click();
  await b.locator('#enter').click();
  await b.waitForFunction(() => window.__qa);

  await a.goto('/?emu=1#qa');
  await signIn(a, 'alice2');
  await a.locator('#create').click();
  await expect(a.locator('#invite-link')).toHaveValue(/join=/);
  const code = new URL(await a.locator('#invite-link').inputValue()).searchParams.get('join');
  await a.locator('#enter').click();
  await a.waitForFunction(() => window.__qa);

  // Opening Alice's link moves Bob into her garden.
  await b.goto(`/?join=${code}&emu=1#qa`);
  await b.waitForFunction(() => window.__qa);
  await a.waitForFunction(() => window.__qa.partners.size === 1);
  await expect(a.locator('#invite')).toBeHidden();
});
