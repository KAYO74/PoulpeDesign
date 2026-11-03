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

test('le champ de recherche n’est jamais coupé : visible en entier ou masqué', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  for (const width of [1440, 1200, 1100, 1024]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/');
    await expect(page.getByTestId('canvas')).toBeVisible();
    const pill = page.getByTestId('search-pill');
    if (await pill.isVisible()) await expect(pill).toBeInViewport({ ratio: 1 });
  }
});
