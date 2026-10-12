import { expect, test, type Page } from '@playwright/test';

/*
 * Outils vectoriels de la version 0.6 : ciseaux, cutter, outil Coin, constructeur de formes,
 * symboles, styles enregistrés, contours multiples et à largeur variable, biseau, dégradé
 * conique, colonnes de texte et fonctions OpenType.
 */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
const doc = (page: Page): Promise<AnyNode> => page.evaluate(() => (window as any).poulpe.editor.doc);
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('les ciseaux ouvrent le contour d’un rectangle', async ({ page }) => {
  const { at, drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [500, 500]);
  // Les ciseaux sont rangés sous le cutter.
  await page.getByTestId('toolgroup-more-knife').click();
  await page.getByTestId('toolmenu-scissors').click();
  // Clic au milieu du bord du haut.
  await page.mouse.click(...at(400, 300));
  const [n] = await nodes(page);
  expect(n.type).toBe('path');
  expect(n.d).not.toMatch(/Z/);
  expect(n.fill.type).toBe('none');
  expect(await history(page)).toEqual(['history.open', 'history.add', 'history.scissors']);
});

test('le cutter coupe une forme en deux', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [500, 500]);
  await page.getByTestId('tool-knife').click();
  await drag([250, 400], [550, 400]);
  const list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list.map((n) => n.type)).toEqual(['path', 'path']);
  // Deux moitiés d'environ 200 pixels de haut chacune (le rectangle fait 400 dans le document).
  for (const n of list) expect(n.height).toBeGreaterThan(150);
  for (const n of list) expect(n.height).toBeLessThan(250);
  await page.keyboard.press('Control+z');
  expect(await nodes(page)).toHaveLength(1);
});

test('le constructeur de formes réunit les zones traversées', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [450, 450]);
  await page.keyboard.press('e');
  await drag([400, 350], [550, 500]);
  expect(await nodes(page)).toHaveLength(2);
  // Comme dans Affinity, il travaille sur les formes sélectionnées.
  await page.keyboard.press('Control+a');
  await page.getByTestId('tool-shapeBuilder').click();
  await drag([320, 320], [520, 470]);
  const list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].type).toBe('path');
  expect(await history(page)).toContain('history.shapeBuilder');
});

test('l’outil Coin arrondit un angle', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [500, 500]);
  await page.getByTestId('tool-corner').click();
  // Glisser depuis le coin en haut à gauche vers l'intérieur.
  await drag([300, 300], [340, 300]);
  const [n] = await nodes(page);
  expect(n.type).toBe('path');
  expect(n.d).toMatch(/C/);
  expect(await history(page)).toContain('history.corner');
});

test('crée un symbole, en pose une seconde instance, puis le détache', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [450, 450]);
  await page.getByTestId('lib-tab-styles').click();
  await page.getByTestId('create-symbol').click();
  let list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].type).toBe('symbol');
  const d = await doc(page);
  const symbolId = Object.keys(d.symbols)[0];
  expect(d.symbols[symbolId].children).toHaveLength(1);

  // Une seconde instance, posée depuis la bibliothèque.
  await page.getByTestId(`symbol-${symbolId}`).getByRole('button').first().click();
  list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list.every((n) => n.type === 'symbol')).toBe(true);

  // Détacher la seconde : son contenu redevient un objet ordinaire.
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Symboles et styles' }).hover();
  await page.getByRole('menuitem', { name: 'Détacher le symbole' }).click();
  list = await nodes(page);
  expect(list.map((n) => n.type)).toEqual(['symbol', 'rect']);
});

test('enregistre un style et l’applique à un autre objet', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [450, 450]);
  await page.getByTestId('paint-linear').click();
  await page.getByTestId('lib-tab-styles').click();
  await page.getByTestId('save-style').click();
  const d = await doc(page);
  expect(d.styles).toHaveLength(1);
  const styleId = d.styles[0].id;

  await page.keyboard.press('e');
  await drag([500, 300], [650, 450]);
  await page.getByTestId('lib-tab-styles').click();
  await page.getByTestId(`saved-style-${styleId}`).getByRole('button').first().click();
  const list = await nodes(page);
  expect(list[1].fill.type).toBe('linear');
});

test('ajoute un contour en plus et un profil de largeur', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('l');
  await drag([300, 400], [600, 400]);
  await page.getByTestId('tab-stroke').click();
  await page.getByTestId('stroke-profile').selectOption('tapered');
  await page.getByTestId('stroke-align').selectOption('outside');
  await page.getByTestId('stroke-add').click();
  const [line] = await nodes(page);
  expect(line.stroke.profile).toEqual([0.05, 1, 0.05]);
  expect(line.stroke.align).toBe('outside');
  expect(line.strokes).toHaveLength(1);
  expect(line.strokes[0].width).toBeGreaterThan(line.stroke.width);
  await expect(page.getByTestId('stroke-extra-0')).toBeVisible();
});

test('applique un biseau et un dégradé conique', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [550, 550]);
  await page.getByTestId('paint-conic').click();
  await page.getByTestId('tab-effects').click();
  await page.getByRole('checkbox', { name: 'Biseau' }).check();
  await page.getByTestId('effect-bevel-depth').fill('10');
  await page.getByTestId('effect-bevel-depth').press('Enter');
  const [n] = await nodes(page);
  expect(n.fill.type).toBe('conic');
  expect(n.effects).toEqual([expect.objectContaining({ type: 'bevel', enabled: true, depth: 10 })]);
  // Le SVG exporté porte le dégradé approché et le relief.
  const svg = await page.evaluate(() => {
    const p = (window as any).poulpe;
    return p.core.artboardToSvg(p.editor.doc, p.editor.doc.artboards[0]);
  });
  expect(svg).toContain('<filter');
});

test('met un texte en colonnes avec des petites capitales', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('t');
  await drag([300, 300], [700, 500]);
  await page.keyboard.type('Le poulpe dessine en colonnes et en petites capitales sans effort du tout');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
  await page.getByTestId('tab-character').click();
  await page.getByTestId('column-count').fill('2');
  await page.getByTestId('column-count').press('Enter');
  await page.getByTestId('feature-smcp').click();
  const [n] = await nodes(page);
  expect(n.style.columns).toEqual({ count: 2, gap: 16 });
  expect(n.style.features).toEqual(['smcp']);
});
