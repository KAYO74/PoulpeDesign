import { expect, test } from '@playwright/test';

/* Une fenêtre chargée à la demande qui ne vient pas : message « Recharger la page », pas d'écran blanc. */

test('si une fenêtre ne se charge pas, on propose de recharger la page', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.route(/HelpDialog/, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'help', helpTab: 'start' }));
  await expect(page.getByTestId('load-error')).toBeVisible();
  await expect(page.getByTestId('load-error-reload')).toHaveText('Recharger la page');
  // L'appli reste utilisable : on ferme le message et le dessin est toujours là.
  await page.getByTestId('load-error-close').click();
  await expect(page.getByTestId('load-error')).toBeHidden();
  await expect(page.getByTestId('canvas')).toBeVisible();
  // Une autre fenêtre s'ouvre normalement.
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'about' }));
  await expect(page.getByRole('dialog')).toBeVisible();
});
