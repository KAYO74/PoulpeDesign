import { expect, test, type Page } from '@playwright/test';

/*
 * Version 1.2 : outils de tracé comme dans Affinity Designer. Plume (modes, élastique, reprise d'une
 * courbe, Ctrl), crayon (fermeture, pression, Sculpter), cutter à main levée, constructeur de
 * formes, remplissage de zone et pinceau vectoriel.
 */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
const history = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().history);
const selection = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().selection);

/** Position à l'écran (fenêtre) d'un point du document. */
async function screen(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const v = await page.evaluate(() => (window as any).poulpe.ui.get().view);
  return [box.x + x * v.zoom + v.panX, box.y + y * v.zoom + v.panY];
}

async function click(page: Page, x: number, y: number) {
  await page.mouse.click(...(await screen(page, x, y)));
}

async function drag(page: Page, ...pts: [number, number][]) {
  await page.mouse.move(...(await screen(page, ...pts[0])));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...(await screen(page, ...p)), { steps: 8 });
  await page.mouse.up();
}

/** Trait au stylet (pression de 0 à 1 en chaque point), par le protocole de Chrome. */
async function penStroke(page: Page, pts: [number, number, number][]) {
  const cdp = await page.context().newCDPSession(page);
  const send = async (type: string, [x, y, force]: [number, number, number]) => {
    const [sx, sy] = await screen(page, x, y);
    await cdp.send('Input.dispatchMouseEvent', {
      type: type as 'mousePressed',
      x: sx,
      y: sy,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      pointerType: 'pen',
      force,
    });
  };
  await send('mouseMoved', pts[0]);
  await send('mousePressed', pts[0]);
  for (const p of pts.slice(1)) await send('mouseMoved', p);
  await send('mouseReleased', pts[pts.length - 1]);
  await cdp.detach();
}

/** Points d'un cercle (document), refermé sur son départ. */
const circle = (cx: number, cy: number, r: number): [number, number][] =>
  Array.from({ length: 25 }, (_, i) => [
    cx + r * Math.cos((i / 24) * Math.PI * 2),
    cy + r * Math.sin((i / 24) * Math.PI * 2),
  ]);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('plume : modes Polygone, Intelligent et Ligne, et option Élastique', async ({ page }) => {
  await page.keyboard.press('p');
  // Élastique : coché par défaut.
  const rubber = page.getByTestId('pen-rubber-band');
  await expect(rubber).toBeChecked();
  await rubber.uncheck();
  await expect(rubber).not.toBeChecked();
  await rubber.check();

  // Polygone : segments droits, un glisser déplace le nœud posé au lieu de tirer des poignées.
  await page.getByTestId('pen-mode-polygon').click();
  await expect(page.getByTestId('pen-mode-polygon')).toHaveAttribute('aria-pressed', 'true');
  await click(page, 200, 200);
  await drag(page, [500, 200], [620, 250]);
  await click(page, 500, 500);
  await page.keyboard.press('Enter');
  let list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].d).not.toMatch(/C/);
  expect(list[0].d.match(/L/g)).toHaveLength(2);
  expect(list[0].x + list[0].width).toBeGreaterThan(600);

  // Intelligent : de simples clics donnent une courbe lisse, aux nœuds intelligents.
  await page.getByTestId('pen-mode-smart').click();
  await click(page, 200, 800);
  await click(page, 400, 650);
  await click(page, 600, 800);
  await page.keyboard.press('Enter');
  list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list[1].d).toMatch(/C/);
  expect(list[1].smartNodes).toHaveLength(3);

  // Ligne : chaque glisser fait une ligne droite à part.
  await page.getByTestId('pen-mode-line').click();
  await drag(page, [200, 1000], [500, 1000]);
  await drag(page, [200, 1150], [500, 1250]);
  list = await nodes(page);
  expect(list).toHaveLength(4);
  for (const n of list.slice(2)) {
    expect(n.d.match(/L/g)).toHaveLength(1);
    expect(n.width).toBeGreaterThan(250);
  }
  expect(await history(page)).toEqual(['history.open', ...Array(4).fill('history.pen')]);
});

test('plume : Ctrl déplace les nœuds en cours de tracé, puis la courbe se prolonge par son extrémité', async ({
  page,
}) => {
  await page.keyboard.press('p');
  await click(page, 200, 200);
  await click(page, 400, 200);
  // Ctrl + glisser le premier nœud : il se déplace, sans nouveau nœud.
  await page.keyboard.down('Control');
  await drag(page, [200, 200], [200, 300]);
  await page.keyboard.up('Control');
  await click(page, 400, 400);
  await page.keyboard.press('Enter');
  let [p] = await nodes(page);
  expect(p.d.match(/L/g)).toHaveLength(2);
  expect(p.y).toBeCloseTo(200, 0);
  expect(p.height).toBeCloseTo(200, 0);
  expect(p.d).toMatch(/^M\s*200[ ,]300/);
  expect(await history(page)).toEqual(['history.open', 'history.pen']);

  // La courbe est sélectionnée : un clic sur son extrémité la reprend, au lieu d'en commencer une autre.
  await click(page, 400, 400);
  await click(page, 600, 400);
  await page.keyboard.press('Enter');
  const list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe(p.id);
  expect(list[0].d.match(/L/g)).toHaveLength(3);
  expect(list[0].width).toBeCloseTo(400, 0);
  expect(await history(page)).toEqual(['history.open', 'history.pen', 'history.pen']);
  await page.keyboard.press('Control+z');
  [p] = await nodes(page);
  expect(p.d.match(/L/g)).toHaveLength(2);
});

test('plume : une commande pendant le tracé (opacité au clavier) ne double pas la courbe', async ({
  page,
}) => {
  await page.keyboard.press('p');
  await click(page, 200, 200);
  await click(page, 400, 200);
  // La touche 5 valide le geste en cours : la suite du tracé doit reprendre la même courbe.
  await page.keyboard.press('5');
  await click(page, 400, 400);
  await page.keyboard.press('Enter');
  const list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].opacity).toBeCloseTo(0.5);
  expect(list[0].d.match(/L/g)).toHaveLength(2);
  expect(list[0].height).toBeCloseTo(200, 0);
  expect((await history(page)).at(-1)).toBe('history.pen');
});

test('crayon : fermeture automatique, pression du stylet et mode Sculpter', async ({ page }) => {
  await page.keyboard.press('n');
  // Un trait qui revient à son départ se ferme.
  await drag(page, ...circle(300, 300, 150));
  let list = await nodes(page);
  expect(list[0].d).toMatch(/Z$/i);
  // Sans « Fermer automatiquement », il reste ouvert.
  await page.getByTestId('pencil-close').uncheck();
  await drag(page, ...circle(700, 300, 150));
  list = await nodes(page);
  expect(list[1].d).not.toMatch(/Z/i);

  // Stylet : la pression devient un profil de largeur (fine au début, épaisse à la fin).
  const pts: [number, number, number][] = Array.from({ length: 21 }, (_, i) => [
    200 + i * 30,
    700 + Math.sin(i / 3) * 40,
    0.1 + (0.9 * i) / 20,
  ]);
  await penStroke(page, pts);
  list = await nodes(page);
  const stroke = list[2].stroke;
  expect(stroke.profile.length).toBeGreaterThan(4);
  expect(stroke.profile[0]).toBeLessThan(0.4);
  expect(stroke.profile.at(-1)).toBeGreaterThan(0.8);

  // Sculpter : un trait parti de l'extrémité de la courbe sélectionnée la prolonge.
  await page.getByTestId('pencil-sculpt').check();
  const before = list[2];
  const [ex, ey] = [pts[20][0], pts[20][1]];
  await drag(page, [ex, ey], [ex + 60, ey + 40], [ex + 150, ey + 80]);
  list = await nodes(page);
  expect(list).toHaveLength(3);
  expect(list[2].id).toBe(before.id);
  expect(list[2].x + list[2].width).toBeGreaterThan(before.x + before.width + 100);
  expect((await history(page)).at(-1)).toBe('history.sculpt');
});

test('cutter : un trait à main levée coupe la forme en morceaux', async ({ page }) => {
  await page.keyboard.press('u');
  await drag(page, [300, 300], [700, 700]);
  await page.keyboard.press('k');
  // Un V : entre par la gauche, descend, ressort à droite.
  await drag(page, [250, 400], [500, 650], [750, 400]);
  const list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list.every((n) => n.type === 'path')).toBe(true);
  expect(await history(page)).toEqual(['history.open', 'history.add', 'history.knife']);
  // Une coupe qui s'arrête dans la forme ne coupe rien.
  await page.keyboard.press('Control+z');
  await drag(page, [250, 500], [500, 500]);
  expect(await nodes(page)).toHaveLength(1);
});

test('constructeur de formes : ajouter, soustraire et créer des zones', async ({ page }) => {
  await page.keyboard.press('u');
  await drag(page, [200, 200], [500, 500]);
  await page.keyboard.press('e');
  await drag(page, [350, 350], [650, 650]);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('s');
  await expect(page.getByTestId('builder-mode-add')).toHaveAttribute('aria-pressed', 'true');

  // La zone survolée s'éclaire, puis s'éteint quand on change d'outil.
  const [px, py] = await screen(page, 440, 440);
  const pixel = async () =>
    (await page.screenshot({ clip: { x: px, y: py, width: 1, height: 1 } })).toString('base64');
  const plain = await pixel();
  await page.mouse.move(px, py);
  await expect.poll(pixel).not.toBe(plain);
  await page.keyboard.press('v');
  await page.mouse.move(...(await screen(page, 900, 900)));
  await expect.poll(pixel).toBe(plain);
  await page.keyboard.press('s');

  // Ajouter : la zone commune devient une forme à part.
  await click(page, 440, 440);
  let list = await nodes(page);
  expect(list).toHaveLength(3);
  expect(await history(page)).toEqual(['history.open', 'history.add', 'history.add', 'history.shapeBuilder']);
  await page.keyboard.press('Control+z');

  // - : Soustraire, la zone commune disparaît des deux formes.
  await page.keyboard.press('-');
  await expect(page.getByTestId('builder-mode-subtract')).toHaveAttribute('aria-pressed', 'true');
  await click(page, 440, 440);
  list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list.every((n) => n.type === 'path')).toBe(true);
  await page.keyboard.press('Control+z');

  // * : Créer, la zone du rectangle seul devient une forme, les originaux restent.
  await page.keyboard.press('*');
  await click(page, 250, 250);
  list = await nodes(page);
  expect(list.map((n) => n.type)).toEqual(['rect', 'ellipse', 'path']);
  await page.keyboard.press('Control+z');

  // + puis glisser à travers toutes les zones : une seule forme.
  await page.keyboard.press('+');
  await drag(page, [250, 250], [440, 440], [600, 600]);
  list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].type).toBe('path');
  expect(list[0].width).toBeGreaterThan(400);
  expect(await selection(page)).toEqual([list[0].id]);
});

test('remplissage de zone : un clic dans une zone fermée par des traits la remplit', async ({ page }) => {
  // Un dièse : deux lignes verticales et deux horizontales.
  await page.keyboard.press('l');
  await drag(page, [300, 200], [300, 800]);
  await drag(page, [600, 200], [600, 800]);
  await drag(page, [200, 300], [700, 300]);
  await drag(page, [200, 700], [700, 700]);
  await page.keyboard.press('r');
  await click(page, 450, 500);
  let list = await nodes(page);
  expect(list).toHaveLength(5);
  // La zone se place sous les traits qui la bordent.
  const z = list[0];
  expect(z.type).toBe('path');
  expect(z.fill.type).toBe('solid');
  expect(z.x).toBeCloseTo(300, -1);
  expect(z.y).toBeCloseTo(300, -1);
  expect(z.width).toBeCloseTo(300, -1);
  expect(z.height).toBeCloseTo(400, -1);
  expect((await history(page)).at(-1)).toBe('history.vectorFill');
  // Hors d'une zone fermée : rien.
  await click(page, 450, 1000);
  list = await nodes(page);
  expect(list).toHaveLength(5);
});

test('pinceau vectoriel : largeur, opacité, effilement et pression', async ({ page }) => {
  await page.keyboard.press('b');
  const width = page.getByTestId('brush-width');
  await width.fill('12');
  await width.press('Enter');
  const opacity = page.getByTestId('brush-opacity');
  await opacity.fill('50');
  await opacity.press('Enter');
  await drag(page, [200, 300], [400, 250], [600, 350], [800, 300]);
  let [b] = await nodes(page);
  expect(b.type).toBe('path');
  expect(b.fill.type).toBe('none');
  expect(b.stroke.width).toBe(12);
  expect(b.stroke.cap).toBe('round');
  expect(b.opacity).toBeCloseTo(0.5);
  // Effilement des deux bouts (sans stylet).
  expect(b.stroke.profile[0]).toBeLessThan(0.2);
  expect(b.stroke.profile.at(-1)).toBeLessThan(0.2);
  expect(await history(page)).toEqual(['history.open', 'history.vectorBrush']);

  // ] élargit le pinceau.
  await page.keyboard.press(']');
  await expect(width).toHaveValue('15');

  // Au stylet : la pression règle l'épaisseur.
  await penStroke(
    page,
    Array.from({ length: 16 }, (_, i) => [200 + i * 40, 700, 1 - (0.9 * i) / 15] as [number, number, number]),
  );
  [, b] = await nodes(page);
  expect(b.stroke.width).toBe(15);
  expect(b.stroke.profile[0]).toBeGreaterThan(0.8);
  expect(b.stroke.profile.at(-1)).toBeLessThan(0.3);
});
