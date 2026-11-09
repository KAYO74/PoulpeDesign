import { expect, test } from '@playwright/test';

/* Réduction du bruit : calque de réglage avec luminance et couleur. */

test('ajoute une réduction du bruit et règle ses curseurs', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('persona-photo').click();
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 150;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3366cc';
    g.fillRect(0, 0, 200, 150);
    (window as any).poulpe.photo.openPhotoDocument(c.toDataURL('image/png'), 'image/png', 200, 150, 'Test');
  });
  await page.waitForTimeout(300);
  await page.getByRole('toolbar').getByTestId('add-adjustment').click();
  await page.getByTestId('adjustment-denoise').click();
  const adj = () =>
    page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[1].adjustment);
  expect(await adj()).toEqual({ kind: 'denoise', luminance: 40, color: 50 });
  await page.getByTestId('adjustment-panel').getByLabel('Couleur').fill('90');
  await expect.poll(async () => (await adj()).color).toBe(90);
});
