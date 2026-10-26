import { expect, test } from '@playwright/test';
import { choose } from './choose';

/* Préréglages des touches d'outils : Affinity (défaut), Photoshop, Illustrator. */

const tool = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).poulpe.ui.get().tool);

test('les touches des outils suivent le préréglage choisi dans Aide › Raccourcis clavier', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();

  // Affinity : M ne fait rien en Dessin, U prend le rectangle.
  await page.keyboard.press('m');
  expect(await tool(page)).toBe('select');
  await page.keyboard.press('u');
  expect(await tool(page)).toBe('rect');

  await page.keyboard.press('Control+/');
  await choose(page.getByTestId('key-preset'), 'illustrator');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.keyboard.press('m');
  expect(await tool(page)).toBe('rect');
  await page.keyboard.press('l');
  expect(await tool(page)).toBe('ellipse');

  // Le choix est gardé d'un lancement à l'autre.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('poulpe.settings')!).keyPreset);
  expect(saved).toBe('illustrator');
});

test('préréglage Photoshop en Persona Photo : R pour le flou', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false, keyPreset: 'photoshop' })),
  );
  await page.goto('/');
  await page.getByTestId('persona-photo').click();
  await page.keyboard.press('r');
  expect(await tool(page)).toBe('blurBrush');
});
