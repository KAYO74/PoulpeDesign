import { expect, test } from '@playwright/test';

/* Visite guidée : dans Aide, six étapes, on peut la passer ou la terminer. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('la visite guidée se lance depuis Aide et se parcourt jusqu’au bout', async ({ page }) => {
  // Jamais ouverte toute seule dans un navigateur piloté.
  await expect(page.getByTestId('tour')).toBeHidden();
  await page.getByRole('button', { name: 'Aide' }).click();
  await page.getByRole('menuitem', { name: 'Visite guidée' }).click();
  const tour = page.getByTestId('tour');
  await expect(tour).toContainText('Cinq onglets en haut');
  for (let i = 0; i < 5; i++) await page.getByTestId('tour-next').click();
  await expect(tour).toContainText('Enregistrer et exporter');
  await expect(page.getByTestId('tour-skip')).toHaveCount(0);
  await page.getByTestId('tour-next').click();
  await expect(tour).toBeHidden();
});

test('on peut passer la visite à tout moment', async ({ page }) => {
  await page.getByRole('button', { name: 'Aide' }).click();
  await page.getByRole('menuitem', { name: 'Visite guidée' }).click();
  await page.getByTestId('tour-skip').click();
  await expect(page.getByTestId('tour')).toBeHidden();
});
