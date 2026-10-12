import { expect, test, type Page } from '@playwright/test';

/* Version 1.2 : outils Remplissage, Transparence, Contour et Largeur de trait comme dans Affinity. */

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

/** Couleur affichée sur le canevas en un point (pixels CSS du canevas). */
const pixel = (page: Page, x: number, y: number): Promise<number[]> =>
  page.evaluate(
    ([x, y]) => {
      const c = (window as any).poulpe.controller().canvas as HTMLCanvasElement;
      const k = c.width / c.getBoundingClientRect().width;
      return [...c.getContext('2d')!.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data];
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

test('Remplissage : tracé exact, poignées, arrêts et types', async ({ page }) => {
  const { at, drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [500, 400]);
  await page.keyboard.press('g');
  await drag([320, 350], [480, 350]);
  let [r] = await nodes(page);
  expect(r.fill.type).toBe('linear');
  expect(r.fill.x1).toBeCloseTo(0.1, 2);
  expect(r.fill.x2).toBeCloseTo(0.9, 2);
  // La ligne reste affichée : on tire la poignée de fin.
  await drag([480, 350], [440, 390]);
  [r] = await nodes(page);
  expect(r.fill.x2).toBeCloseTo(0.7, 2);
  expect(r.fill.y2).toBeCloseTo(0.9, 2);
  expect(r.fill.x1).toBeCloseTo(0.1, 2);
  // Clic sur la ligne : un nouvel arrêt, choisi, que la barre recolore.
  await page.mouse.click(...at(380, 370));
  [r] = await nodes(page);
  expect(r.fill.stops).toHaveLength(3);
  expect(r.fill.stops[2].offset).toBeCloseTo(0.5, 1);
  await page.getByTestId('paint-stop-color').fill('#00ff00');
  [r] = await nodes(page);
  expect(r.fill.stops[2].color).toBe('#00ff00');
  await expect(page.getByTestId('paint-stop-position')).toHaveValue('50');
  // Suppr retire l'arrêt choisi, pas l'objet.
  await page.getByTestId('paint-stop-color').blur();
  await page.keyboard.press('Delete');
  let list = await nodes(page);
  expect(list).toHaveLength(1);
  expect(list[0].fill.stops).toHaveLength(2);
  // Un arrêt tiré hors de la ligne disparaît.
  await page.mouse.click(...at(380, 370));
  expect((await nodes(page))[0].fill.stops).toHaveLength(3);
  await drag([380, 370], [330, 470]);
  expect((await nodes(page))[0].fill.stops).toHaveLength(2);
  // Inverser, pivoter, changer de type en gardant les couleurs.
  const colors = (await nodes(page))[0].fill.stops.map((s: AnyNode) => s.color);
  await page.getByTestId('paint-reverse').click();
  [r] = await nodes(page);
  expect(r.fill.stops.map((s: AnyNode) => s.color)).toEqual([...colors].reverse());
  await page.getByTestId('paint-type').selectOption('elliptical');
  [r] = await nodes(page);
  expect(r.fill.type).toBe('radial');
  expect(r.fill.ratio).toBe(0.5);
  expect(r.fill.cx).toBeCloseTo(0.1, 2);
  await page.getByTestId('paint-rotate').click();
  const angle = r.fill.angle;
  [r] = await nodes(page);
  expect(r.fill.angle).toBeCloseTo(angle + 90, 0);
  // Remplissage ou contour : le dégradé va sur le contour.
  await page.getByTestId('paint-target-stroke').click();
  await page.getByTestId('paint-type').selectOption('conic');
  [r] = await nodes(page);
  expect(r.stroke.paint.type).toBe('conic');
  expect(r.fill.type).toBe('radial');
  expect(await history(page)).toEqual([
    'history.open',
    'history.add',
    'history.gradient',
    'history.gradient',
    'history.gradientStop',
    'history.style',
    'history.gradientStop',
    'history.gradientStop',
    'history.gradientStop',
    'history.gradient',
    'history.style',
    'history.gradient',
    'history.style',
  ]);
  await page.screenshot({ path: 'test-results/v12-remplissage.png' });
});

test('Transparence : tout l’objet s’efface sans toucher au remplissage', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [500, 400]);
  await page.evaluate(() => {
    const p = (window as any).poulpe;
    const id = p.editor.selection[0];
    p.editor.apply('test', (d: any) => {
      const n = d.artboards[0].children.find((c: any) => c.id === id);
      n.fill = { type: 'solid', color: '#000000' };
      n.stroke = { paint: { type: 'none' }, width: 0 };
    });
  });
  await page.keyboard.press('y');
  await drag([300, 350], [500, 350]);
  let [r] = await nodes(page);
  expect(r.fill).toEqual({ type: 'solid', color: '#000000' });
  expect(r.transparency.type).toBe('linear');
  expect(r.transparency.stops.map((s: AnyNode) => s.opacity)).toEqual([1, 0]);
  // À gauche l'objet est opaque (noir), à droite on voit le fond blanc.
  const left = await pixel(page, 310, 320);
  const right = await pixel(page, 490, 320);
  expect(left[0]).toBeLessThan(40);
  expect(right[0]).toBeGreaterThan(215);
  // Export SVG : un masque.
  const svg = await page.evaluate(() => {
    const p = (window as any).poulpe;
    return p.core.artboardToSvg(p.editor.doc, p.editor.doc.artboards[0]);
  });
  expect(svg).toContain('<mask');
  // Type, opacité d'un arrêt, puis retrait.
  await page.getByTestId('transparency-type').selectOption('radial');
  [r] = await nodes(page);
  expect(r.transparency.type).toBe('radial');
  await page.getByTestId('paint-stop-opacity').fill('50');
  await page.getByTestId('paint-stop-opacity').press('Enter');
  [r] = await nodes(page);
  expect(r.transparency.stops.some((s: AnyNode) => s.opacity === 0.5)).toBe(true);
  await page.getByTestId('transparency-remove').click();
  [r] = await nodes(page);
  expect(r.transparency).toBeUndefined();
  expect(r.fill).toEqual({ type: 'solid', color: '#000000' });
});

test('Contour : décalage modifiable, retiré, puis appliqué par Convertir en courbes', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([300, 300], [500, 400]);
  const width = (await nodes(page))[0].width;
  await page.keyboard.press('o');
  await drag([400, 350], [430, 350]);
  let [r] = await nodes(page);
  expect(r.type).toBe('rect');
  expect(r.width).toBe(width);
  expect(r.contour.radius).toBeGreaterThan(0);
  await page.getByTestId('contour-radius').fill('12');
  await page.getByTestId('contour-radius').press('Enter');
  await page.getByTestId('contour-join').selectOption('miter');
  [r] = await nodes(page);
  expect(r.contour).toEqual({ radius: 12, join: 'miter', miterLimit: 4 });
  await page.getByTestId('contour-remove').click();
  [r] = await nodes(page);
  expect(r.contour).toBeUndefined();
  await page.getByTestId('contour-radius').fill('10');
  await page.getByTestId('contour-radius').press('Enter');
  await page.evaluate(() => (window as any).poulpe.vector.convertToCurves());
  await expect.poll(async () => (await nodes(page))[0].type).toBe('path');
  [r] = await nodes(page);
  expect(r.contour).toBeUndefined();
  expect(r.width).toBeCloseTo(width + 20, 0);
});

test('Largeur de trait : des points de largeur où l’on veut', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('l');
  await drag([300, 500], [700, 500]);
  await page.keyboard.press('w');
  // Un point au premier quart de la ligne.
  await drag([400, 500], [400, 530]);
  let [line] = await nodes(page);
  expect(line.stroke.profilePos).toHaveLength(3);
  expect(line.stroke.profilePos[1]).toBeCloseTo(0.25, 2);
  expect(line.stroke.profile[1]).toBeGreaterThan(1);
  // On glisse le point le long du trait.
  await drag([400, 500], [500, 505]);
  [line] = await nodes(page);
  expect(line.stroke.profilePos[1]).toBeCloseTo(0.5, 2);
  // La barre donne la largeur du point en pixels.
  await expect(page.getByTestId('width-point')).not.toHaveValue('');
  // Suppr retire le point : le trait redevient constant.
  await page.keyboard.press('Delete');
  [line] = await nodes(page);
  expect(line.stroke.profile).toBeUndefined();
  await drag([600, 500], [600, 480]);
  [line] = await nodes(page);
  expect(line.stroke.profilePos[1]).toBeCloseTo(0.75, 2);
  await page.getByTestId('width-reset').click();
  [line] = await nodes(page);
  expect(line.stroke.profile).toBeUndefined();
  expect(line.stroke.profilePos).toBeUndefined();
});
