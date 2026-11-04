import { expect, test } from '@playwright/test';

/* Panneau Calques : un petit « + » à côté de la poubelle crée un nouveau calque. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

const count = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children.length);

test('le + à côté de la poubelle ajoute un calque, puis la poubelle le retire', async ({ page }) => {
  const add = page.getByTestId('layers-add');
  const del = page.getByTestId('layers-delete');
  await expect(add).toBeVisible();
  // Le + est juste avant la poubelle, dans la même barre.
  const a = (await add.boundingBox())!;
  const d = (await del.boundingBox())!;
  expect(a.x).toBeLessThan(d.x);
  expect(Math.abs(a.y - d.y)).toBeLessThan(4);
  expect(d.x - (a.x + a.width)).toBeLessThan(12);

  const before = await count(page);
  await add.click();
  await expect.poll(() => count(page)).toBe(before + 1);
  await expect(del).toBeEnabled(); // le nouveau calque est sélectionné
  await del.click();
  await expect.poll(() => count(page)).toBe(before);
});

test('le + existe aussi dans la Persona Photo', async ({ page }) => {
  await page.evaluate(() => (window as any).poulpe.ui.set({ persona: 'photo' }));
  const before = await count(page);
  await page.getByTestId('layers-add').click();
  await expect.poll(() => count(page)).toBe(before + 1);
});
