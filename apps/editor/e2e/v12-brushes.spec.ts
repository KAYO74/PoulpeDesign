import { expect, test, type Page } from '@playwright/test';

/*
 * Version 1.2 : pinceaux et sélections de la Persona Photo au niveau d'Affinity Photo (trait droit,
 * prélèvement de couleur, taille et dureté au glisser, flux au clavier, stabilisateur, plage de
 * tons, mode de fusion, tampon non aligné, sélections depuis le centre, lasso polygonal et
 * magnétique, baguette magique au glisser, affinage, préréglages).
 */

const history = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().history);
const brush = (page: Page, tool: string): Promise<Record<string, number>> =>
  page.evaluate((tool) => (window as any).poulpe.ui.get().brushes[tool], tool);
const uiValue = (page: Page, key: string): Promise<any> =>
  page.evaluate((key) => (window as any).poulpe.ui.get()[key], key);

/** Photo de test 400×300 : fond bleu, un carré rouge au centre. */
async function openTestPhoto(page: Page) {
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3366cc';
    g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#dd2222';
    g.fillRect(170, 120, 60, 60);
    (window as any).poulpe.photo.openPhotoDocument(c.toDataURL('image/png'), 'image/png', 400, 300, 'Test');
  });
  await page.waitForTimeout(300);
}

async function screen(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const p = await page.evaluate(([x, y]) => (window as any).poulpe.controller().toScreen({ x, y }), [x, y]);
  return [box.x + p.x, box.y + p.y];
}

/** Point du document sous un point de la page. */
async function docAt(page: Page, sx: number, sy: number): Promise<[number, number]> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const p = await page.evaluate(
    ([x, y]) => (window as any).poulpe.controller().toWorld(x, y),
    [sx - box.x, sy - box.y],
  );
  return [p.x, p.y];
}

async function drag(page: Page, a: [number, number], b: [number, number], steps = 10) {
  await page.mouse.move(...(await screen(page, ...a)));
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, ...b)), { steps });
  await page.mouse.up();
}

async function click(page: Page, x: number, y: number, modifier?: 'Shift' | 'Alt') {
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(...(await screen(page, x, y)));
  if (modifier) await page.keyboard.up(modifier);
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

function setBrush(page: Page, tool: string, patch: Record<string, number>) {
  return page.evaluate(
    ([tool, patch]) => {
      const { ui } = (window as any).poulpe;
      const b = ui.get().brushes;
      ui.set({
        brushes: { ...b, [tool]: { hardness: 80, opacity: 100, flow: 100, size: 20, ...b[tool], ...patch } },
      });
    },
    [tool, patch] as const,
  );
}

const setUi = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((patch) => (window as any).poulpe.ui.set(patch), patch);

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

test('pinceau : Maj + clic trace un trait droit, Alt prélève la couleur, Maj + chiffres et Maj + [ ]', async ({
  page,
}) => {
  await openTestPhoto(page);
  await page.keyboard.press('b');
  await setBrush(page, 'brush', { size: 10 });
  await click(page, 40, 40);
  await click(page, 140, 40, 'Shift');
  // Deux gestes, deux étapes ; le trait relie les deux clics.
  expect((await history(page)).filter((h) => h === 'history.brush')).toHaveLength(2);
  expect((await pixel(page, 1, 90, 40))[3]).toBeGreaterThan(200);
  expect((await pixel(page, 1, 90, 60))[3]).toBe(0);

  // Alt + clic : la couleur du carré rouge devient la couleur principale, sans peindre.
  await click(page, 200, 150, 'Alt');
  expect(await uiValue(page, 'brushColor')).toBe('#dd2222');
  expect((await history(page)).filter((h) => h === 'history.brush')).toHaveLength(2);

  // Maj + 5 : flux 50 % ; 1 seul : opacité 10 %. Maj + ] : dureté +10 %.
  await page.keyboard.press('Shift+Digit5');
  expect((await brush(page, 'brush')).flow).toBe(50);
  await page.waitForTimeout(700);
  await page.keyboard.press('Digit1');
  expect((await brush(page, 'brush')).opacity).toBe(10);
  await page.keyboard.press('Shift+BracketRight');
  expect((await brush(page, 'brush')).hardness).toBe(90);
  await page.keyboard.press('Shift+BracketLeft');
  await page.keyboard.press('Shift+BracketLeft');
  expect((await brush(page, 'brush')).hardness).toBe(70);
});

test('Ctrl + Alt + glisser règle la taille et la dureté du pinceau', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('b');
  await setBrush(page, 'brush', { size: 20, hardness: 50 });
  const steps = (await history(page)).length;
  const [x, y] = await screen(page, 200, 150);
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y - 30, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
  const zoom = (await uiValue(page, 'view')).zoom;
  const b = await brush(page, 'brush');
  expect(b.size).toBe(Math.round(20 + 80 / zoom));
  expect(b.hardness).toBe(65);
  // Aucun coup de pinceau.
  expect((await history(page)).length).toBe(steps);
});

test('stabilisateur corde : le pinceau reste à une corde du pointeur', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('b');
  await setBrush(page, 'brush', { size: 4, hardness: 100 });
  await page.getByTestId('brush-stabilizer').check();
  const [x, y] = await screen(page, 40, 60);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y, { steps: 40 });
  await page.mouse.up();
  // Corde de 30 px d'écran : peint jusqu'à 170 px, pas au-delà.
  const [ax, ay] = await docAt(page, x + 150, y);
  const [bx, by] = await docAt(page, x + 196, y);
  expect((await pixel(page, 1, Math.round(ax), Math.round(ay)))[3]).toBeGreaterThan(200);
  expect((await pixel(page, 1, Math.round(bx), Math.round(by)))[3]).toBe(0);
});

test('éclaircir : la plage de tons choisit les tons touchés', async ({ page }) => {
  await openTestPhoto(page);
  await selectBackground(page);
  await page.keyboard.press('o');
  expect(await uiValue(page, 'tool')).toBe('dodge');
  await setBrush(page, 'dodge', { size: 30, hardness: 100, opacity: 100, flow: 100 });
  await page.getByTestId('tone-range').selectOption('shadows');
  await drag(page, [20, 40], [150, 40]);
  await page.getByTestId('tone-range').selectOption('highlights');
  await drag(page, [20, 250], [150, 250]);
  expect((await history(page)).filter((h) => h === 'history.dodge')).toHaveLength(2);
  const shadows = await pixel(page, 0, 80, 40);
  const highlights = await pixel(page, 0, 80, 250);
  // Le rouge (sombre dans ce bleu) monte surtout avec « Ombres », le bleu (clair) avec « Hautes lumières ».
  expect(shadows[0]).toBeGreaterThan(highlights[0] + 30);
  expect(highlights[2]).toBeGreaterThan(shadows[2]);
});

test('pinceau : mode de fusion Produit, et protéger l’alpha', async ({ page }) => {
  await openTestPhoto(page);
  await selectBackground(page);
  await page.keyboard.press('b');
  await setBrush(page, 'brush', { size: 20, hardness: 100 });
  await setUi(page, { brushColor: '#808080' });
  await page.getByTestId('brush-blend').selectOption('multiply');
  await drag(page, [20, 40], [150, 40]);
  const multiplied = await pixel(page, 0, 80, 40);
  expect(multiplied[0]).toBeLessThan(35);
  expect(multiplied[2]).toBeGreaterThan(90);
  expect(multiplied[2]).toBeLessThan(115);

  // Nouveau calque : un trait rouge, puis un trait vert qui le croise avec « Protéger l'alpha ».
  await page.getByTestId('brush-blend').selectOption('normal');
  await page.evaluate(() => (window as any).poulpe.editor.select([]));
  await setUi(page, { brushColor: '#ff0000' });
  await drag(page, [20, 150], [380, 150]);
  await page.getByTestId('brush-protect-alpha').check();
  await setUi(page, { brushColor: '#00ff00' });
  await drag(page, [300, 60], [300, 280]);
  const crossed = await pixel(page, 1, 300, 150);
  expect(crossed[1]).toBeGreaterThan(200);
  expect(crossed[0]).toBeLessThan(40);
  expect((await pixel(page, 1, 300, 100))[3]).toBe(0);
});

test('pot de peinture : source « tous les calques » et mode de fusion', async ({ page }) => {
  await openTestPhoto(page);
  await page.evaluate(() => (window as any).poulpe.editor.select([]));
  await page.keyboard.press('g');
  expect(await uiValue(page, 'tool')).toBe('fill');
  await page.getByTestId('fill-source').selectOption('all');
  await setUi(page, { brushColor: '#00ff00' });
  // Sur un nouveau calque vide : seule la zone du carré rouge visible est remplie.
  await click(page, 200, 150);
  const inside = await pixel(page, 1, 200, 150);
  expect(inside[3]).toBe(255);
  expect(inside[1]).toBe(255);
  expect((await pixel(page, 1, 100, 100))[3]).toBe(0);

  await selectBackground(page);
  await page.getByTestId('fill-source').selectOption('layer');
  await page.getByTestId('fill-blend').selectOption('multiply');
  await setUi(page, { brushColor: '#808080' });
  await click(page, 50, 50);
  const blue = await pixel(page, 0, 50, 50);
  expect(blue[0]).toBeLessThan(35);
  expect(blue[2]).toBeGreaterThan(90);
  expect(blue[2]).toBeLessThan(115);
});

test('tampon : non aligné, chaque coup repart de la source ; source « calques du dessous »', async ({
  page,
}) => {
  await openTestPhoto(page);
  await selectBackground(page);
  await page.keyboard.press('k');
  expect(await uiValue(page, 'tool')).toBe('clone');
  await setBrush(page, 'clone', { size: 20, hardness: 100 });
  await page.getByTestId('clone-aligned').uncheck();
  await click(page, 200, 150, 'Alt');
  await click(page, 60, 60);
  await click(page, 330, 240);
  const second = await pixel(page, 0, 330, 240);
  expect(second[0]).toBeGreaterThan(200);
  expect(second[2]).toBeLessThan(60);

  // Sur un calque vide au-dessus : on recopie ce qui est visible dessous.
  await page.keyboard.press('b');
  await page.evaluate(() => (window as any).poulpe.editor.select([]));
  await setBrush(page, 'brush', { size: 2 });
  await click(page, 395, 5);
  await page.keyboard.press('k');
  await page.getByTestId('clone-source').selectOption('below');
  await click(page, 200, 150, 'Alt');
  await click(page, 60, 200);
  const copied = await pixel(page, 1, 60, 200);
  expect(copied[3]).toBeGreaterThan(200);
  expect(copied[0]).toBeGreaterThan(200);
  // Le fond n'a pas changé.
  expect((await pixel(page, 0, 60, 200))[2]).toBeGreaterThan(180);
});

test('rectangle depuis le centre (Alt pendant le tracé), ellipse sans anticrénelage', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('m');
  await page.mouse.move(...(await screen(page, 100, 100)));
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, 120, 110)), { steps: 2 });
  await page.keyboard.down('Alt');
  await page.mouse.move(...(await screen(page, 150, 130)), { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(await selectedAt(page, 55, 75)).toBe(255);
  expect(await selectedAt(page, 145, 125)).toBe(255);
  expect(await selectedAt(page, 45, 65)).toBe(0);

  await page.keyboard.press('m');
  expect(await uiValue(page, 'tool')).toBe('marqueeEllipse');
  await page.getByTestId('marquee-antialias').uncheck();
  await drag(page, [200, 50], [330, 140]);
  const soft = await page.evaluate(() => {
    const s = (window as any).poulpe.photo.getSelection();
    const d = s.canvas.getContext('2d')!.getImageData(0, 0, s.canvas.width, s.canvas.height).data;
    let n = 0,
      on = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] !== 0 && d[i] !== 255) n++;
      if (d[i] === 255) on++;
    }
    return { n, on };
  });
  expect(soft.on).toBeGreaterThan(1000);
  expect(soft.n).toBe(0);
});

test('lasso : polygonal et magnétique, l’ancien Lasso polygonal ouvre le mode polygonal', async ({
  page,
}) => {
  await openTestPhoto(page);
  // L : le lasso (une seule touche, ses modes sont dans la barre).
  await page.keyboard.press('l');
  await page.keyboard.press('l');
  expect(await uiValue(page, 'tool')).toBe('lasso');
  await page.getByTestId('lasso-polygonal').click();
  for (const [x, y] of [
    [20, 20],
    [120, 20],
    [120, 100],
    [20, 100],
  ] as const)
    await click(page, x, y);
  await page.keyboard.press('Enter');
  expect(await selectedAt(page, 60, 60)).toBe(255);
  expect(await selectedAt(page, 200, 200)).toBe(0);
  await page.keyboard.press('Control+d');

  // Magnétique : des clics près des coins du carré, le contour suit ses bords.
  await page.getByTestId('lasso-magnetic').click();
  for (const [x, y] of [
    [173, 123],
    [227, 123],
    [227, 177],
    [173, 177],
  ] as const)
    await click(page, x, y);
  await page.keyboard.press('Enter');
  expect(await selectedAt(page, 200, 150)).toBe(255);
  expect(await selectedAt(page, 171, 150)).toBeGreaterThan(128);
  expect(await selectedAt(page, 167, 150)).toBeLessThan(128);
  expect(await selectedAt(page, 100, 100)).toBe(0);

  // Un ancien espace de travail peut encore choisir le Lasso polygonal.
  await page.getByTestId('lasso-freehand').click();
  await setUi(page, { tool: 'polyLasso' });
  expect(await uiValue(page, 'tool')).toBe('lasso');
  await expect(page.getByTestId('lasso-polygonal')).toHaveAttribute('aria-pressed', 'true');
});

test('lasso : changer de mode abandonne le contour en cours ; Maj + 1 à 4 en AZERTY règle la Fluidité', async ({
  page,
}) => {
  await openTestPhoto(page);
  const busy = () => page.evaluate(() => (window as any).poulpe.controller().busy());
  const loop = async () => {
    await page.mouse.move(...(await screen(page, 250, 40)));
    await page.mouse.down();
    for (const [x, y] of [
      [350, 40],
      [350, 120],
      [250, 120],
    ] as const)
      await page.mouse.move(...(await screen(page, x, y)), { steps: 5 });
    await page.mouse.up();
  };

  // Un polygone ouvert, puis le mode Main levée : le lasso suivant sélectionne normalement.
  await setUi(page, { tool: 'marqueeRect' });
  await drag(page, [20, 20], [120, 100]);
  expect(await selectedAt(page, 60, 60)).toBe(255);
  await page.keyboard.press('l');
  expect(await uiValue(page, 'tool')).toBe('lasso');
  await page.getByTestId('lasso-polygonal').click();
  for (const [x, y] of [
    [200, 200],
    [300, 200],
    [300, 280],
  ] as const)
    await click(page, x, y);
  await page.getByTestId('lasso-freehand').click();
  expect(await busy()).toBe(false);
  await loop();
  expect(await selectedAt(page, 300, 80)).toBe(255);
  expect(await selectedAt(page, 60, 60)).toBe(0);
  expect(await busy()).toBe(false);
  await page.keyboard.press('Control+d');

  // Un contour magnétique ouvert, puis le mode Main levée : même chose.
  await page.getByTestId('lasso-magnetic').click();
  await click(page, 173, 123);
  await page.mouse.move(...(await screen(page, 227, 123)), { steps: 5 });
  await page.getByTestId('lasso-freehand').click();
  expect(await busy()).toBe(false);
  await loop();
  expect(await selectedAt(page, 300, 80)).toBe(255);
  expect(await busy()).toBe(false);

  // Fluidité : en AZERTY, Maj + & donne « 1 » et choisit le mode Pousser (pas le flux).
  await setUi(page, { tool: 'liquify', liquifyMode: 'pinch' });
  const flow = (await brush(page, 'liquify'))?.flow;
  await page.evaluate(() =>
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '1', code: 'Digit1', shiftKey: true, bubbles: true }),
    ),
  );
  expect(await uiValue(page, 'liquifyMode')).toBe('push');
  expect((await brush(page, 'liquify'))?.flow).toBe(flow);
});

test('baguette magique : glisser règle la tolérance, puis affiner la sélection', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('w');
  await page.keyboard.press('w');
  expect(await uiValue(page, 'tool')).toBe('magicWand');
  await setUi(page, { tolerance: 0 });
  const [x, y] = await screen(page, 50, 50);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 8 });
  await page.mouse.up();
  expect(await uiValue(page, 'tolerance')).toBe(80);
  expect((await history(page)).filter((h) => h === 'history.selection')).toHaveLength(1);
  expect(await selectedAt(page, 50, 50)).toBe(255);
  expect(await selectedAt(page, 200, 150)).toBe(0);
  expect(await selectedAt(page, 164, 150)).toBe(255);

  // Affiner : réduire de 10 px éloigne la sélection du carré rouge.
  await page.getByTestId('selection-refine').click();
  await page.getByTestId('refine-adjust').fill('-10');
  await page.waitForTimeout(200);
  await page.getByTestId('refine-apply').click();
  expect(await history(page)).toContain('history.selectionRefine');
  expect(await selectedAt(page, 164, 150)).toBe(0);
  expect(await selectedAt(page, 50, 50)).toBe(255);
  await page.keyboard.press('Control+z');
  expect(await selectedAt(page, 164, 150)).toBe(255);
});

test('panneau Pinceau : appliquer et enregistrer un préréglage', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('b');
  await page.getByTestId('tab-brush').click();
  await page.getByTestId('preset-soft').click();
  const b = await brush(page, 'brush');
  expect(b.size).toBe(80);
  expect(b.hardness).toBe(0);
  await setBrush(page, 'brush', { size: 33, hardness: 44 });
  await page.getByTestId('preset-name').fill('Mon pinceau');
  await page.getByTestId('preset-save').click();
  await page.getByTestId('preset-hard').click();
  expect((await brush(page, 'brush')).size).toBe(20);
  await page
    .getByRole('option', { name: /Mon pinceau/ })
    .getByRole('button')
    .first()
    .click();
  expect((await brush(page, 'brush')).size).toBe(33);
  expect((await brush(page, 'brush')).hardness).toBe(44);
});
