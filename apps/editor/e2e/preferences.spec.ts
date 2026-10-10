import { expect, test, type Page } from '@playwright/test';

/* Préférences (Édition > Préférences), diagnostic et aide intégrée. */

async function menu(page: Page, top: string, item: string | RegExp) {
  await page.getByRole('navigation', { name: 'Menu' }).getByText(top, { exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

const historyIndex = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().historyIndex);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('Édition > Préférences ouvre les sept catégories, aussi au clavier', async ({ page }) => {
  await menu(page, 'Édition', /Préférences/);
  const dialog = page.getByRole('dialog', { name: 'Préférences' });
  await expect(dialog).toBeVisible();
  for (const tab of ['general', 'performance', 'display', 'layers', 'shortcuts', 'advanced', 'diagnostic']) {
    await page.getByTestId(`prefs-tab-${tab}`).click();
    await expect(page.getByTestId(`prefs-${tab}`)).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Control+,');
  await expect(dialog).toBeVisible();
});

test('la limite d’historique s’applique et reste après rechargement', async ({ page }) => {
  for (let i = 0; i < 8; i++)
    await page.evaluate((n) => {
      (window as any).poulpe.editor.apply('history.rename', (d: any) => {
        d.name = `Doc ${n}`;
      });
    }, i);
  expect(await historyIndex(page)).toBe(8);
  await page.keyboard.press('Control+,');
  await page.getByTestId('prefs-tab-performance').click();
  const field = page.getByTestId('prefs-history');
  await field.fill('3');
  await field.press('Enter');
  expect(await historyIndex(page)).toBe(3);

  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(await page.evaluate(() => (window as any).poulpe.prefs.getPerf().historyLimit)).toBe(3);
});

test('les profils changent les réglages de performance', async ({ page }) => {
  await page.keyboard.press('Control+,');
  await page.getByTestId('prefs-tab-performance').click();
  await page.getByTestId('prefs-profile-saver').click();
  await expect(page.getByTestId('prefs-preview')).toHaveValue('fast');
  await expect(page.getByTestId('prefs-history')).toHaveValue('50');
  await page.getByTestId('prefs-reset-perf').click();
  await expect(page.getByTestId('prefs-preview')).toHaveValue('balanced');
  await expect(page.getByTestId('prefs-memory')).toBeVisible();
});

test('le diagnostic montre la carte graphique et le rapport se copie', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await menu(page, 'Aide', /Paramètres/);
  await expect(page.getByRole('dialog', { name: 'Préférences' })).toBeVisible();
  await page.getByTestId('prefs-tab-diagnostic').click();
  await expect(page.getByTestId('prefs-diagnostic')).toBeVisible();
  await expect(page.getByTestId('diag-gpu')).toBeVisible();
  await page.getByTestId('diag-copy').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Carte graphique');
  expect(text).toContain('WebGL');
});

test('le test de vitesse remet le document et son historique', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).poulpe.editor.apply('history.rename', (d: any) => {
      d.name = 'Mon affiche';
    });
  });
  await page.keyboard.press('Control+,');
  await page.getByTestId('prefs-tab-diagnostic').click();
  await page.getByTestId('diag-bench').click();
  await expect(page.getByTestId('diag-bench-result')).toBeVisible({ timeout: 25_000 });
  const state = await page.evaluate(() => {
    const ed = (window as any).poulpe.editor;
    return { name: ed.doc.name, canUndo: ed.getState().canUndo };
  });
  expect(state).toEqual({ name: 'Mon affiche', canUndo: true });
});

test('le compteur de performances s’affiche dans la barre d’état', async ({ page }) => {
  await page.keyboard.press('Control+,');
  await page.getByTestId('prefs-tab-display').click();
  await page.getByTestId('prefs-perf-meter').check();
  await expect(page.getByTestId('perf-meter')).toContainText('i/s');
});

test('les préférences s’exportent puis se réimportent', async ({ page }) => {
  await page.evaluate(() => (window as any).poulpe.prefs.setPerf({ historyLimit: 42 }));
  const json = await page.evaluate(() => (window as any).poulpe.prefs.exportPreferences());
  await page.evaluate(() => (window as any).poulpe.prefs.setPerf({ historyLimit: 7 }));
  expect(await page.evaluate((j) => (window as any).poulpe.prefs.importPreferences(j), json)).toBe(true);
  expect(await page.evaluate(() => (window as any).poulpe.prefs.importPreferences('{"x":1}'))).toBe(false);
  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(await page.evaluate(() => (window as any).poulpe.prefs.getPerf().historyLimit)).toBe(42);
});

test('Aide > Documentation et Questions fréquentes', async ({ page }) => {
  await menu(page, 'Aide', 'Documentation');
  await expect(page.getByTestId('help-start')).toBeVisible();
  await page.getByTestId('help-tab-faq').click();
  await expect(page.getByTestId('help-faq')).toContainText('ordre des calques');
  await page.keyboard.press('Escape');
  await menu(page, 'Aide', 'Questions fréquentes');
  await expect(page.getByTestId('help-faq')).toBeVisible();
});

test('la page est isolée : le détourage peut utiliser plusieurs cœurs', async ({ page }) => {
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
});

test('les préférences pilotent le moteur de rendu', async ({ page }) => {
  await page.keyboard.press('Control+,');
  await page.getByTestId('prefs-tab-performance').click();
  await page.getByTestId('prefs-cache').selectOption('1024');
  await page.getByTestId('prefs-preview').selectOption('fast');
  const s = await page.evaluate(() => (window as any).poulpe.perf.getPerformanceSettings());
  expect(s.cacheMb).toBe(1024);
  expect(s.previewQuality).toBe('fast');
  await page.getByTestId('prefs-tab-diagnostic').click();
  await expect(page.getByTestId('diag-render')).toContainText('1024');
});

test('la langue et le thème se règlent seulement dans les Préférences', async ({ page }) => {
  // Plus de boutons dans la barre d'outils, ni de sous-menus dans Affichage.
  await expect(page.getByRole('button', { name: 'Langue' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Thème' })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Menu' }).getByText('Affichage', { exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Langue' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Thème' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+,');
  await page.getByTestId('prefs-tab-display').click();
  await page.getByTestId('prefs-theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('prefs-tab-general').click();
  await page.getByTestId('prefs-language').selectOption('en');
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'File' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('le moteur Rust est chargé et la carte graphique se choisit', async ({ page }) => {
  expect(await page.evaluate(() => (window as any).poulpe.engine.start())).toBe(true);
  await page.keyboard.press('Control+,');
  await page.getByTestId('prefs-tab-performance').click();
  await expect(page.getByTestId('prefs-engine')).toContainText('Actif');
  const gpu = page.getByTestId('prefs-gpu');
  await expect(gpu.locator('option')).toHaveCount(4);
  await gpu.selectOption('cpu');
  expect(await page.evaluate(() => (window as any).poulpe.prefs.getPerf().hardwareAcceleration)).toBe(false);
  // Dans le navigateur, l'interface graphique et la mémoire vidéo sont réglées par l'appli de bureau.
  await expect(page.getByTestId('prefs-gpu-backend')).toBeDisabled();
  await page.getByTestId('prefs-profile-power').click();
  await expect(gpu).toHaveValue('high-performance');
  expect(await page.evaluate(() => (window as any).poulpe.prefs.getPerf().vramMb)).toBe(4096);
});
