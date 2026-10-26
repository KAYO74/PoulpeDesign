import { expect, test, type Page } from '@playwright/test';
import { choose } from './choose';

/* Côté Canva (v0.2) : écran d'accueil, modèles, éléments, styles et redimensionnement. */

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).poulpe.editor.getState();
    return {
      history: s.history as string[],
      selection: s.selection as string[],
      activeArtboardId: s.activeArtboardId as string,
      artboards: s.doc.artboards.map((a: any) => ({
        id: a.id,
        name: a.name,
        width: a.width,
        height: a.height,
        background: a.background,
        children: a.children.map((n: any) => ({
          id: n.id,
          type: n.type,
          clip: !!n.clip,
          fill: n.fill,
          font: n.style?.fontFamily,
          children: n.children?.map((c: any) => c.type),
        })),
      })),
    };
  });

async function start(page: Page, settings: Record<string, unknown> = { showWelcome: false }) {
  await page.addInitScript((s) => {
    if (!localStorage.getItem('poulpe.settings')) localStorage.setItem('poulpe.settings', JSON.stringify(s));
  }, settings);
  await page.goto('/');
}

test('l’écran d’accueil propose des modèles et crée un design à partir de l’un d’eux', async ({ page }) => {
  await start(page, {});
  await expect(page.getByRole('heading', { name: 'Bienvenue dans Poulpe Design' })).toBeVisible();
  // Filtre par format : la carte de visite y est, la story Instagram non.
  await page.getByRole('dialog').getByRole('button', { name: 'Carte de visite', exact: true }).click();
  await expect(page.getByRole('dialog').getByTestId('template-businessCard')).toBeVisible();
  await expect(page.getByRole('dialog').getByTestId('template-storyPromo')).toHaveCount(0);
  await page.getByRole('dialog').getByTestId('template-businessCard').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const s = await state(page);
  expect(s.artboards).toHaveLength(1);
  expect(s.artboards[0]).toMatchObject({ width: 1050, height: 600 });
  expect(s.artboards[0].children.length).toBeGreaterThan(3);
});

test('l’écran d’accueil crée un document vide au format choisi', async ({ page }) => {
  await start(page, {});
  await page.getByTestId('new-social').click();
  await page.getByTestId('preset-youtube').dblclick();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state(page)).artboards[0]).toMatchObject({ width: 1280, height: 720, children: [] });
});

test('applique un modèle depuis la bibliothèque, puis un second dans un nouveau plan de travail', async ({
  page,
}) => {
  await start(page);
  await expect(page.getByTestId('library')).toBeVisible();
  await page.getByTestId('library-search').fill('soldes');
  await page.getByTestId('template-summerSale').click();
  let s = await state(page);
  expect(s.artboards).toHaveLength(1);
  expect(s.artboards[0]).toMatchObject({ width: 1080, height: 1080 });
  expect(s.history.at(-1)).toBe('history.template');

  await page.getByTestId('library-search').fill('');
  await page.getByTestId('template-quote').click();
  s = await state(page);
  expect(s.artboards).toHaveLength(2);
  expect(s.activeArtboardId).toBe(s.artboards[1].id);
  // Annuler retire le second plan de travail d'un coup.
  await page.keyboard.press('Control+z');
  expect((await state(page)).artboards).toHaveLength(1);
});

test('ajoute des textes, formes, icônes et illustrations, et remplit un cadre photo', async ({ page }) => {
  await start(page);
  await page.getByTestId('lib-tab-elements').click();
  await page.getByTestId('text-heading').click();
  await page.getByTestId('shape-star').click();
  await page.getByTestId('library-search').fill('coeur');
  await expect(page.getByTestId('icon-heart')).toBeVisible();
  await page.getByTestId('icon-heart').click();
  await page.getByTestId('library-search').fill('');
  await page.getByTestId('illustration-sunset').click();
  await page.getByTestId('frame-frameCircle').click();
  let s = await state(page);
  const types = s.artboards[0].children.map((n: any) => n.type);
  expect(types).toEqual(['text', 'star', 'path', 'group', 'group']);
  const frame = s.artboards[0].children[4];
  expect(frame.clip).toBe(true);
  expect(s.selection).toEqual([frame.id]);

  // Le cadre est sélectionné : la photo importée vient le remplir.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importer une photo' }).click();
  await (
    await chooser
  ).setFiles(new URL('../../desktop/src-tauri/icons/128x128.png', import.meta.url).pathname);
  await expect
    .poll(async () => (await state(page)).artboards[0].children[4].children)
    .toEqual(['ellipse', 'image']);
  s = await state(page);
  expect(s.artboards[0].children).toHaveLength(5);
});

test('glisse un élément de la bibliothèque sur le canevas', async ({ page }) => {
  await start(page);
  await page.getByTestId('lib-tab-elements').click();
  await page.getByTestId('shape-circle').dragTo(page.getByTestId('canvas'));
  const s = await state(page);
  expect(s.artboards[0].children.map((n: any) => n.type)).toEqual(['ellipse']);
});

test('applique une palette et une combinaison de polices', async ({ page }) => {
  await start(page);
  await page.getByTestId('template-quote').click();
  const before = await state(page);
  await page.getByTestId('lib-tab-styles').click();
  await page.getByTestId('palette-forest').click();
  let s = await state(page);
  expect(s.history.at(-1)).toBe('history.palette');
  expect(s.artboards[0].background).not.toEqual(before.artboards[0].background);
  // Un second clic propose une autre répartition des mêmes couleurs.
  await page.getByTestId('palette-forest').click();
  expect((await state(page)).history.slice(-2)).toEqual(['history.palette', 'history.palette']);

  await page.getByTestId('pairing-impact').click();
  s = await state(page);
  const fonts = s.artboards[0].children.filter((n: any) => n.type === 'text').map((n: any) => n.font);
  expect(new Set(fonts).size).toBeGreaterThan(0);
  expect(fonts.join()).not.toEqual(
    before.artboards[0].children
      .filter((n: any) => n.type === 'text')
      .map((n: any) => n.font)
      .join(),
  );
});

test('redimensionne un design vers un autre format, en copie', async ({ page }) => {
  await start(page);
  await page.getByTestId('template-summerSale').click();
  const count = (await state(page)).artboards[0].children.length;
  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await page.getByRole('menuitem', { name: /Redimensionner le design/ }).click();
  await page.getByTestId('resize-story').click();
  await page.getByTestId('resize-go').click();
  const s = await state(page);
  expect(s.artboards).toHaveLength(2);
  expect(s.artboards[0]).toMatchObject({ width: 1080, height: 1080 });
  expect(s.artboards[1]).toMatchObject({ width: 1080, height: 1920 });
  expect(s.artboards[1].children).toHaveLength(count);
  expect(s.activeArtboardId).toBe(s.artboards[1].id);
});

test('masque la bibliothèque et l’affiche en anglais', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Bibliothèque' }).first().click();
  await expect(page.getByTestId('library')).toHaveCount(0);
  await page.keyboard.press('Control+,');
  await choose(page.getByTestId('prefs-language'), 'en');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Library' }).first().click();
  await expect(page.getByTestId('library')).toBeVisible();
  await expect(page.getByTestId('lib-tab-templates')).toHaveText('Templates');
  await expect(page.getByTestId('template-summerSale')).toContainText('Summer sale');
});
