import { expect, test } from '@playwright/test';

/* Raccourcis clavier rangés par sections (Fichier, Édition, Affichage…). */

test('la liste des raccourcis est rangée en sections', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.keyboard.press('Control+/');
  const file = page.getByTestId('shortcut-section-file');
  await expect(file.getByRole('heading', { name: 'Fichier' })).toBeVisible();
  await expect(file.getByTestId('shortcut-file.save')).toBeVisible();
  await expect(page.getByTestId('shortcut-section-edit')).toBeVisible();
  await expect(page.getByTestId('shortcut-section-view')).toBeVisible();
});
