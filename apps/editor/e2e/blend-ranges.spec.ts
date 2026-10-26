import { expect, test } from '@playwright/test';

/* Plages de fusion : un calque s'efface selon la luminosité de ce qui est dessous. */

test('le rectangle disparaît sur le fond blanc quand les blancs du dessous sont exclus', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 420, { steps: 4 });
  await page.mouse.up();
  await page.mouse.move(box.x + 5, box.y + 5);
  const clip = { x: box.x + 350, y: box.y + 350, width: 10, height: 10 };
  const before = await page.screenshot({ clip });

  await page.getByRole('button', { name: 'Calque' }).click();
  await page.getByRole('menuitem', { name: 'Plages de fusion…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plages de fusion' });
  await expect(dialog).toBeVisible();
  const under = page.getByTestId('blend-under').locator('input');
  await under.nth(3).fill('120');
  await under.nth(2).fill('100');
  await page.getByTestId('blend-apply').click();
  await expect(dialog).toBeHidden();

  const r = await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].blendRanges);
  expect(r).toEqual({ layer: [0, 0, 255, 255], under: [0, 0, 100, 120] });
  await page.mouse.move(box.x + 5, box.y + 5);
  // Le rectangle laisse voir le fond blanc ; Annuler le fait revenir.
  await expect.poll(async () => (await page.screenshot({ clip })).equals(before)).toBe(false);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await page.screenshot({ clip })).equals(before)).toBe(true);
});
