import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/* Photos HEIC (iPhone…) : lues par le décodeur Rust, importées, vignettées et ouvertes comme les autres. */

const HEIC = readFileSync(new URL('./fixtures/gradient48x32.heic', import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
});

test('importe une photo HEIC dans la bibliothèque et l’ouvre en Persona Photo', async ({ page }) => {
  await page.getByTestId('persona-library').click();
  const lib = page.getByTestId('photo-library');
  await page.getByTestId('plib-files').setInputFiles([
    { name: 'iphone.heic', mimeType: 'image/heic', buffer: HEIC },
    { name: 'abimee.heic', mimeType: 'image/heic', buffer: Buffer.from('pas une photo') },
  ]);
  // La photo valide a sa vignette ; le fichier abîmé est ignoré sans bloquer l’import.
  await expect(lib.getByRole('option')).toHaveCount(1);
  await expect(lib.getByRole('option', { name: 'iphone.heic' })).toBeVisible();
  const thumb = await lib.getByRole('option').locator('img').first().getAttribute('src');
  expect(thumb).toMatch(/^data:image\/jpeg/);

  await lib.getByRole('option', { name: 'iphone.heic' }).dblclick();
  await expect(lib).toBeHidden();
  await expect(page.getByTestId('persona-photo')).toHaveAttribute('aria-pressed', 'true');
  const size = await page.evaluate(() => {
    const doc = (window as any).poulpe.editor.doc;
    return [doc.artboards[0].width, doc.artboards[0].height];
  });
  expect(size).toEqual([48, 32]);
});
