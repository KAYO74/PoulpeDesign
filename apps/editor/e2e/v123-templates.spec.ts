import { expect, test, type Page } from '@playwright/test';

/* 1.2.3 : formats écran HD à 8K et impression, modèles personnels (enregistrer, rouvrir, importer). */

const firstArtboard = (page: Page) =>
  page.evaluate(() => {
    const a = (window as any).poulpe.editor.getState().doc.artboards[0];
    return { width: a.width, height: a.height, count: a.children.length };
  });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings')) localStorage.setItem('poulpe.settings', '{}');
  });
  await page.goto('/');
});

test('propose les écrans jusqu’au 8K et les grands formats d’impression', async ({ page }) => {
  await page.getByTestId('new-screen').click();
  await page.getByTestId('preset-uhd8k').dblclick();
  expect(await firstArtboard(page)).toMatchObject({ width: 7680, height: 4320 });
  await page.keyboard.press('Control+N');
  await page.getByTestId('new-print').click();
  await expect(page.getByTestId('preset-a0')).toBeVisible();
  await expect(page.getByTestId('preset-poster50x70')).toBeVisible();
});

test('enregistre un design comme modèle et le réutilise', async ({ page }) => {
  await page.getByRole('dialog').getByTestId('template-giveaway').click();
  const made = await firstArtboard(page);
  await page.getByRole('button', { name: 'Fichier' }).click();
  await page.getByRole('menuitem', { name: 'Enregistrer comme modèle…' }).click();
  await page.getByTestId('template-name').fill('Mon concours');
  await page.getByTestId('template-save').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload();
  await page.getByTestId('new-mine').click();
  const card = page.getByTestId('mytpl-Mon concours');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Mon concours' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await firstArtboard(page)).toEqual(made);
});
