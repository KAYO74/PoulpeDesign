import { expect, test, type Page } from '@playwright/test';

/*
 * Outils photo avancés (v0.6) : lasso polygonal, sélection rapide, sélection annulable,
 * correcteur, doigt, fluidité, redressement, perspective, looks LUT, taille de l'image et de la
 * zone de travail, mode de fusion d'un calque de réglage.
 */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
const history = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().history);
const hasSelection = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as any).poulpe.ui.get().hasPixelSelection);

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

function setBrushSize(page: Page, tool: string, size: number) {
  return page.evaluate(
    ([tool, size]) => {
      const { ui } = (window as any).poulpe;
      const b = ui.get().brushes;
      ui.set({ brushes: { ...b, [tool]: { hardness: 80, opacity: 100, flow: 100, ...b[tool], size } } });
    },
    [tool, size] as const,
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

test('lasso polygonal, et la sélection s’annule avec Ctrl+Z', async ({ page }) => {
  await openTestPhoto(page);
  // L : lasso (sélection à main levée), en mode polygonal (comme dans Affinity).
  await page.keyboard.press('l');
  await page.getByTestId('lasso-polygonal').click();
  for (const [x, y] of [
    [20, 20],
    [120, 20],
    [120, 100],
    [20, 100],
  ] as const)
    await page.mouse.click(...(await screen(page, x, y)));
  await page.keyboard.press('Enter');
  expect(await hasSelection(page)).toBe(true);
  expect(await selectedAt(page, 60, 60)).toBe(255);
  expect(await selectedAt(page, 200, 200)).toBe(0);
  expect(await history(page)).toContain('history.selection');

  await page.keyboard.press('Control+z');
  expect(await hasSelection(page)).toBe(false);
  await page.keyboard.press('Control+Shift+z');
  expect(await hasSelection(page)).toBe(true);
  expect(await selectedAt(page, 60, 60)).toBe(255);
});

test('la sélection rapide s’étend au carré rouge sans déborder', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('w');
  await drag(page, [190, 140], [210, 160], 6);
  expect(await selectedAt(page, 175, 125)).toBe(255);
  expect(await selectedAt(page, 225, 175)).toBe(255);
  expect(await selectedAt(page, 100, 100)).toBe(0);
  // Un seul geste = une étape d'historique.
  expect((await history(page)).filter((h) => h === 'history.selection')).toHaveLength(1);
});

test('correcteur : recopie la texture de la source avec la lumière de la destination', async ({ page }) => {
  await openTestPhoto(page, true);
  await selectBackground(page);
  // J : gomme magique, puis correcteur au deuxième appui.
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await setBrushSize(page, 'heal', 30);
  // Alt + clic : source dans le bleu, à gauche du carré.
  await page.keyboard.down('Alt');
  await page.mouse.click(...(await screen(page, 100, 150)));
  await page.keyboard.up('Alt');
  await page.mouse.click(...(await screen(page, 200, 150)));
  expect(await history(page)).toContain('history.heal');
  // La tache blanche est recopiée (plus claire) mais garde la teinte rouge du carré.
  const c = await pixel(page, 0, 200, 150);
  expect(c[1]).toBeGreaterThan(0x22 + 40);
  expect(c[0]).toBeGreaterThan(c[2]);
  // Autour de la tache, le carré reste rouge.
  const around = await pixel(page, 0, 212, 150);
  expect(around[0]).toBeGreaterThan(around[2] + 80);
});

test('doigt et fluidité déplacent les pixels', async ({ page }) => {
  await openTestPhoto(page);
  await selectBackground(page);
  await page.keyboard.press('s');
  await setBrushSize(page, 'smudge', 30);
  await drag(page, [200, 150], [260, 150], 20);
  expect(await history(page)).toContain('history.smudge');
  // Le rouge a été étalé dans le bleu, à droite du carré.
  const smeared = await pixel(page, 0, 240, 150);
  expect(smeared[0]).toBeGreaterThan(0x33 + 20);

  await page.getByTestId('tool-liquify').click();
  await setBrushSize(page, 'liquify', 80);
  await drag(page, [200, 60], [200, 110], 20);
  expect(await history(page)).toContain('history.liquify');
  // Le geste pousse le bleu du haut vers le bas, dans le carré rouge.
  const pushed = await pixel(page, 0, 200, 125);
  expect(pushed[2]).toBeGreaterThan(pushed[0]);
});

test('redresse un calque et corrige la perspective', async ({ page }) => {
  await openTestPhoto(page);
  await selectBackground(page);
  // C : recadrage, puis redressement au deuxième appui.
  await page.keyboard.press('c');
  await page.keyboard.press('c');
  // Une ligne inclinée d'environ 10°.
  await drag(page, [50, 100], [350, 153]);
  let bg = (await nodes(page))[0];
  expect(Math.abs(((bg.rotation + 180) % 360) - 180 + 10)).toBeLessThan(1);
  expect(bg.width).toBeGreaterThan(400);
  await page.keyboard.press('Control+z');
  bg = (await nodes(page))[0];
  expect(bg.rotation).toBe(0);

  await page.getByTestId('tool-perspective').click();
  await page.mouse.click(...(await screen(page, 200, 150)));
  // Les coins sur le carré rouge.
  const corners: [number, number][] = [
    [40, 30],
    [360, 30],
    [360, 270],
    [40, 270],
  ];
  const targets: [number, number][] = [
    [172, 122],
    [228, 122],
    [228, 178],
    [172, 178],
  ];
  for (let i = 0; i < 4; i++) await drag(page, corners[i], targets[i], 4);
  await page.getByTestId('perspective-apply').click();
  expect(await history(page)).toContain('history.perspective');
  // Le carré rouge remplit l'image.
  const c = await pixel(page, 0, 20, 20);
  expect(c[0]).toBeGreaterThan(150);
  expect(c[2]).toBeLessThan(100);
});

test('ajoute un look LUT et change le mode de fusion du réglage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openTestPhoto(page);
  await page.getByRole('toolbar').getByTestId('add-adjustment').click();
  await page.getByTestId('lut-noir').click();
  const adj = (await nodes(page)).at(-1)!;
  expect(adj.type).toBe('adjustment');
  expect(adj.adjustment.kind).toBe('lut');
  expect(adj.adjustment.size).toBe(17);
  await page.evaluate((id) => {
    const { editor } = (window as any).poulpe;
    editor.apply('test', (d: any) => {
      d.artboards[0].children.find((n: any) => n.id === id).blendMode = 'multiply';
    });
  }, adj.id);
  // Le rendu passe sans erreur avec le mode de fusion.
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test('taille de l’image et de la zone de travail', async ({ page }) => {
  await openTestPhoto(page);
  await page.evaluate(() => (window as any).poulpe.photo.setImageSize(200, 150, true));
  await expect
    .poll(async () => await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].width))
    .toBe(200);
  const doc = await page.evaluate(() => (window as any).poulpe.editor.doc);
  const bg = doc.artboards[0].children[0];
  expect(bg.width).toBeCloseTo(200);
  expect(doc.assets[bg.assetId].width).toBe(200);
  expect(await history(page)).toContain('history.imageSize');

  await page.evaluate(() => (window as any).poulpe.photo.setCanvasSize(300, 150, 0.5, 0.5));
  const after = await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0]);
  expect(after.width).toBe(300);
  expect(after.children[0].x - after.x).toBeCloseTo(50);
});
