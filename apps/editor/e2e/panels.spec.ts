import { expect, test, type Page } from '@playwright/test';

/* Panneaux libres : détacher, déplacer, redimensionner et ré-ancrer les fenêtres d'outils. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 12 });
  await page.mouse.up();
}

/** Juste à gauche du milieu d'un onglet : le panneau déposé s'y range devant lui. */
const leftOf = async (page: Page, testId: string): Promise<[number, number]> => {
  const b = (await page.getByTestId(testId).boundingBox())!;
  return [b.x + 4, b.y + b.height / 2];
};

const center = async (page: Page, testId: string): Promise<[number, number]> => {
  const b = (await page.getByTestId(testId).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
};

test('détache le groupe Calques, le déplace, le redimensionne et le ré-ancre', async ({ page }) => {
  const tabs = page.getByTestId('studio-studio-bottom').locator('.studio-tabs');
  const tb = (await tabs.boundingBox())!;
  // Glisser la barre d'onglets (à droite des onglets) vers le centre de l'écran.
  await drag(page, [tb.x + tb.width - 40, tb.y + 10], [600, 300]);
  const win = page.getByTestId('float-studio-bottom');
  await expect(win).toBeVisible();
  // Le Studio ancré garde l'autre groupe.
  await expect(page.getByTestId('studio').getByTestId('tab-color')).toBeVisible();
  let box = (await win.boundingBox())!;
  expect(box.y).toBeGreaterThan(250);
  expect(box.y).toBeLessThan(320);

  // Les onglets restent utilisables dans la fenêtre flottante.
  await win.getByTestId('tab-history').click();
  await expect(win.getByTestId('tab-history')).toHaveAttribute('aria-selected', 'true');

  // Redimensionner par le coin inférieur droit.
  const before = box;
  const se = (await page.getByTestId('resize-studio-bottom-se').boundingBox())!;
  await drag(page, [se.x + 4, se.y + 4], [se.x + 84, se.y + 64]);
  box = (await win.boundingBox())!;
  expect(box.width).toBeGreaterThan(before.width + 60);
  expect(box.height).toBeGreaterThan(before.height + 40);

  // La disposition est mémorisée.
  await page.reload();
  await expect(page.getByTestId('float-studio-bottom')).toBeVisible();

  // Ré-ancrer en la ramenant sur le Studio.
  const head = (await page.getByTestId('float-studio-bottom').locator('.studio-tabs').boundingBox())!;
  const studio = (await page.getByTestId('studio').boundingBox())!;
  await drag(page, [head.x + 6, head.y + 10], [studio.x + studio.width / 2, studio.y + 300]);
  await expect(page.getByTestId('float-studio-bottom')).toHaveCount(0);
  await expect(page.getByTestId('studio').getByTestId('tab-layers')).toBeVisible();
});

test('la colonne d’outils devient une palette flottante redimensionnable', async ({ page }) => {
  await drag(page, await center(page, 'toolcol-grip'), [700, 250]);
  const win = page.getByTestId('float-tools');
  await expect(win).toBeVisible();
  // Les outils fonctionnent toujours.
  await page.getByTestId('tool-rect').click();
  await expect(page.getByTestId('tool-rect')).toHaveAttribute('aria-pressed', 'true');

  // Élargir la palette : les outils passent sur plusieurs colonnes.
  const rectY = (await page.getByTestId('tool-rect').boundingBox())!.y;
  const e = (await page.getByTestId('resize-tools-e').boundingBox())!;
  await drag(page, [e.x + 3, e.y + e.height / 2], [e.x + 200, e.y + e.height / 2]);
  expect((await win.boundingBox())!.width).toBeGreaterThan(200);
  expect((await page.getByTestId('tool-rect').boundingBox())!.y).toBeLessThan(rectY);

  // Le bouton d'ancrage la remet à sa place.
  await page.getByTestId('dock-tools').click();
  await expect(win).toHaveCount(0);
  await expect(page.getByTestId('toolcol-grip')).toBeVisible();
});

test('redimensionne le Studio ancré et réinitialise les panneaux', async ({ page }) => {
  const studio = page.getByTestId('studio');
  const w0 = (await studio.boundingBox())!.width;
  const [x, y] = await center(page, 'studio-resize');
  // Studio à droite : glisser son bord gauche vers la gauche l'élargit.
  await drag(page, [x, y], [x - 80, y]);
  expect((await studio.boundingBox())!.width).toBeCloseTo(w0 + 80, -1);

  // Séparateur entre les deux groupes ancrés.
  const top = page.getByTestId('studio-studio-top');
  const h0 = (await top.boundingBox())!.height;
  const [sx, sy] = await center(page, 'studio-split');
  await drag(page, [sx, sy], [sx, sy + 60]);
  expect((await top.boundingBox())!.height).toBeCloseTo(h0 + 60, -1);

  await page.getByRole('button', { name: 'Affichage' }).click();
  await page.getByRole('menuitem', { name: 'Réinitialiser les panneaux' }).click();
  expect((await studio.boundingBox())!.width).toBeCloseTo(w0, 0);
});

test('crée son propre espace de travail et passe de l’un à l’autre', async ({ page }) => {
  // Détacher les Calques avant de créer l'espace : la disposition est enregistrée avec lui.
  const tb = (await page.getByTestId('studio-studio-bottom').locator('.studio-tabs').boundingBox())!;
  await drag(page, [tb.x + 6, tb.y + 10], [500, 300]);
  await expect(page.getByTestId('float-studio-bottom')).toBeVisible();

  await page.getByTestId('workspace-menu').click();
  await page.getByTestId('workspace-new').click();
  await page.getByTestId('workspace-name').fill('Retouche rapide');
  await page.getByTestId('workspace-base-photo').click();
  // Ne garder que quelques outils et panneaux.
  for (const id of ['magicEraser', 'heal', 'clone', 'dodge', 'burn'])
    await page.getByTestId(`workspace-tool-${id}`).click();
  await page.getByTestId('workspace-tab-histogram').click();
  await page.getByTestId('workspace-save').click();

  await expect(page.getByTestId('workspace-menu')).toContainText('Retouche rapide');
  await expect(page.getByTestId('persona-photo')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('tool-brush')).toBeVisible();
  await expect(page.getByTestId('tool-heal')).toHaveCount(0);
  await expect(page.getByTestId('tab-histogram')).toHaveCount(0);
  await expect(page.getByTestId('float-studio-bottom')).toBeVisible();

  // Revenir à Dessin rend tous les outils ; la disposition de Dessin vit sa vie à part.
  await page.getByTestId('persona-draw').click();
  await expect(page.getByTestId('tool-pen')).toBeVisible();
  await page.getByTestId('dock-studio-bottom').click();
  await expect(page.getByTestId('float-studio-bottom')).toHaveCount(0);

  // L'espace est mémorisé et se rouvre avec sa disposition.
  await page.reload();
  await page.getByTestId('workspace-menu').click();
  await page.getByTestId('workspace-Retouche rapide').click();
  await expect(page.getByTestId('float-studio-bottom')).toBeVisible();
  await expect(page.getByTestId('tool-heal')).toHaveCount(0);

  // Le modifier puis le supprimer.
  await page.getByTestId('workspace-menu').click();
  await page.getByTestId('workspace-edit').click();
  await page.getByTestId('workspace-tool-heal').click();
  await page.getByTestId('workspace-save').click();
  await expect(page.getByTestId('tool-heal')).toBeVisible();
  await page.getByTestId('workspace-menu').click();
  await page.getByTestId('workspace-edit').click();
  await page.getByTestId('workspace-delete').click();
  await expect(page.getByTestId('workspace-menu')).not.toContainText('Retouche rapide');
  await expect(page.getByTestId('persona-photo')).toHaveAttribute('aria-pressed', 'true');
});

test('mélange outils vectoriels et pixel dans un espace, une colonne ou deux, verrouillage', async ({
  page,
}) => {
  await page.getByTestId('workspace-menu').click();
  await page.getByTestId('workspace-new').click();
  await page.getByTestId('workspace-name').fill('Mixte');
  // Base vectorielle, plus le pinceau et la gomme.
  await page.getByTestId('workspace-tool-brush').click();
  await page.getByTestId('workspace-tool-eraser').click();
  await page.getByTestId('workspace-columns-one').click();
  await page.getByTestId('workspace-save').click();

  const col = page.getByTestId('toolcol');
  await expect(col.getByTestId('tool-pen')).toBeVisible();
  await expect(col.getByTestId('tool-brush')).toBeVisible();
  await expect(col).not.toHaveClass(/\btwo\b/);

  // Un outil pixel passe en mode Photo sans quitter l'espace.
  await page.getByTestId('tool-brush').click();
  await expect(page.getByTestId('tool-brush')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().persona)).toBe('photo');
  await expect(page.getByTestId('workspace-menu')).toContainText('Mixte');
  await expect(col.getByTestId('tool-pen')).toBeVisible();

  // Un outil vectoriel revient en Dessin.
  await page.getByTestId('tool-pen').click();
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().persona)).toBe('draw');
  await expect(page.getByTestId('workspace-menu')).toContainText('Mixte');

  // Deux colonnes, puis verrouillage depuis le menu Affichage.
  await page.getByRole('button', { name: 'Affichage' }).click();
  await page.getByRole('menuitem', { name: 'Colonne d’outils' }).hover();
  await page.getByTestId('menu-tools-columns-two').click();
  await expect(col).toHaveClass(/\btwo\b/);
  await page.getByRole('button', { name: 'Affichage' }).click();
  await page.getByRole('menuitem', { name: 'Colonne d’outils' }).hover();
  await page.getByTestId('menu-tools-lock').click();
  await expect(page.getByTestId('toolcol-grip')).toHaveCount(0);

  // Le réglage est retenu par l'espace.
  await page.reload();
  await expect(page.getByTestId('toolcol')).toHaveClass(/\btwo\b/);
  await expect(page.getByTestId('toolcol-grip')).toHaveCount(0);
});

test('outils alignés ou rangés en groupes, au choix', async ({ page }) => {
  const col = page.getByTestId('toolcol');
  // Alignés : un bouton par outil, les formes réunies sous le Rectangle (comme dans Affinity).
  await expect(col.getByTestId('tool-direct')).toBeVisible();
  await expect(col.getByTestId('tool-rect')).toBeVisible();
  await expect(col.getByTestId('tool-ellipse')).toHaveCount(0);

  await page.getByRole('button', { name: 'Affichage' }).click();
  await page.getByRole('menuitem', { name: 'Colonne d’outils' }).hover();
  await page.getByTestId('menu-tools-layout-groups').click();

  // Un bouton par groupe : le rectangle représente les formes.
  await expect(col.getByTestId('tool-rect')).toBeVisible();
  await expect(col.getByTestId('tool-ellipse')).toHaveCount(0);
  await expect(col.getByTestId('tool-direct')).toHaveCount(0);

  // Le petit triangle ouvre les autres outils du groupe.
  await page.getByTestId('toolgroup-more-rect').click();
  await expect(page.getByTestId('tool-menu')).toBeVisible();
  await page.getByTestId('toolmenu-ellipse').click();
  await expect(page.getByTestId('tool-menu')).toHaveCount(0);
  await expect(col.getByTestId('tool-ellipse')).toHaveAttribute('aria-pressed', 'true');
  await expect(col.getByTestId('tool-rect')).toHaveCount(0);

  // Le clic droit ouvre aussi le menu, Échap le referme.
  await col.getByTestId('tool-ellipse').click({ button: 'right' });
  await expect(page.getByTestId('toolmenu-star')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-menu')).toHaveCount(0);

  // Le choix et le dernier outil du groupe sont retenus.
  await page.reload();
  await expect(page.getByTestId('toolcol').getByTestId('tool-ellipse')).toBeVisible();
  await expect(page.getByTestId('toolcol').getByTestId('tool-star')).toHaveCount(0);

  // Retour à tous les outils alignés.
  await page.getByRole('button', { name: 'Affichage' }).click();
  await page.getByRole('menuitem', { name: 'Colonne d’outils' }).hover();
  await page.getByTestId('menu-tools-layout-all').click();
  await expect(page.getByTestId('toolcol').getByTestId('tool-direct')).toBeVisible();
  await expect(page.getByTestId('toolcol').getByTestId('tool-ellipse')).toBeVisible();
  await expect(page.getByTestId('toolcol').getByTestId('tool-star')).toHaveCount(0);
});

test('détache un seul panneau (Historique) en fenêtre, puis le remet dans son groupe', async ({ page }) => {
  // Glisser l'onglet Historique hors du Studio.
  await drag(page, await center(page, 'tab-history'), [600, 300]);
  const win = page.getByTestId('float-tab:history');
  await expect(win).toBeVisible();
  await expect(win.getByTestId('tab-history')).toBeVisible();
  // Le groupe d'origine reste ancré avec ses autres panneaux.
  const studio = page.getByTestId('studio');
  await expect(studio.getByTestId('tab-layers')).toBeVisible();
  await expect(studio.getByTestId('tab-history')).toHaveCount(0);
  await expect(page.getByTestId('float-studio-bottom')).toHaveCount(0);

  // Mémorisé après un rechargement.
  await page.reload();
  await expect(page.getByTestId('float-tab:history')).toBeVisible();

  // Ramené sur le Studio : il reprend sa place dans son groupe.
  const head = (await page.getByTestId('float-tab:history').locator('.studio-tabs').boundingBox())!;
  const sb = (await studio.boundingBox())!;
  await drag(page, [head.x + head.width - 30, head.y + 10], [sb.x + sb.width / 2, sb.y + 300]);
  await expect(page.getByTestId('float-tab:history')).toHaveCount(0);
  await expect(studio.getByTestId('tab-history')).toBeVisible();

  // Double-clic sur un onglet : détacher ; bouton d'ancrage : remettre.
  await studio.getByTestId('tab-color').dblclick();
  await expect(page.getByTestId('float-tab:color')).toBeVisible();
  await expect(studio.getByTestId('tab-stroke')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('dock-tab:color').click();
  await expect(page.getByTestId('float-tab:color')).toHaveCount(0);
  await expect(studio.getByTestId('tab-color')).toBeVisible();
});

test('un clic sur un onglet change toujours de panneau', async ({ page }) => {
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('tab-history')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid^="float-"]')).toHaveCount(0);
});

test('range un panneau dans un autre groupe ou à une autre place, comme Photoshop', async ({ page }) => {
  const top = page.getByTestId('studio-studio-top');
  const bottom = page.getByTestId('studio-studio-bottom');
  // Historique, glissé sur l'onglet Couleur du groupe du haut, s'y range devant lui.
  await drag(page, await center(page, 'tab-history'), await leftOf(page, 'tab-color'));
  await expect(top.getByTestId('tab-history')).toBeVisible();
  await expect(bottom.getByTestId('tab-history')).toHaveCount(0);
  const tabs = top.locator('[role="tab"]');
  await expect(tabs.first()).toHaveAttribute('data-tab', 'history');

  // Changer l'ordre dans le même groupe : Effets avant Historique.
  await drag(page, await center(page, 'tab-effects'), await leftOf(page, 'tab-history'));
  await expect(tabs.first()).toHaveAttribute('data-tab', 'effects');

  // Mémorisé ; Réinitialiser les panneaux rend les groupes d'origine.
  await page.reload();
  await expect(top.getByTestId('tab-history')).toBeVisible();
  await page.getByRole('button', { name: 'Fenêtre' }).click();
  await page.getByRole('menuitem', { name: 'Réinitialiser les panneaux' }).click();
  await expect(bottom.getByTestId('tab-history')).toBeVisible();
  await expect(tabs.first()).toHaveAttribute('data-tab', 'color');
});

test('ferme et rouvre les panneaux depuis le menu Fenêtre', async ({ page }) => {
  const menu = async (name: string) => {
    await page.getByRole('button', { name: 'Fenêtre' }).click();
    await page
      .getByRole('menu', { name: 'Fenêtre' })
      .getByRole('menuitem', { name: new RegExp(`^(✓ )?${name}$`) })
      .click();
  };
  await menu('Calques');
  await expect(page.getByTestId('tab-layers')).toHaveCount(0);
  // Rouvert, il arrive dans sa propre fenêtre.
  await menu('Calques');
  const win = page.getByTestId('float-tab:layers');
  await expect(win).toBeVisible();
  // Le pinceau, absent de la Persona Dessin, s'ajoute aussi.
  await menu('Pinceau');
  await expect(page.getByTestId('float-tab:brush')).toBeVisible();
  // La croix de la fenêtre ferme le panneau.
  await page.getByTestId('close-tab:brush').click();
  await expect(page.getByTestId('float-tab:brush')).toHaveCount(0);

  // Un groupe vidé garde une place où redéposer un panneau.
  await page.getByTestId('close-tab:layers').click();
  await menu('Historique');
  await menu('Macros');
  await expect(page.getByTestId('empty-studio-bottom')).toBeVisible();
  await drag(page, await center(page, 'tab-color'), await center(page, 'empty-studio-bottom'));
  await expect(page.getByTestId('studio-studio-bottom').getByTestId('tab-color')).toBeVisible();
});
