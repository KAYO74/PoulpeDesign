import { expect, test, type Page } from '@playwright/test';

/*
 * Version 1.2, outils de forme : rectangle arrondi, nouvelles formes, poignées rouges, coins des
 * rectangles et outil Coin non destructif.
 */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
const history = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().history);
const setTool = (page: Page, tool: string) =>
  page.evaluate((tool) => (window as any).poulpe.ui.set({ tool }), tool);

async function canvas(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y];
  const drag = async (a: [number, number], b: [number, number], steps = 8) => {
    await page.mouse.move(...at(...a));
    await page.mouse.down();
    await page.mouse.move(...at(...b), { steps });
    await page.mouse.up();
  };
  /** Position à l'écran (relative au canevas) d'un point du document. */
  const toScreen = (x: number, y: number): Promise<[number, number]> =>
    page.evaluate(
      ([x, y]) => {
        const v = (window as any).poulpe.ui.get().view;
        return [x * v.zoom + v.panX, y * v.zoom + v.panY] as [number, number];
      },
      [x, y],
    );
  const zoom = (): Promise<number> => page.evaluate(() => (window as any).poulpe.ui.get().view.zoom);
  return { at, drag, toScreen, zoom };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('le rectangle arrondi se dessine comme le rectangle', async ({ page }) => {
  const { at, drag } = await canvas(page);
  // U, puis U encore : du Rectangle au Rectangle arrondi.
  await page.keyboard.press('u');
  await page.keyboard.press('u');
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().tool)).toBe('roundRect');
  await expect(page.getByTestId('round-radius')).toHaveValue('20');
  await page.getByTestId('round-radius').fill('30');
  await page.getByTestId('round-radius').press('Enter');
  // Maj : un carré.
  await page.keyboard.down('Shift');
  await drag([300, 300], [500, 400]);
  await page.keyboard.up('Shift');
  let [r] = await nodes(page);
  expect(r.type).toBe('rect');
  expect(r.cornerRadius).toBe(30);
  expect(r.width).toBeCloseTo(r.height, 3);
  // Un simple clic : une forme de taille standard.
  await page.mouse.click(...at(700, 300));
  r = (await nodes(page))[1];
  expect(r.width).toBe(100);
  expect(r.cornerRadius).toBe(30);
});

test('les nouvelles formes se créent et gardent leurs réglages', async ({ page }) => {
  const { drag } = await canvas(page);
  // Le triangle, depuis le menu de la famille des formes.
  await page.getByTestId('toolgroup-more-rect').click();
  await page.getByTestId('toolmenu-triangle').click();
  await drag([180, 220], [270, 310]);
  const kinds = ['arrow', 'callout', 'donut', 'pie', 'cog', 'cloud', 'heart', 'spiral'];
  for (let i = 0; i < kinds.length; i++) {
    await setTool(page, kinds[i]);
    const x = 180 + (i % 4) * 110,
      y = 360 + Math.floor(i / 4) * 120;
    await drag([x, y], [x + 90, y + 90]);
  }
  const list = await nodes(page);
  expect(list.map((n) => n.shape?.kind)).toEqual(['triangle', ...kinds]);
  expect(list.every((n) => n.type === 'path' && n.d.length > 10)).toBe(true);
  expect(list[list.length - 1].fill.type).toBe('none');
  // Réglage par défaut des nouvelles formes, dans la barre contextuelle.
  await setTool(page, 'cog');
  await page.evaluate(() => (window as any).poulpe.editor.select([]));
  await page.getByTestId('shape-param-teeth').fill('7');
  await page.getByTestId('shape-param-teeth').press('Enter');
  await drag([300, 600], [400, 700]);
  const cog = (await nodes(page)).at(-1)!;
  expect(cog.shape.params.teeth).toBe(7);
  // Champ de la forme sélectionnée : il la modifie.
  await page.getByTestId('shape-param-hole').fill('10');
  await page.getByTestId('shape-param-hole').press('Enter');
  expect((await nodes(page)).at(-1)!.shape.params.hole).toBeCloseTo(0.1, 5);
  // L'export SVG voit les formes.
  const svg = await page.evaluate(() => {
    const p = (window as any).poulpe;
    return p.core.artboardToSvg(p.editor.doc, p.editor.doc.artboards[0]);
  });
  expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(10);
});

test('les poignées rouges règlent la forme, le double-clic les remet à zéro', async ({ page }) => {
  const { drag, toScreen, zoom } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [500, 460]);
  await page.keyboard.press('v');
  let [r] = await nodes(page);
  // Poignée d'arrondi : sur le bord du haut, près du coin haut gauche.
  const z = await zoom();
  const h = await toScreen(r.x + 14 / z, r.y);
  await drag(h, [h[0] + 30, h[1]]);
  [r] = await nodes(page);
  expect(r.cornerRadius).toBeCloseTo(30 / z, 0);
  expect(await history(page)).toContain('history.shapeParams');
  // Le rayon reste en pixels quand on étire le rectangle.
  const radius = r.cornerRadius;
  const right = await toScreen(r.x + r.width, r.y + r.height / 2);
  await drag(right, [right[0] + 120, right[1]]);
  [r] = await nodes(page);
  expect(r.cornerRadius).toBe(radius);
  // Double-clic sur la poignée : plus d'arrondi.
  const h2 = await toScreen(r.x + r.cornerRadius, r.y);
  await page.mouse.dblclick(...(await canvas(page)).at(...h2));
  [r] = await nodes(page);
  expect(r.cornerRadius).toBe(0);

  // Triangle : la poignée du sommet le déplace.
  await setTool(page, 'triangle');
  await drag([300, 600], [500, 760]);
  await page.keyboard.press('v');
  const tri = (await nodes(page))[1];
  const apex = await toScreen(tri.x + tri.width / 2, tri.y);
  await drag(apex, [apex[0] - 50, apex[1]]);
  const moved = (await nodes(page))[1];
  expect(moved.shape.params.apex).toBeLessThan(0.4);
  expect(moved.x).toBeCloseTo(tri.x, 3);
});

test('coins distincts et formes de coins d’un rectangle', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [500, 460]);
  await page.getByTestId('rect-radius').fill('12');
  await page.getByTestId('rect-radius').press('Enter');
  await page.getByTestId('rect-link').click();
  let [r] = await nodes(page);
  expect(r.radii).toEqual([12, 12, 12, 12]);
  await page.getByTestId('rect-radius-2').fill('40');
  await page.getByTestId('rect-radius-2').press('Enter');
  await page.getByTestId('rect-corner-type').selectOption('cutout');
  [r] = await nodes(page);
  expect(r.radii).toEqual([12, 12, 40, 12]);
  expect(r.cornerType).toBe('cutout');
  // La conversion en courbes fige le vrai contour.
  await page.evaluate(() => (window as any).poulpe.vector.convertToCurves());
  [r] = await nodes(page);
  expect(r.type).toBe('path');
  expect(r.d.match(/L/g).length).toBeGreaterThanOrEqual(10);
});

test("l'outil Coin pose des coins modifiables sans figer la forme", async ({ page }) => {
  const { drag, toScreen } = await canvas(page);
  await setTool(page, 'triangle');
  await drag([300, 300], [500, 500]);
  await page.keyboard.press('c');
  let [tri] = await nodes(page);
  const bottomRight = await toScreen(tri.x + tri.width, tri.y + tri.height);
  // Glisser depuis le coin bas droit vers l'intérieur.
  await drag(bottomRight, [bottomRight[0] - 30, bottomRight[1]]);
  [tri] = await nodes(page);
  expect(tri.shape.kind).toBe('triangle');
  const r1 = tri.corners['0:1'].radius;
  expect(r1).toBeGreaterThan(20);
  // Un second glissement change le même coin.
  await drag(bottomRight, [bottomRight[0] - 60, bottomRight[1]]);
  [tri] = await nodes(page);
  expect(tri.corners['0:1'].radius).toBeGreaterThan(r1);
  // Forme et application à tous les coins depuis la barre contextuelle.
  await page.getByTestId('corner-kind').selectOption('straight');
  [tri] = await nodes(page);
  expect(tri.corners['0:1'].type).toBe('straight');
  await page.getByTestId('corner-radius').fill('8');
  await page.getByTestId('corner-radius').press('Enter');
  await page.getByTestId('corner-apply-all').click();
  [tri] = await nodes(page);
  expect(tri.corners).toEqual({ '*': { radius: 8, type: 'straight' } });
  // L'outil Nœud modifie toujours la forme de base : les coins restent.
  await page.keyboard.press('a');
  const apex = await toScreen(tri.x + tri.width / 2, tri.y);
  await drag(apex, [apex[0], apex[1] - 40]);
  [tri] = await nodes(page);
  expect(tri.shape).toBeUndefined();
  expect(tri.corners).toEqual({ '*': { radius: 8, type: 'straight' } });
  expect(tri.height).toBeGreaterThan(400);
  // Retirer tous les coins.
  await page.keyboard.press('c');
  await page.getByTestId('corner-clear').click();
  [tri] = await nodes(page);
  expect(tri.corners).toBeUndefined();
  expect(await history(page)).toContain('history.corner');
  // Un rectangle reçoit ses coins dans ses rayons.
  await page.keyboard.press('u');
  await drag([600, 300], [800, 450]);
  await page.keyboard.press('c');
  const r = (await nodes(page))[1];
  const tl = await toScreen(r.x, r.y);
  await drag(tl, [tl[0] + 25, tl[1]]);
  const r2 = (await nodes(page))[1];
  expect(r2.type).toBe('rect');
  expect(r2.radii[0]).toBeGreaterThan(20);
  expect(r2.radii[1]).toBe(0);
});
