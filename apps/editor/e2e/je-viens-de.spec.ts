import { expect, test } from '@playwright/test';

test('Aide > Je viens de Photoshop : touches comparées et préréglage en un clic', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'help', helpTab: 'start' }));
  await page.getByTestId('help-tab-switch').click();
  const table = page.getByTestId('switch-table');
  await expect(table).toContainText('Tampon');
  await expect(table).not.toContainText('tool.');
  await page.getByTestId('switch-use').click();
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().settings.keyPreset)).toBe('photoshop');
  await page.getByTestId('switch-illustrator').click();
  await expect(table).not.toContainText('tool.');
  await expect(page.getByTestId('switch-use')).toBeVisible();
});
