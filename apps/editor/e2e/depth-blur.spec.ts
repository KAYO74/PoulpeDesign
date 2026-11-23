import { expect, test, type Page } from '@playwright/test';

/* Flou d'objectif : profondeur estimée par le modèle (sur l'ordinateur), plan net choisi sur l'aperçu. */

type AnyNode = Record<string, any>;
const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('persona-photo').click();
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const g = c.getContext('2d')!;
    for (let y = 0; y < 48; y += 4)
      for (let x = 0; x < 64; x += 4) {
        g.fillStyle = (x + y) % 8 ? '#223355' : '#ddddaa';
        g.fillRect(x, y, 4, 4);
      }
    g.fillStyle = '#dd2222';
    g.fillRect(24, 16, 16, 16);
    (window as any).poulpe.photo.openPhotoDocument(c.toDataURL('image/png'), 'image/png', 64, 48, 'Test');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
});

test('floute selon la profondeur en un seul pas d’historique', async ({ page }) => {
  test.setTimeout(150_000);
  const before = (await nodes(page))[0];
  await page.getByRole('button', { name: 'Édition' }).click();
  await page.getByRole('menuitem', { name: "Flou d'objectif (profondeur)…" }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // Le modèle estime la profondeur, puis l'aperçu et les réglages s'activent.
  await expect(page.getByTestId('depthblur-apply')).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByTestId('depthblur-loading')).toHaveCount(0);
  await page.getByTestId('depthblur-showdepth').check();
  await page.getByTestId('depthblur-showdepth').uncheck();
  await page.getByTestId('depthblur-preview').click({ position: { x: 30, y: 30 } });
  await page.getByTestId('depthblur-apply').click();
  await expect(page.getByRole('dialog')).toBeHidden();

  const after = (await nodes(page))[0];
  expect(after.assetId).not.toBe(before.assetId);
  const asset = await page.evaluate(
    (id) => (window as any).poulpe.editor.doc.assets[id],
    after.assetId as string,
  );
  expect(asset.width).toBe(64);
  expect(asset.height).toBe(48);
  await page.keyboard.press('Control+z');
  expect((await nodes(page))[0].assetId).toBe(before.assetId);
});
