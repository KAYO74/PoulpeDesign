import { expect, test } from '@playwright/test';

/* Onglets de documents : « + » ouvre un nouveau document, chaque onglet garde son contenu. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

const nodes = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const d = (window as any).poulpe.editor.doc;
    return d.artboards.reduce((n: number, a: any) => n + a.children.length, 0);
  });

test('le « + » ouvre un nouvel onglet, chaque document garde son contenu', async ({ page }) => {
  await expect(page.getByTestId('doc-tab')).toHaveCount(1);
  // Dessine un rectangle dans le premier document.
  await page.keyboard.press('u');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 300, { steps: 6 });
  await page.mouse.up();
  expect(await nodes(page)).toBe(1);

  await page.getByTestId('doc-tab-new').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('new-create').click();
  await expect(page.getByTestId('doc-tab')).toHaveCount(2);
  expect(await nodes(page)).toBe(0);

  await page.getByTestId('doc-tab').first().click();
  expect(await nodes(page)).toBe(1);
  await page.getByTestId('doc-tab').nth(1).click();
  expect(await nodes(page)).toBe(0);

  // Fermer l'onglet actif revient à l'autre document.
  await page.getByTestId('doc-tab').nth(1).getByRole('button').click();
  await expect(page.getByTestId('doc-tab')).toHaveCount(1);
  expect(await nodes(page)).toBe(1);
});
