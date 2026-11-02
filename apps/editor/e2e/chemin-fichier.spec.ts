import { expect, test } from '@playwright/test';

/* Ouvrir ou enregistrer sous un chemin tapé : réservé à l'appli de bureau. */

test('le menu Fichier n’offre pas les chemins dans le navigateur, la fenêtre s’ouvre sinon', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Fichier' }).click();
  await expect(page.getByRole('menuitem', { name: 'Ouvrir un chemin…' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'pathEntry' }));
  await expect(page.getByTestId('path-input')).toBeVisible();
  await expect(page.getByTestId('path-go')).toBeDisabled();
  await page.getByTestId('path-input').fill('/tmp/x.poulpe');
  await expect(page.getByTestId('path-go')).toBeEnabled();
});
