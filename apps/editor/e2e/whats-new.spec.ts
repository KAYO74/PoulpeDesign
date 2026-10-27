import { expect, test } from '@playwright/test';

/* Nouveautés : montrées une fois après une mise à jour, jamais au premier lancement, et dans Aide. */

const KEY = 'poulpe.settings';

test('après une mise à jour, les nouveautés s’affichent une seule fois', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key, JSON.stringify({ showWelcome: false, lastSeenVersion: '1.0.0' }));
    }
  }, KEY);
  await page.goto('/');
  await expect(page.getByTestId('whats-new')).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Compris' }).click();
  await expect(page.getByTestId('whats-new')).toBeHidden();
  await page.reload();
  await page.waitForTimeout(3500);
  await expect(page.getByTestId('whats-new')).toBeHidden();
});

test('au premier lancement, rien ne s’affiche', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ showWelcome: false })), KEY);
  await page.goto('/');
  await page.waitForTimeout(3500);
  await expect(page.getByTestId('whats-new')).toBeHidden();
});
