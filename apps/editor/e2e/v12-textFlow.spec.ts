import { expect, test, type Page } from '@playwright/test';

/*
 * Version 1.2, coulée du texte comme dans Affinity Publisher : habillage des objets (panneau
 * Habillage), coulée automatique (Maj+clic sur le « + » rouge), cadre lié tracé en glissant,
 * cadres de texte de forme et réglages des cadres.
 */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
const docOf = (page: Page): Promise<AnyNode> => page.evaluate(() => (window as any).poulpe.editor.doc);
const history = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().history);
const flow = (page: Page, id: string): Promise<AnyNode[]> =>
  page.evaluate((id) => (window as any).poulpe.textFlow.flowLayout(id), id);

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

const WORDS = Array.from({ length: 140 }, (_, i) => `mot${i}`).join(' ');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('persona-layout').click();
});

/** Cadre de texte tracé avec l'outil Cadre de texte (coordonnées du document), rempli de texte. */
async function textFrame(page: Page, x: number, y: number, w: number, h: number, text = WORDS) {
  const { drag } = await canvas(page);
  const ab = (await docOf(page)).artboards[0];
  await page.evaluate(() => (window as any).poulpe.ui.set({ tool: 'frameText' }));
  await drag(await toScreen(page, ab.x + x, ab.y + y), await toScreen(page, ab.x + x + w, ab.y + y + h));
  await page.keyboard.insertText(text);
  await page.keyboard.press('Escape');
  const all = await nodes(page);
  return all[all.length - 1];
}

test('habillage : un rectangle posé sur un cadre repousse son texte des deux côtés', async ({ page }) => {
  const frame = await textFrame(page, 100, 100, 700, 600);
  expect(frame.frame).toBe(true);
  const ab = (await docOf(page)).artboards[0];
  // Un rectangle au milieu du cadre, au-dessus de lui dans les calques.
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag(await toScreen(page, ab.x + 350, ab.y + 200), await toScreen(page, ab.x + 550, ab.y + 400));
  await page.keyboard.press('v');
  const rect = (await nodes(page)).at(-1)!;
  expect(rect.type).toBe('rect');

  // Panneau Habillage : style Carré, distance 10 px.
  await page.getByTestId('wrap-button').click();
  await page.getByTestId('wrap-square').click();
  const distance = page.getByTestId('wrap-distance');
  await distance.fill('10');
  await distance.press('Enter');
  const wrapped = (await nodes(page)).at(-1)!;
  expect(wrapped.wrap).toEqual({ type: 'square', distance: 10 });

  // Les lignes à hauteur du rectangle passent à gauche et à droite, à 10 px de lui.
  const r = { x0: wrapped.x - frame.x - 10, x1: wrapped.x + wrapped.width - frame.x + 10 };
  const top = wrapped.y - frame.y - 10,
    bottom = wrapped.y + wrapped.height - frame.y + 10;
  const lines = (await flow(page, frame.id))[0].lines;
  const beside = lines.filter((l: AnyNode) => l.top + l.height > top && l.top < bottom);
  expect(beside.length).toBeGreaterThan(4);
  for (const l of beside) expect(l.right <= r.x0 + 0.01 || l.left >= r.x1 - 0.01).toBe(true);
  expect(beside.some((l: AnyNode) => l.left >= r.x1 - 0.01)).toBe(true);

  // Style Sauter : plus rien à côté du rectangle.
  await page.getByTestId('wrap-jump').click();
  const jumped = (await flow(page, frame.id))[0].lines;
  expect(jumped.some((l: AnyNode) => l.top + l.height > top && l.top < bottom)).toBe(false);

  // Le cadre peut ignorer l'habillage (panneau Cadre).
  await page.keyboard.press('Escape');
  await page.evaluate((id) => (window as any).poulpe.editor.select([id]), frame.id);
  await page.getByTestId('frame-settings').click();
  await page.getByTestId('frame-ignore-wrap').check();
  expect((await nodes(page))[0].ignoreWrap).toBe(true);
  const free = (await flow(page, frame.id))[0].lines;
  expect(free.some((l: AnyNode) => l.top + l.height > top && l.top < bottom)).toBe(true);
  expect((await history(page)).slice(-3)).toEqual([
    'history.textWrap',
    'history.textWrap',
    'history.textFrame',
  ]);

  // Le SVG exporté place le texte comme l'écran : rien dans le rectangle quand il habille.
  await page.getByTestId('frame-ignore-wrap').uncheck();
  const svgClear = await page.evaluate(() => {
    const p = (window as any).poulpe;
    return p.core.artboardToSvg(p.editor.doc, p.editor.doc.artboards[0]);
  });
  expect(svgClear).toContain('mot0');
});

test('coulée automatique : Maj+clic sur le « + » rouge ajoute pages et cadres', async ({ page }) => {
  const long = Array.from({ length: 900 }, (_, i) => `mot${i}`).join(' ');
  const frame = await textFrame(page, 100, 100, 500, 300, long);
  await page.keyboard.press('v');
  await page.evaluate((id) => (window as any).poulpe.editor.select([id]), frame.id);
  const { at } = await canvas(page);
  const corner = await toScreen(page, frame.x + frame.width, frame.y + frame.height);
  await page.keyboard.down('Shift');
  await page.mouse.click(...at(...corner));
  await page.keyboard.up('Shift');
  const d = await docOf(page);
  const pages = d.artboards.filter((a: AnyNode) => !a.master);
  expect(pages.length).toBeGreaterThan(2);
  // Chaque nouvelle page porte un cadre de même taille, au même endroit, lié au précédent.
  for (const p of pages.slice(1)) {
    const f = p.children[0];
    expect(f.frame).toBe(true);
    expect([f.x - p.x, f.y - p.y, f.width, f.height].map(Math.round)).toEqual(
      [frame.x - d.artboards[0].x, frame.y - d.artboards[0].y, frame.width, frame.height].map(Math.round),
    );
  }
  const parts = await flow(page, frame.id);
  expect(parts).toHaveLength(pages.length);
  expect(parts[parts.length - 1].end).toBe(long.length);
  expect(await page.evaluate((id) => (window as any).poulpe.textFlow.chainOverflows(id), frame.id)).toBe(
    false,
  );
  // Une seule annulation défait tout.
  expect((await history(page)).at(-1)).toBe('history.autoFlow');
  await page.keyboard.press('Control+z');
  expect((await docOf(page)).artboards.filter((a: AnyNode) => !a.master)).toHaveLength(1);
});

test('après le « + » rouge, glisser trace le cadre lié à la taille voulue', async ({ page }) => {
  const frame = await textFrame(page, 100, 100, 400, 200);
  await page.keyboard.press('v');
  await page.evaluate((id) => (window as any).poulpe.editor.select([id]), frame.id);
  const { at, drag } = await canvas(page);
  await page.mouse.click(...at(...(await toScreen(page, frame.x + frame.width, frame.y + frame.height))));
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().linkFrom)).toBe(frame.id);
  await drag(
    await toScreen(page, frame.x, frame.y + 400),
    await toScreen(page, frame.x + 600, frame.y + 700),
  );
  const [first, second] = await nodes(page);
  expect(first.next).toBe(second.id);
  expect(second.frame).toBe(true);
  expect(second.width).toBeCloseTo(600, -1);
  expect(second.height).toBeCloseTo(300, -1);
  const parts = await flow(page, frame.id);
  expect(parts[1].start).toBe(parts[0].end);
  expect(parts[1].lines.length).toBeGreaterThan(0);
});

test('outil Cadre de texte : un clic dans une ellipse en fait un cadre de sa forme', async ({ page }) => {
  const ab = (await docOf(page)).artboards[0];
  const { at, drag } = await canvas(page);
  await page.keyboard.press('e');
  await drag(await toScreen(page, ab.x + 100, ab.y + 100), await toScreen(page, ab.x + 700, ab.y + 600));
  const ellipse = (await nodes(page)).at(-1)!;
  expect(ellipse.type).toBe('ellipse');
  await page.keyboard.press('t');
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().tool)).toBe('frameText');
  await page.mouse.click(...at(...(await toScreen(page, ab.x + 400, ab.y + 350))));
  await page.keyboard.insertText(WORDS);
  await page.keyboard.press('Escape');
  const all = await nodes(page);
  expect(all).toHaveLength(1);
  const t = all[0];
  expect(t.type).toBe('text');
  expect(t.frame).toBe(true);
  expect(t.frameShape.fill).toEqual(ellipse.fill);
  expect([t.x, t.y, t.width, t.height]).toEqual([ellipse.x, ellipse.y, ellipse.width, ellipse.height]);
  // Chaque ligne tient dans l'ellipse.
  const lines = (await flow(page, t.id))[0].lines;
  expect(lines.length).toBeGreaterThan(3);
  const rx = t.width / 2,
    ry = t.height / 2;
  for (const l of lines) {
    for (const y of [l.top, l.top + l.height]) {
      const dy = (y - ry) / ry;
      const half = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      expect(l.left).toBeGreaterThanOrEqual(rx - half - 1);
      expect(l.right).toBeLessThanOrEqual(rx + half + 1);
    }
  }

  // Vectorisé, le cadre en forme garde son fond sous les lettres.
  await page.keyboard.press('v');
  await page.evaluate((id) => (window as any).poulpe.editor.select([id]), t.id);
  await page.evaluate(() => (window as any).poulpe.vector.convertToCurves());
  await expect.poll(async () => (await nodes(page))[0].type).toBe('group');
  const curves = (await nodes(page))[0];
  expect(curves.children[0].type).toBe('path');
  expect(curves.children[0].fill).toEqual(ellipse.fill);
  expect(curves.children.length).toBeGreaterThan(1);
  await page.keyboard.press('Control+z');
  expect((await nodes(page))[0].type).toBe('text');

  // « Convertir en cadre de texte » sur un rectangle sélectionné.
  await page.keyboard.press('u');
  await drag(await toScreen(page, ab.x + 100, ab.y + 800), await toScreen(page, ab.x + 500, ab.y + 1000));
  await page.keyboard.press('v');
  await page.getByTestId('to-text-frame').click();
  const converted = (await nodes(page)).at(-1)!;
  expect(converted.type).toBe('text');
  expect(converted.frameShape).toBeTruthy();
  expect((await history(page)).at(-1)).toBe('history.toTextFrame');
});

test('réglages du cadre : marges intérieures et texte en trop masqué', async ({ page }) => {
  const frame = await textFrame(page, 100, 100, 500, 200);
  await page.keyboard.press('v');
  await page.evaluate((id) => (window as any).poulpe.editor.select([id]), frame.id);
  await page.getByTestId('frame-settings').click();
  const inset = page.getByTestId('frame-inset');
  await inset.fill('20');
  await inset.press('Enter');
  expect((await nodes(page))[0].insets).toEqual([20, 20, 20, 20]);
  const lines = (await flow(page, frame.id))[0].lines;
  expect(lines[0].top).toBeCloseTo(20);
  expect(lines[0].slot).toEqual([20, frame.width - 20]);
  // Quatre marges différentes.
  await page.getByTestId('frame-insets-linked').uncheck();
  const left = page.getByTestId('frame-inset-left');
  await left.fill('60');
  await left.press('Enter');
  expect((await nodes(page))[0].insets).toEqual([20, 20, 20, 60]);
  // Sans sélection, le « + » rouge signale le texte en trop, sauf s'il est masqué.
  const marks = () =>
    page.evaluate(() => (window as any).poulpe.controller().overflowMarks.map((m: AnyNode) => m.id));
  await page.evaluate(() => (window as any).poulpe.editor.select([]));
  await expect.poll(marks).toContain(frame.id);
  await page.evaluate((id) => (window as any).poulpe.editor.select([id]), frame.id);
  await page.getByTestId('frame-settings').click();
  await page.getByTestId('frame-hide-overflow').check();
  expect((await nodes(page))[0].hideOverflow).toBe(true);
  await page.evaluate(() => (window as any).poulpe.editor.select([]));
  await expect.poll(marks).not.toContain(frame.id);
  expect(await page.evaluate((id) => (window as any).poulpe.textFlow.chainOverflows(id), frame.id)).toBe(
    true,
  );
});
