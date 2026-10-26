import { expect, test, type Page } from '@playwright/test';
import { choose } from './choose';

/*
 * Version 1.2, outils Texte comme dans Affinity : Texte artistique (glisser pour la taille, clic
 * sur un contour pour un texte sur tracé), Cadre de texte (glisser ou cliquer), barre
 * contextuelle complète et raccourcis de mise en forme.
 */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
const tool = (page: Page): Promise<string> => page.evaluate(() => (window as any).poulpe.ui.get().tool);
const zoom = (page: Page): Promise<number> => page.evaluate(() => (window as any).poulpe.ui.get().view.zoom);
const history = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().history);

async function canvas(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y];
  const drag = async (a: [number, number], b: [number, number], steps = 8) => {
    await page.mouse.move(...at(...a));
    await page.mouse.down();
    await page.mouse.move(...at(...b), { steps });
    await page.mouse.up();
  };
  return { at, drag };
}

/** Position à l'écran (relative au canevas) d'un point du document. */
const toScreen = (page: Page, x: number, y: number): Promise<[number, number]> =>
  page.evaluate(
    ([x, y]) => {
      const v = (window as any).poulpe.ui.get().view;
      return [x * v.zoom + v.panX, y * v.zoom + v.panY] as [number, number];
    },
    [x, y],
  );

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('T alterne entre Texte artistique et Cadre de texte ; glisser choisit la taille de la police', async ({
  page,
}) => {
  const { at, drag } = await canvas(page);
  await page.keyboard.press('t');
  expect(await tool(page)).toBe('text');
  await page.keyboard.press('t');
  expect(await tool(page)).toBe('frameText');
  await page.keyboard.press('t');
  expect(await tool(page)).toBe('text');

  // Glisser vers le bas : la hauteur glissée devient la taille de la police.
  const z = await zoom(page);
  await drag([400, 300], [430, 420]);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Titre');
  await page.keyboard.press('Escape');
  const [title] = await nodes(page);
  expect(title.autoWidth).toBe(true);
  expect(title.frame).toBeUndefined();
  expect(title.style.fontSize).toBeCloseTo(120 / z, 0);

  // Un simple clic : la taille par défaut.
  await page.mouse.click(...at(400, 600));
  await page.keyboard.type('Sous-titre');
  await page.keyboard.press('Escape');
  const list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list[1].style.fontSize).toBe(48);
  expect(await history(page)).toEqual(['history.open', 'history.add', 'history.add']);
});

test('Cadre de texte : glisser trace un cadre, un clic en crée un de taille par défaut', async ({ page }) => {
  const { at, drag } = await canvas(page);
  await page.keyboard.press('t');
  await page.keyboard.press('t');
  await page.mouse.click(...at(300, 300));
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Un cadre');
  await page.keyboard.press('Escape');
  let [frame] = await nodes(page);
  expect(frame.frame).toBe(true);
  expect(frame.autoWidth).toBe(false);
  expect(frame.width).toBeGreaterThan(200);
  expect(frame.height).toBeGreaterThan(100);

  await drag([300, 500], [600, 650]);
  await page.keyboard.type('Deuxième');
  await page.keyboard.press('Escape');
  const z = await zoom(page);
  frame = (await nodes(page))[1];
  expect(frame.frame).toBe(true);
  expect(frame.width).toBeGreaterThan(250 / z);

  // Les réglages propres aux cadres : alignement vertical et colonnes.
  await page.getByTestId('text-valign-bottom').click();
  await page.getByTestId('text-columns').fill('2');
  await page.getByTestId('text-columns').press('Enter');
  frame = (await nodes(page))[1];
  expect(frame.style.verticalAlign).toBe('bottom');
  expect(frame.style.columns).toEqual({ count: 2, gap: 16 });
});

test('Texte artistique : un clic sur le contour d’une forme écrit le long du tracé', async ({ page }) => {
  const { at, drag } = await canvas(page);
  await page.keyboard.press('e');
  await drag([300, 200], [600, 500]);
  const [ellipse] = await nodes(page);
  await page.keyboard.press('t');
  // Le haut de l'ellipse : le curseur annonce un texte sur tracé.
  const top = await toScreen(page, ellipse.x + ellipse.width / 2, ellipse.y);
  await page.mouse.move(...at(top[0], top[1] + 1));
  await expect
    .poll(() => page.getByTestId('canvas').evaluate((c) => (c as HTMLElement).style.cursor))
    .toContain('data:image/svg+xml');
  await page.mouse.click(...at(top[0], top[1] + 1));
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Autour du cercle');
  await page.keyboard.press('Escape');
  const list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].type).toBe('text');
  expect(list[0].text).toBe('Autour du cercle');
  expect(list[0].path.offset).toBeCloseTo(0.75, 1);

  // Rien tapé : la forme reste telle quelle.
  await page.keyboard.press('e');
  await drag([650, 450], [800, 600]);
  await page.keyboard.press('t');
  const shape = (await nodes(page))[1];
  const edge = await toScreen(page, shape.x, shape.y + shape.height / 2);
  await page.mouse.click(...at(edge[0] + 1, edge[1]));
  await page.keyboard.press('Escape');
  expect((await nodes(page)).map((n) => n.type)).toEqual(['text', 'ellipse']);
});

test('barre contextuelle et raccourcis de mise en forme', async ({ page }) => {
  const { at } = await canvas(page);
  await page.keyboard.press('t');
  await page.mouse.click(...at(400, 400));
  await page.keyboard.type('Festival des Mers');
  // Pendant l'édition, les raccourcis agissent sur la sélection dans le texte.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+i');
  await expect(page.getByTestId('text-bold')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('text-editor')).toBeFocused();
  // Alt+Droite : interlettrage de la sélection.
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Escape');
  let [n] = await nodes(page);
  expect(n.runs).toEqual([
    { start: 13, end: 17, style: { fontWeight: 700, italic: true, letterSpacing: 1 } },
  ]);
  expect(await history(page)).toEqual(['history.open', 'history.add']);

  // Outil Déplacer, texte sélectionné : la barre du texte suit, les raccourcis agissent sur tout le texte.
  await page.keyboard.press('v');
  await page.evaluate(() => {
    const p = (window as any).poulpe;
    p.editor.select([p.editor.doc.artboards[0].children[0].id]);
  });
  await expect(page.getByTestId('text-font')).toBeVisible();
  await page.keyboard.press('Control+u');
  await page.keyboard.press('Control+Alt+c');
  await page.keyboard.press('Control+Shift+>');
  [n] = await nodes(page);
  expect(n.style.underline).toBe(true);
  expect(n.style.align).toBe('center');
  expect(n.style.fontSize).toBe(52);
  await page.keyboard.press('Control+Shift+<');
  expect((await nodes(page))[0].style.fontSize).toBe(48);

  // Boutons de la barre : justification, liste, style de police.
  await page.getByTestId('text-justify-center').click();
  await page.getByTestId('text-list-number').click();
  await choose(page.getByTestId('text-face'), '700i');
  [n] = await nodes(page);
  expect(n.style.align).toBe('justify');
  expect(n.style.lastLine).toBe('center');
  expect(n.style.list).toBe('number');
  expect(n.style.fontWeight).toBe(700);
  expect(n.style.italic).toBe(true);
  // L'alignement vertical n'a de sens que pour un cadre de texte.
  await expect(page.getByTestId('text-valign-top')).toHaveCount(0);

  // Styles de texte : enregistrer celui-ci, puis l'appliquer à un autre texte.
  await choose(page.getByTestId('text-styles'), '__save');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('t');
  await page.mouse.click(...at(400, 650));
  await page.keyboard.type('Autre');
  await page.keyboard.press('Escape');
  const styleId = await page.evaluate(() => (window as any).poulpe.editor.doc.styles[0].id);
  await choose(page.getByTestId('text-styles'), styleId);
  const other = (await nodes(page))[1];
  expect(other.style.list).toBe('number');
  expect(other.style.fontWeight).toBe(700);
  expect(other.style.underline).toBe(true);
});
