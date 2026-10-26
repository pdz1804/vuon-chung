import { expect, test, type Page } from '@playwright/test';

// Runs against the Firebase emulators (npm run test:shared): two separate
// browser contexts sign in as two people and share one garden.

interface Qa {
  view: { player: { x: number; y: number; facing: string } };
  farm(): { plots: Record<string, { crop?: { species: string } }> };
  partners: { size(): number };
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
      const p = window.__qa.view.player;
      p.x = tx + 0.5;
      p.y = ty - 0.5;
      p.facing = 'down';
    },
    [x, y],
  );
}

test('two partners share one garden and see each other', async ({ browser }) => {
  const a = await (await browser.newContext({ baseURL: 'http://localhost:5240' })).newPage();
  const b = await (await browser.newContext({ baseURL: 'http://localhost:5240' })).newPage();

  // Alice creates the garden and gets an invite link.
  await a.goto('/?emu=1&norender=1#qa');
  await signIn(a, 'alice');
  await a.locator('#new-room').click();
  await a.locator('#looks button[data-look="su"]').click();
  await a.locator('#create').click();
  await expect(a.locator('#invite-link')).toHaveValue(/\?join=[a-z2-9]{26}$/);
  const link = await a.locator('#invite-link').inputValue();
  await a.locator('#enter').click();
  await a.waitForFunction(() => window.__qa);
  await expect(a.locator('#invite')).toBeVisible();

  // Bob opens the link, signs in, and lands in the same garden.
  const url = new URL(link);
  await b.goto(`/?join=${url.searchParams.get('join')}&emu=1&norender=1#qa`);
  await signIn(b, 'bob');
  await b.waitForFunction(() => window.__qa);

  // Each sees the other's avatar; Alice's invite button disappears.
  await a.waitForFunction(() => window.__qa.partners.size() === 1);
  await b.waitForFunction(() => window.__qa.partners.size() === 1);
  await expect(a.locator('#invite')).toBeHidden();

  // Alice tills and plants; Bob's copy of the farm updates.
  await standFacing(a, 12, 11);
  await a.keyboard.press('Space');
  await b.waitForFunction(() => '12,11' in window.__qa.farm().plots);
  await a.waitForTimeout(400);
  await a.keyboard.press('Space');
  await b.waitForFunction(() => window.__qa.farm().plots['12,11'].crop?.species === 'rau_muong');

  // A letter from Alice reaches Bob's mailbox.
  await standFacing(a, 7, 4);
  await a.keyboard.press('Space');
  await expect(a.locator('#mail')).toBeVisible();
  await a.locator('#mail-text').fill('Chào anh 🌱');
  await a.locator('#mail-form button').click();
  await expect(a.locator('#mail-list')).toContainText('Chào anh');
  await a.locator('#mail-close').click();
  await expect(b.locator('#toast')).toContainText(/thư|letter/i);
  await standFacing(b, 7, 4);
  await b.keyboard.press('Space');
  await expect(b.locator('#mail-list .letter:not(.story)').first()).toContainText('Chào anh');
  await b.locator('#mail-close').click();

  // A memory added by Bob shows on Alice's Memory Tree.
  await standFacing(b, 15, 3);
  await b.keyboard.press('Space');
  await b.locator('#tree-title').fill('Lần đầu gặp nhau');
  await b.locator('#tree-form button').click();
  await expect(b.locator('#tree-list')).toContainText('Lần đầu gặp nhau');
  await a.waitForFunction(() => (window.__qa.farm() as unknown as { memories: unknown[] }).memories.length === 1);

  // An emote from Alice pops up over her avatar on Bob's screen.
  await expect(a.locator('#emotes')).toBeVisible();
  await a.locator('#emotes button[data-e="❤️"]').click();
  await b.waitForFunction(() => {
    return [...document.querySelectorAll('.emote-bubble')].some((e) => e.textContent === '❤️');
  });

  // An invite can't be reused by a third person.
  const c = await (await browser.newContext({ baseURL: 'http://localhost:5240' })).newPage();
  await c.goto(`/?join=${url.searchParams.get('join')}&emu=1&norender=1`);
  await signIn(c, 'carol');
  await expect(c.locator('#lobby-error')).not.toBeEmpty();
});

test('a player can belong to several gardens and switch between them', async ({ browser }) => {
  const ctx = { baseURL: 'http://localhost:5240' };
  const a = await (await browser.newContext(ctx)).newPage();
  const b = await (await browser.newContext(ctx)).newPage();

  // Bob starts a garden of his own first, marked as a test room.
  await b.goto('/?emu=1&norender=1#qa');
  await signIn(b, 'bob2');
  await b.locator('#new-room').click();
  await b.locator('#room-name').fill('Bob solo');
  await b.locator('#room-test').check();
  await b.locator('#create').click();
  await b.locator('#enter').click();
  await b.waitForFunction(() => window.__qa);

  await a.goto('/?emu=1&norender=1#qa');
  await signIn(a, 'alice2');
  await a.locator('#new-room').click();
  await a.locator('#room-name').fill('Vườn của hai đứa');
  await a.locator('#create').click();
  await expect(a.locator('#invite-link')).toHaveValue(/join=/);
  const code = new URL(await a.locator('#invite-link').inputValue()).searchParams.get('join');
  await a.locator('#enter').click();
  await a.waitForFunction(() => window.__qa);

  // Bob joins Alice's garden: it is added, his own garden stays.
  await b.goto(`/?join=${code}&emu=1&norender=1#qa`);
  await b.waitForFunction(() => window.__qa);
  await a.waitForFunction(() => window.__qa.partners.size() === 1);

  // The room list shows both gardens, the test room with its badge.
  await b.locator('#rooms-btn').click();
  await expect(b.locator('#room-list .room')).toHaveCount(2);
  await expect(b.locator('#room-list .room', { hasText: 'Bob solo' })).toContainText(/Thử nghiệm|Test/);
  await b.locator('#room-list .room', { hasText: 'Vườn của hai đứa' }).click();
  await b.waitForFunction(() => window.__qa);
});
