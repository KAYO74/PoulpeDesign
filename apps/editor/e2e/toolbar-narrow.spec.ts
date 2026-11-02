import { expect, test } from '@playwright/test';

/* Fenêtre étroite : Annuler, Rétablir et Exporter restent visibles même quand la barre déborde. */

test('Exporter reste visible quand la barre du haut déborde', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exporter', exact: true })).toBeInViewport({ ratio: 1 });
});
