import { expect, test } from '@playwright/test';

/* Choix de la police : filtres (serif, sans serif, gras…) et noms écrits dans leur police. */

test('le choix de police filtre par famille et montre chaque nom dans sa police', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.keyboard.press('t');
  await page.getByTestId('canvas').click({ position: { x: 300, y: 300 } });
  await page.keyboard.type('Bonjour');
  await page.keyboard.press('Escape');
  await page.getByTestId('text-font').click();
  const pop = page.getByTestId('font-pop');
  await expect(pop).toBeVisible();

  // Chaque nom est écrit dans sa propre police.
  const lora = pop.locator('[role="option"][data-value="Lora"]');
  await expect(lora).toHaveCSS('font-family', /Lora/);

  // Filtre « Serif » : Lora reste, Inter disparaît.
  await page.getByTestId('font-filter-serif').click();
  await expect(lora).toBeVisible();
  await expect(pop.locator('[role="option"][data-value="Inter"]')).toHaveCount(0);

  // Filtre « Écriture » : Pacifico seul parmi les polices fournies.
  await page.getByTestId('font-filter-script').click();
  await expect(pop.locator('[role="option"][data-value="Pacifico"]')).toBeVisible();
  await expect(lora).toHaveCount(0);

  // Choisir une police l'applique au texte et ferme la liste.
  await page.getByTestId('font-filter-all').click();
  await lora.click();
  await expect(pop).toBeHidden();
  await expect(page.getByTestId('text-font')).toHaveAttribute('data-value', 'Lora');
});
