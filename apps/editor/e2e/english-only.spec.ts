import { expect, test } from '@playwright/test';
import { choose } from './choose';

/*
 * En anglais, aucun texte français ne doit rester visible dans les menus, les infobulles et les
 * étiquettes de la fenêtre principale.
 */

const FRENCH =
  /[àâçéèêëîïôùûüœ]|\b(Fichier|Édition|Affichage|Calques?|Aide|Plan de travail|Enregistrer|Ouvrir|Annuler|Rétablir|Outils?|Couleurs?|Texte|Fenêtre|Pinceau|Sélection|Ajouter|Supprimer)\b/i;

test('en anglais, plus aucun texte français dans les menus ni les infobulles', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.keyboard.press('Control+,');
  await page.getByTestId('prefs-tab-general').click();
  await choose(page.getByTestId('prefs-language'), 'en');
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeHidden();

  const found: string[] = [];
  const check = (where: string, texts: string[]) => {
    for (const t of texts) if (FRENCH.test(t)) found.push(`${where}: ${t}`);
  };

  // Infobulles et étiquettes de ce qui est affiché au départ.
  check(
    'étiquette',
    await page.evaluate(() =>
      [...document.querySelectorAll('[title], [aria-label]')].map((e) =>
        `${e.getAttribute('title') ?? ''} ${e.getAttribute('aria-label') ?? ''}`.trim(),
      ),
    ),
  );

  // Chaque menu du haut, avec ses entrées.
  const bar = page.getByRole('navigation', { name: 'Menu' });
  const triggers = bar.locator('button');
  const count = await triggers.count();
  expect(count).toBeGreaterThan(5);
  for (let i = 0; i < count; i++) {
    const trigger = triggers.nth(i);
    const name = (await trigger.textContent()) ?? '';
    check('menu', [name]);
    await trigger.click();
    const items = page.getByRole('menu').getByRole('menuitem');
    await expect(items.first()).toBeVisible();
    check(`entrée de « ${name} »`, await items.allTextContents());
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
  }

  expect(found, `textes français restants :\n${found.join('\n')}`).toEqual([]);
});
