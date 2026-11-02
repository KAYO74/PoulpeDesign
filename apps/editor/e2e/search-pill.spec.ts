import { expect, test } from '@playwright/test';

/* Champ de recherche visible dans la barre du haut : un clic ouvre « Que voulez-vous faire ? ». */

test('le champ de recherche de la barre du haut ouvre la recherche de commandes', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('search-pill').click();
  await expect(page.getByTestId('palette-input')).toBeFocused();
});
