import { expect, test, type Page } from '@playwright/test';

/* Vectoriel pro (v0.3) : plume, nœuds, crayon, géométrie, contours, effets, texte sur tracé, import SVG. */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
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

test('dessine un tracé fermé à la plume', async ({ page }) => {
  const { at, drag } = await canvas(page);
  await page.keyboard.press('p');
  await page.mouse.click(...at(400, 200));
  // Glisser pose un nœud lisse.
  await drag([550, 250], [600, 330]);
  await page.mouse.click(...at(420, 400));
  // Clic sur le premier nœud : le tracé se ferme et prend le remplissage.
  await page.mouse.click(...at(400, 200));
  const [p] = await nodes(page);
  expect(p.type).toBe('path');
  expect(p.d).toMatch(/C/);
  expect(p.d).toMatch(/Z$/);
  expect(p.fill.type).toBe('solid');
  expect(await history(page)).toEqual(['history.open', 'history.pen']);
});

test('termine un tracé ouvert avec Entrée et modifie ses nœuds', async ({ page }) => {
  const { at, drag } = await canvas(page);
  await page.keyboard.press('p');
  await page.mouse.click(...at(300, 300));
  await page.mouse.click(...at(500, 300));
  await page.mouse.click(...at(500, 450));
  await page.keyboard.press('Enter');
  let [p] = await nodes(page);
  expect(p.fill.type).toBe('none');
  expect(p.d.match(/L/g)).toHaveLength(2);

  // Outil Nœud : clic sur un segment, un nœud s'ajoute.
  await page.keyboard.press('a');
  await page.mouse.click(...at(400, 300));
  [p] = await nodes(page);
  expect(p.d.match(/L/g)).toHaveLength(3);
  // On le supprime avec la touche Suppr.
  await page.keyboard.press('Delete');
  [p] = await nodes(page);
  expect(p.d.match(/L/g)).toHaveLength(2);

  // Glisser un nœud le déplace.
  await drag([500, 450], [520, 500]);
  const before = p;
  [p] = await nodes(page);
  expect(p.y + p.height).toBeGreaterThan(before.y + before.height + 10);
  const h = await history(page);
  expect(h.at(-1)).toBe('history.nodes');

  // Double-clic sur un nœud : il devient lisse (avec des poignées).
  await page.mouse.dblclick(...at(500, 300));
  [p] = await nodes(page);
  expect(p.d).toMatch(/C/);
});

test('outil Nœud : sélection au cadre, ajout, retrait et lasso', async ({ page }) => {
  const { at, drag } = await canvas(page);
  const nodeSel = (): Promise<string[]> => page.evaluate(() => (window as any).poulpe.ui.get().nodeSelection);
  await page.keyboard.press('p');
  await page.mouse.click(...at(300, 300));
  await page.mouse.click(...at(500, 300));
  await page.mouse.click(...at(500, 450));
  await page.keyboard.press('Enter');
  await page.keyboard.press('a');
  // Glisser dans le vide : cadre de sélection des nœuds.
  await drag([450, 250], [560, 480]);
  expect(await nodeSel()).toHaveLength(2);
  // Maj + glisser : ajoute.
  await page.keyboard.down('Shift');
  await drag([250, 250], [350, 350]);
  await page.keyboard.up('Shift');
  expect(await nodeSel()).toHaveLength(3);
  // Glisser avec le bouton droit : retire.
  await page.mouse.move(...at(450, 400));
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(...at(560, 480), { steps: 8 });
  await page.mouse.up({ button: 'right' });
  expect(await nodeSel()).toHaveLength(2);
  // Alt + glisser : lasso.
  await page.keyboard.down('Alt');
  await page.mouse.move(...at(250, 250));
  await page.mouse.down();
  for (const [x, y] of [
    [350, 250],
    [350, 350],
    [250, 350],
  ])
    await page.mouse.move(...at(x, y), { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(await nodeSel()).toEqual(['0:0']);
});

test('outil Nœud : clics avec touches, [ ], menu des nœuds et actions comme dans Affinity', async ({
  page,
}) => {
  const { at, drag } = await canvas(page);
  const nodeSel = (): Promise<string[]> => page.evaluate(() => (window as any).poulpe.ui.get().nodeSelection);
  const path = async () => (await nodes(page))[0];
  await page.keyboard.press('p');
  await page.mouse.click(...at(300, 300));
  await page.mouse.click(...at(500, 300));
  await page.mouse.click(...at(500, 450));
  await page.keyboard.press('Enter');
  await page.keyboard.press('a');

  // Glisser le segment le courbe ; Alt+clic dessus le redresse.
  await drag([400, 300], [400, 250]);
  expect((await path()).d).toMatch(/C/);
  await page.keyboard.down('Alt');
  await page.mouse.click(...at(400, 250));
  await page.keyboard.up('Alt');
  expect((await path()).d).not.toMatch(/C/);

  // Double-clic : nœud lisse ; Alt+clic : de nouveau net.
  await page.mouse.dblclick(...at(500, 300));
  expect((await path()).d).toMatch(/C/);
  await page.keyboard.down('Alt');
  await page.mouse.click(...at(500, 300));
  await page.keyboard.up('Alt');
  expect((await path()).d).not.toMatch(/C/);

  // [ et ] : nœud précédent et suivant.
  await page.mouse.click(...at(300, 300));
  expect(await nodeSel()).toEqual(['0:0']);
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  expect(await nodeSel()).toEqual(['0:2']);
  await page.keyboard.press(']');
  expect(await nodeSel()).toEqual(['0:0']);
  await page.keyboard.press('[');
  expect(await nodeSel()).toEqual(['0:2']);

  // Casser la courbe au nœud du milieu, puis joindre les deux morceaux.
  await page.mouse.click(...at(500, 300));
  await page.getByTestId('node-break').click();
  expect((await path()).d.match(/M/g)).toHaveLength(2);
  await page.getByTestId('node-join').click();
  expect((await path()).d.match(/M/g)).toHaveLength(1);
  expect(await history(page)).toContain('history.join');

  // Ctrl+clic sur un segment : il est supprimé.
  await page.keyboard.down('Control');
  await page.mouse.click(...at(500, 375));
  await page.keyboard.up('Control');
  let p = await path();
  expect(p.d.match(/[LC]/g)).toHaveLength(1);
  expect((await history(page)).at(-1)).toBe('history.deleteSegment');

  // Scinder après le nœud : un nœud au milieu du segment.
  await page.mouse.click(...at(300, 300));
  await page.getByTestId('node-split').click();
  expect((await path()).d.match(/[LC]/g)).toHaveLength(2);

  // Clic droit sur un nœud : menu des nœuds, conversion en nœud intelligent.
  await page.mouse.click(...at(400, 300), { button: 'right' });
  const menu = page.getByTestId('canvas-menu');
  await expect(menu).toContainText('Supprimer en gardant une courbe lisse');
  await page.screenshot({ path: 'test-results/menu-noeud.png' });
  await menu.getByText('Convertir', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Convertir en nœud intelligent' }).click();
  p = await path();
  expect(p.smartNodes).toHaveLength(1);
  // Le nœud intelligent suit quand on déplace un voisin : ses poignées restent alignées.
  await page.mouse.click(...at(300, 300));
  await drag([300, 300], [300, 380]);
  p = await path();
  expect(p.smartNodes).toHaveLength(1);
  expect(p.d).toMatch(/C/);

  // Inverser : le tracé part de l'autre bout.
  const start = p.d.split(/[LC]/)[0];
  await page.getByTestId('node-reverse').click();
  expect((await path()).d.split(/[LC]/)[0]).not.toBe(start);

  // Cadre de transformation : tirer son bord droit étire les nœuds sélectionnés.
  await page.getByTestId('node-transform').click();
  await drag([250, 220], [560, 420]);
  expect((await nodeSel()).length).toBe(3);
  const w0 = (await path()).width;
  await page.screenshot({ path: 'test-results/cadre-noeuds.png' });
  await drag([510, 340], [610, 340]);
  expect((await path()).width).toBeGreaterThan(w0 * 1.2);
});

test('bulle d’aide des outils et création au centre avec Ctrl', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.getByTestId('tool-direct').hover();
  const tip = page.getByTestId('tool-tip');
  await expect(tip).toContainText('Outil Nœud [A]');
  await expect(tip).toContainText('Glisser');
  await page.screenshot({ path: 'test-results/bulle-outil-noeud.png' });
  await page.mouse.move(10, 10);
  await expect(tip).toBeHidden();
  // Ctrl : le rectangle part du centre.
  await page.keyboard.press('u');
  await page.keyboard.down('Control');
  await drag([400, 300], [450, 340]);
  await page.keyboard.up('Control');
  const [r] = await nodes(page);
  expect(r.width).toBeGreaterThan(80);
});

test('menu du clic droit sur le canevas', async ({ page }) => {
  const { at, drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [450, 400]);
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
  await page.mouse.click(...at(380, 350), { button: 'right' });
  const menu = page.getByTestId('canvas-menu');
  await expect(menu).toBeVisible();
  await page.screenshot({ path: 'test-results/menu-clic-droit.png' });
  await menu.getByRole('menuitem', { name: /Dupliquer/ }).click();
  expect(await nodes(page)).toHaveLength(2);
});

test('la souris prend la forme de l’outil sur le document', async ({ page }) => {
  const { at } = await canvas(page);
  const cursor = () => page.getByTestId('canvas').evaluate((c) => getComputedStyle(c).cursor);
  await page.mouse.move(...at(400, 400));
  for (const key of ['v', 'a', 'p', 'u', 'i']) {
    await page.keyboard.press(key);
    await page.mouse.move(...at(402, 401));
    await page.mouse.move(...at(400, 400));
    expect(await cursor()).toContain('data:image/svg+xml');
  }
});

test('outils Remplissage, Transparence, Contour et Largeur de trait', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [450, 400]);
  // Remplissage [G] : dégradé dans la direction du glissement.
  await page.keyboard.press('g');
  await drag([320, 350], [430, 350]);
  let [r] = await nodes(page);
  expect(r.fill.type).toBe('linear');
  expect(r.fill.angle).toBe(0);
  // Transparence [Y] : tout l'objet s'efface jusqu'au transparent, sans toucher au remplissage.
  await page.keyboard.press('y');
  await drag([375, 310], [375, 390]);
  [r] = await nodes(page);
  expect(r.fill.angle).toBe(0);
  expect(r.transparency.angle).toBe(90);
  expect(r.transparency.stops[1].opacity).toBe(0);
  // Contour [O] : glisser vers la droite agrandit la forme (réglage modifiable), Alt garde l'original.
  const before = r.width;
  await page.keyboard.press('o');
  await drag([375, 350], [425, 350]);
  let list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].type).toBe('rect');
  expect(list[0].width).toBe(before);
  expect(list[0].contour.radius).toBeGreaterThan(0);
  await page.keyboard.down('Alt');
  await drag([375, 350], [400, 350]);
  await page.keyboard.up('Alt');
  list = await nodes(page);
  expect(list).toHaveLength(2);

  // Largeur de trait [W] : le trait s'épaissit à l'endroit tiré.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.press('l');
  await drag([300, 500], [600, 500]);
  await page.keyboard.press('w');
  await drag([450, 500], [450, 530]);
  const [line] = await nodes(page);
  // Un point de largeur à l'endroit tiré (au milieu), en plus des deux bouts.
  expect(line.stroke.profile).toHaveLength(3);
  expect(line.stroke.profilePos[1]).toBeCloseTo(0.5, 1);
  expect(Math.max(...line.stroke.profile)).toBeGreaterThan(1);
});

test('dessine au crayon', async ({ page }) => {
  const { at } = await canvas(page);
  await page.keyboard.press('n');
  await page.mouse.move(...at(300, 300));
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) await page.mouse.move(...at(300 + i * 10, 300 + Math.sin(i / 4) * 60));
  await page.mouse.up();
  const [p] = await nodes(page);
  expect(p.type).toBe('path');
  expect(p.stroke.paint.type).toBe('solid');
  expect(p.d).toMatch(/C/);
  expect(await history(page)).toEqual(['history.open', 'history.pencil']);
});

test('réunit, soustrait et divise des formes', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 200], [500, 400]);
  await page.keyboard.press('e');
  await drag([420, 320], [620, 520]);
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Union' }).click();
  let list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].type).toBe('path');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Division' }).click();
  list = await nodes(page);
  expect(list).toHaveLength(3);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Soustraction' }).click();
  list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].fill.color).toBe('#2ba59a');
});

test('convertit une forme en courbes et décale son contour', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 200], [500, 400]);
  await page.keyboard.press('Control+Enter');
  let list = await nodes(page);
  expect(list[0].type).toBe('path');
  await page.getByRole('button', { name: 'Calque' }).click();
  await page.getByRole('menuitem', { name: 'Décalage du tracé…' }).click();
  await page.getByTestId('offset-distance').fill('20');
  await page.getByTestId('offset-go').click();
  list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list[1].width).toBeGreaterThan(list[0].width + 30);
});

test('règle pointillés, flèches et effets', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('l');
  await drag([300, 300], [600, 300]);
  await page.getByTestId('tab-stroke').click();
  await page.getByLabel('Style').selectOption('dashed');
  await page.getByLabel('Fin').selectOption('triangle');
  let [line] = await nodes(page);
  expect(line.stroke.dash).toEqual([3, 2]);
  expect(line.stroke.end).toBe('triangle');

  await page.getByTestId('tab-effects').click();
  await page.getByRole('checkbox', { name: 'Ombre portée' }).check();
  await page.getByTestId('effect-dropShadow-blur').fill('30');
  await page.getByTestId('effect-dropShadow-blur').press('Enter');
  [line] = await nodes(page);
  expect(line.effects).toEqual([expect.objectContaining({ type: 'dropShadow', enabled: true, blur: 30 })]);
});

test('place un texte sur un cercle puis le vectorise', async ({ page }) => {
  const { at, drag } = await canvas(page);
  await page.keyboard.press('e');
  await drag([300, 200], [600, 500]);
  await page.keyboard.press('t');
  await page.mouse.click(...at(700, 600));
  await page.keyboard.type('Poulpe sur un cercle');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Placer le texte sur le tracé' }).click();
  let list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].type).toBe('text');
  expect(list[0].path.offset).toBe(0.75);
  await page.getByRole('button', { name: 'Texte', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Vectoriser le texte' }).click();
  await expect.poll(async () => (await nodes(page))[0].type).toBe('path');
  list = await nodes(page);
  expect(list[0].d.length).toBeGreaterThan(200);
});

test('importe un SVG en objets modifiables', async ({ page }) => {
  const ok = await page.evaluate(() =>
    (window as any).poulpe.vector.placeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="40" height="40" fill="#e5484d"/><circle cx="70" cy="70" r="20" fill="blue"/></svg>',
      'logo',
    ),
  );
  expect(ok).toBe(true);
  const [g] = await nodes(page);
  expect(g.type).toBe('group');
  expect(g.name).toBe('logo');
  expect(g.children.map((c: AnyNode) => c.type)).toEqual(['path', 'path']);
  expect(await history(page)).toEqual(['history.open', 'history.import']);
});
