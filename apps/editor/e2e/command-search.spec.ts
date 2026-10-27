import { expect, test } from '@playwright/test';

/* Recherche de commande « Que voulez-vous faire ? » (Ctrl+K). */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('Ctrl+K retrouve un outil par son nom, sans accent, et le choisit', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const input = page.getByTestId('palette-input');
  await expect(input).toBeFocused();
  await input.fill('plume');
  await expect(page.getByTestId('palette-tool:pen')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette-input')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).poulpe.ui.get().tool)).toBe('pen');
});

test('retrouve une action et lance un outil photo en changeant de Persona', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const input = page.getByTestId('palette-input');
  await expect(input).toBeFocused();
  await input.fill('exporter');
  await expect(page.getByTestId('palette-input')).toHaveValue('exporter');
  await input.press('Enter');
  const dialog = page.getByRole('dialog', { name: /Exporter/ });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('palette-input')).toBeHidden();

  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await input.fill('gomme magique');
  await page.getByTestId('palette-tool:magicEraser').click();
  await expect.poll(() => page.evaluate(() => (window as any).poulpe.ui.get().tool)).toBe('magicEraser');
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().persona)).toBe('photo');
});

test('indique quand rien ne correspond et se ferme avec Échap', async ({ page }) => {
  await page.getByRole('button', { name: 'Aide' }).click();
  await page.getByRole('menuitem', { name: /Que voulez-vous faire/ }).click();
  await page.getByTestId('palette-input').fill('zzzzqq');
  await expect(page.getByText('Rien ne correspond')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette-input')).toBeHidden();
});
