import { expect, test, type Page } from '@playwright/test';
import { choose } from './choose';

/*
 * Outils de pixels de la version 1.2 (Persona Photo) : recadrage (et redressement), dégradé,
 * masque rapide, éponge, gomme d'arrière-plan, gomme de zone, remplacement de couleur, correctif,
 * retouche des imperfections et yeux rouges.
 */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
const artboard = (page: Page): Promise<AnyNode> =>
  page.evaluate(() => {
    const a = (window as any).poulpe.editor.doc.artboards[0];
    return { x: a.x, y: a.y, width: a.width, height: a.height };
  });
const history = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().history);
const tool = (page: Page): Promise<string> => page.evaluate(() => (window as any).poulpe.ui.get().tool);

/** Photo de test 400×300 : fond bleu, un carré rouge au centre (et une tache blanche à gauche). */
async function openTestPhoto(page: Page, mark = false) {
  await page.evaluate((mark) => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3366cc';
    g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#dd2222';
    g.fillRect(170, 120, 60, 60);
    if (mark) {
      g.fillStyle = '#ffffff';
      g.fillRect(96, 146, 8, 8);
    }
    (window as any).poulpe.photo.openPhotoDocument(c.toDataURL('image/png'), 'image/png', 400, 300, 'Test');
  }, mark);
  await page.waitForTimeout(300);
}

async function screen(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const p = await page.evaluate(([x, y]) => (window as any).poulpe.controller().toScreen({ x, y }), [x, y]);
  return [box.x + p.x, box.y + p.y];
}

async function drag(page: Page, a: [number, number], b: [number, number], steps = 10) {
  await page.mouse.move(...(await screen(page, ...a)));
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, ...b)), { steps });
  await page.mouse.up();
}

/** Glisse en passant par plusieurs points (lasso). */
async function path(page: Page, pts: [number, number][]) {
  await page.mouse.move(...(await screen(page, ...pts[0])));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...(await screen(page, ...p)), { steps: 4 });
  await page.mouse.up();
}

async function pixel(page: Page, index: number, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    async ([index, x, y]) => {
      const { editor, controller } = (window as any).poulpe;
      const n = editor.doc.artboards[0].children[index];
      const imgs = controller().images;
      await imgs.ready?.(editor.doc);
      const img = imgs.get(editor.doc, n.assetId);
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(x, y, 1, 1).data);
    },
    [index, x, y],
  );
}

/** Opacité de la sélection en un point du document (0 à 255). */
async function selectedAt(page: Page, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([x, y]) => {
      const s = (window as any).poulpe.photo.getSelection();
      if (!s) return 0;
      const g = s.canvas.getContext('2d')!;
      return g.getImageData(Math.floor((x - s.x) * s.scale), Math.floor((y - s.y) * s.scale), 1, 1).data[3];
    },
    [x, y],
  );
}

function setBrush(page: Page, tool: string, patch: Record<string, number>) {
  return page.evaluate(
    ([tool, patch]) => {
      const { ui } = (window as any).poulpe;
      const b = ui.get().brushes;
      ui.set({
        brushes: { ...b, [tool]: { size: 40, hardness: 80, opacity: 100, flow: 100, ...b[tool], ...patch } },
      });
    },
    [tool, patch] as const,
  );
}

const selectBackground = (page: Page) =>
  page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('recadrage : poignées, déplacement, proportions, une étape d’historique', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('c');
  expect(await tool(page)).toBe('crop');
  await expect(page.getByTestId('crop-size')).toHaveText('400 × 300 px');
  // Coin bas droit tiré, puis le cadre déplacé.
  await drag(page, [400, 300], [300, 250]);
  await expect(page.getByTestId('crop-size')).toHaveText('300 × 250 px');
  await drag(page, [150, 125], [170, 135]);
  await page.keyboard.press('Enter');
  expect(await artboard(page)).toEqual({ x: 0, y: 0, width: 300, height: 250 });
  const bg = (await nodes(page))[0];
  expect(bg.x).toBeCloseTo(-20);
  expect(bg.y).toBeCloseTo(-10);
  expect((await history(page)).filter((h) => h === 'history.crop')).toHaveLength(1);
  // Le cadre repart de tout le document recadré.
  await expect(page.getByTestId('crop-size')).toHaveText('300 × 250 px');
  await page.keyboard.press('Control+z');
  expect((await artboard(page)).width).toBe(400);

  // Proportions 1:1 : le plus grand carré.
  await choose(page.getByTestId('crop-ratio'), '1:1');
  await expect(page.getByTestId('crop-size')).toHaveText('300 × 300 px');
  // Échap annule le cadre en cours.
  await drag(page, [350, 300], [300, 200]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('crop-size')).toHaveText('300 × 300 px');
});

test('recadrage : redresser met l’horizon d’aplomb, annulé d’un seul Ctrl+Z', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('c');
  await page.getByTestId('crop-straighten').click();
  // Une ligne inclinée d'environ 10°.
  await drag(page, [50, 100], [350, 153]);
  let bg = (await nodes(page))[0];
  // Aperçu : l'image tourne, le cadre se resserre sur l'image sans coin vide.
  expect(Math.abs(((bg.rotation + 180) % 360) - 180 + 10)).toBeLessThan(1);
  const size = (await page.getByTestId('crop-size').textContent())!;
  const [w, h] = size.match(/\d+/g)!.map(Number);
  expect(w).toBeLessThan(400);
  expect(w / h).toBeCloseTo(4 / 3, 1);
  await page.getByTestId('crop-apply').click();
  const ab = await artboard(page);
  expect(ab.width).toBe(w);
  expect(ab.height).toBe(h);
  bg = (await nodes(page))[0];
  expect(Math.abs(((bg.rotation + 180) % 360) - 180 + 10)).toBeLessThan(1);
  // Les coins du document recadré sont tous dans l'image tournée (pas de coin vide).
  const a = (-bg.rotation * Math.PI) / 180;
  const cx = bg.x + bg.width / 2,
    cy = bg.y + bg.height / 2;
  for (const [x, y] of [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]) {
    const lx = (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
      ly = (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
    expect(Math.abs(lx)).toBeLessThanOrEqual(bg.width / 2 + 1);
    expect(Math.abs(ly)).toBeLessThanOrEqual(bg.height / 2 + 1);
  }
  await page.keyboard.press('Control+z');
  bg = (await nodes(page))[0];
  expect(bg.rotation).toBe(0);
  expect((await artboard(page)).width).toBe(400);
});

test('dégradé : de la couleur principale à la secondaire, limité à la sélection', async ({ page }) => {
  await openTestPhoto(page);
  await selectBackground(page);
  await page.evaluate(() => (window as any).poulpe.ui.set({ brushColor: '#000000', brushColor2: '#ffffff' }));
  // G : pot de peinture, puis dégradé au deuxième appui.
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  expect(await tool(page)).toBe('pixelGradient');
  await drag(page, [0, 150], [400, 150]);
  expect((await history(page)).filter((h) => h === 'history.pixelGradient')).toHaveLength(1);
  const left = await pixel(page, 0, 10, 50),
    mid = await pixel(page, 0, 200, 50),
    right = await pixel(page, 0, 390, 50);
  expect(left[0]).toBeLessThan(20);
  expect(right[0]).toBeGreaterThan(235);
  expect(Math.abs(mid[0] - 128)).toBeLessThan(20);

  // Avec une sélection : seule la moitié gauche change ; dégradé radial inversé.
  await page.keyboard.press('Control+z');
  await page.evaluate(() =>
    (window as any).poulpe.photo.selectShape(
      'rect',
      [
        { x: 0, y: 0 },
        { x: 200, y: 300 },
      ],
      'replace',
    ),
  );
  await choose(page.getByTestId('gradient-kind'), 'radial');
  await page.getByTestId('gradient-reverse').check();
  await drag(page, [100, 150], [100, 50]);
  const center = await pixel(page, 0, 100, 150);
  expect(center[0]).toBeGreaterThan(235);
  const outside = await pixel(page, 0, 300, 50);
  expect(outside).toEqual([0x33, 0x66, 0xcc, 255]);
});

test('masque rapide : le pinceau peint la sélection, Q la rend', async ({ page }) => {
  await openTestPhoto(page);
  await selectBackground(page);
  await page.keyboard.press('q');
  await expect(page.getByTestId('quick-mask-badge')).toBeVisible();
  await page.keyboard.press('b');
  await page.evaluate(() => (window as any).poulpe.ui.set({ brushColor: '#ffffff' }));
  await setBrush(page, 'brush', { size: 40, hardness: 100 });
  await drag(page, [100, 100], [200, 100]);
  expect(await history(page)).toContain('history.quickMask');
  // Le calque n'a pas été peint.
  expect(await pixel(page, 0, 150, 100)).toEqual([0x33, 0x66, 0xcc, 255]);
  await page.keyboard.press('q');
  await expect(page.getByTestId('quick-mask-badge')).toHaveCount(0);
  expect(await selectedAt(page, 150, 100)).toBe(255);
  expect(await selectedAt(page, 300, 250)).toBe(0);
  // La gomme retire de la sélection.
  await page.keyboard.press('q');
  await page.keyboard.press('e');
  await setBrush(page, 'eraser', { size: 30, hardness: 100 });
  await drag(page, [150, 100], [152, 100], 2);
  await page.keyboard.press('q');
  expect(await selectedAt(page, 150, 100)).toBe(0);
  expect(await selectedAt(page, 110, 100)).toBe(255);
  // Le dégradé peint aussi la sélection : du noir (rien) au blanc (tout).
  await page.keyboard.press('q');
  await page.evaluate(() => (window as any).poulpe.ui.set({ brushColor: '#000000', brushColor2: '#ffffff' }));
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await drag(page, [0, 150], [400, 150]);
  await page.keyboard.press('q');
  expect(await selectedAt(page, 10, 280)).toBeLessThan(20);
  expect(await selectedAt(page, 390, 280)).toBeGreaterThan(235);
  expect(await pixel(page, 0, 390, 280)).toEqual([0x33, 0x66, 0xcc, 255]);
});

test('dégradé dans le masque du calque', async ({ page }) => {
  await openTestPhoto(page);
  await selectBackground(page);
  await page.evaluate(() => {
    const { photo, ui } = (window as any).poulpe;
    photo.toggleMaskEdit();
    ui.set({ brushColor: '#ffffff', brushColor2: '#000000' });
  });
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await drag(page, [0, 150], [400, 150]);
  expect(await history(page)).toContain('history.pixelGradient');
  const mask = await page.evaluate(async () => {
    const { editor, controller } = (window as any).poulpe;
    const n = editor.doc.artboards[0].children[0];
    const imgs = controller().images;
    await imgs.ready?.(editor.doc);
    const img = imgs.get(editor.doc, n.mask.assetId);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return [g.getImageData(5, 150, 1, 1).data[3], g.getImageData(395, 150, 1, 1).data[3]];
  });
  expect(mask[0]).toBeGreaterThan(240);
  expect(mask[1]).toBeLessThan(15);
  // Les pixels du calque n'ont pas changé.
  expect(await pixel(page, 0, 395, 150)).toEqual([0x33, 0x66, 0xcc, 255]);
});

test('éponge, gomme d’arrière-plan, gomme de zone et remplacement de couleur', async ({ page }) => {
  await openTestPhoto(page);
  await selectBackground(page);
  // O : densité −, densité +, éponge.
  for (let i = 0; i < 3; i++) await page.keyboard.press('o');
  expect(await tool(page)).toBe('sponge');
  await setBrush(page, 'sponge', { size: 40, opacity: 100, flow: 100, hardness: 100 });
  await drag(page, [195, 150], [205, 150], 4);
  expect(await history(page)).toContain('history.sponge');
  const gray = await pixel(page, 0, 200, 150);
  expect(gray[0] - gray[2]).toBeLessThan(0xdd - 0x22 - 60);

  // R : remplacement de couleur, le rouge devient vert, le bleu autour reste.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('r');
  await page.evaluate(() => (window as any).poulpe.ui.set({ brushColor: '#00c000' }));
  await setBrush(page, 'colorReplace', { size: 80, hardness: 100 });
  await drag(page, [195, 150], [205, 150], 4);
  expect(await history(page)).toContain('history.colorReplace');
  const green = await pixel(page, 0, 200, 150);
  expect(green[1]).toBeGreaterThan(green[0]);
  const blue = await pixel(page, 0, 165, 150);
  expect(blue[2]).toBeGreaterThan(blue[1]);

  // E E : gomme d'arrière-plan, le bleu s'efface, le rouge du carré reste.
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  expect(await tool(page)).toBe('backgroundEraser');
  await setBrush(page, 'backgroundEraser', { size: 60, hardness: 100 });
  await drag(page, [140, 60], [140, 150], 10);
  expect(await history(page)).toContain('history.backgroundEraser');
  expect((await pixel(page, 0, 140, 100))[3]).toBe(0);
  expect((await pixel(page, 0, 160, 100))[3]).toBe(0);
  expect((await pixel(page, 0, 165, 150))[3]).toBe(0);
  expect((await pixel(page, 0, 175, 150))[3]).toBe(255);

  // E : gomme de zone, tout le bleu relié disparaît d'un clic.
  await page.keyboard.press('e');
  expect(await tool(page)).toBe('floodEraser');
  await page.mouse.click(...(await screen(page, 20, 20)));
  expect(await history(page)).toContain('history.floodEraser');
  expect((await pixel(page, 0, 380, 280))[3]).toBe(0);
  expect((await pixel(page, 0, 200, 150))[3]).toBe(255);
});

test('correctif, imperfections et yeux rouges', async ({ page }) => {
  await openTestPhoto(page, true);
  await selectBackground(page);
  // J : gomme magique, correcteur, correctif, imperfections, yeux rouges.
  for (let i = 0; i < 3; i++) await page.keyboard.press('j');
  expect(await tool(page)).toBe('patch');
  await path(page, [
    [88, 138],
    [112, 138],
    [112, 162],
    [88, 162],
    [88, 139],
  ]);
  await drag(page, [100, 150], [100, 230], 8);
  expect(await history(page)).toContain('history.patch');
  const fixed = await pixel(page, 0, 100, 150);
  expect(fixed[0]).toBeLessThan(0x33 + 30);
  expect(fixed[2]).toBeGreaterThan(0xcc - 30);
  await page.keyboard.press('Escape');

  // Imperfections : la tache blanche disparaît d'un clic.
  await page.keyboard.press('Control+z');
  expect((await pixel(page, 0, 100, 150))[0]).toBe(255);
  await page.keyboard.press('j');
  expect(await tool(page)).toBe('blemish');
  await setBrush(page, 'blemish', { size: 20 });
  await page.mouse.click(...(await screen(page, 100, 150)));
  expect(await history(page)).toContain('history.blemish');
  const clean = await pixel(page, 0, 100, 150);
  expect(clean[0]).toBeLessThan(0x33 + 30);
  expect(clean[2]).toBeGreaterThan(0xcc - 30);

  // Yeux rouges : un cadre autour du carré rouge, le rouge part, le bleu reste.
  await page.keyboard.press('j');
  expect(await tool(page)).toBe('redEye');
  await drag(page, [165, 115], [235, 185], 6);
  expect(await history(page)).toContain('history.redEye');
  const pupil = await pixel(page, 0, 200, 150);
  expect(pupil[0]).toBeLessThan(60);
  expect(await pixel(page, 0, 300, 50)).toEqual([0x33, 0x66, 0xcc, 255]);
});
