import { expect, test, type Page } from '@playwright/test';

/* Agrandir par IA : le calque gagne en pixels (modèle Real-ESRGAN, sur l'ordinateur), sa taille dans le document reste. */

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
    c.width = 48;
    c.height = 36;
    const g = c.getContext('2d')!;
    for (let y = 0; y < 36; y += 3)
      for (let x = 0; x < 48; x += 3) {
        g.fillStyle = `rgb(60,${100 + ((x * 7 + y * 3) % 40)},170)`;
        g.fillRect(x, y, 3, 3);
      }
    g.fillStyle = '#dd2222';
    g.fillRect(12, 10, 14, 14);
    (window as any).poulpe.photo.openPhotoDocument(c.toDataURL('image/png'), 'image/png', 48, 36, 'Test');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
});

test('agrandit un calque ×2 en un seul pas d’historique', async ({ page }) => {
  test.setTimeout(150_000);
  const before = (await nodes(page))[0];
  await page.getByRole('button', { name: 'Édition' }).click();
  await page.getByRole('menuitem', { name: 'Agrandir par IA…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('aiupscale-size')).toContainText('48 × 36 px → 96 × 72 px');
  await page.getByTestId('aiupscale-x4').click();
  await expect(page.getByTestId('aiupscale-size')).toContainText('192 × 144 px');
  await page.getByTestId('aiupscale-x2').click();
  await page.getByTestId('aiupscale-apply').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 120_000 });

  const after = (await nodes(page))[0];
  // Même taille dans le document, plus de pixels.
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  expect(after.assetId).not.toBe(before.assetId);
  const asset = await page.evaluate(
    (id) => (window as any).poulpe.editor.doc.assets[id],
    after.assetId as string,
  );
  expect(asset.width).toBe(96);
  expect(asset.height).toBe(72);
  await page.keyboard.press('Control+z');
  expect((await nodes(page))[0].assetId).toBe(before.assetId);
});
