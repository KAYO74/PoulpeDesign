import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/* Retouche photo (v0.4) : Persona Photo, pinceaux, sélections, gomme magique, réglages, masques. */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);
const history = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).poulpe.editor.getState().history);

/** Ouvre une photo de test 400×300 : fond bleu, un carré rouge au centre. */
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

/** Point du document vers la page. */
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

/** Couleur d'un pixel de l'image d'un calque. */
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
    // Enregistrer passe par un téléchargement (pas de boîte de dialogue du navigateur).
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('passe de la Persona Dessin à la Persona Photo', async ({ page }) => {
  await page.getByTestId('persona-photo').click();
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().persona)).toBe('photo');
  await expect(page.getByRole('toolbar').getByTestId('add-adjustment')).toBeVisible();
  await page.getByTestId('persona-draw').click();
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().persona)).toBe('draw');
  await expect(page.getByRole('toolbar').getByTestId('add-adjustment')).toHaveCount(0);
});

test('peint au pinceau sur un nouveau calque de pixels, puis gomme', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('b');
  await drag(page, [40, 40], [140, 40]);
  const list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list[1].type).toBe('image');
  expect(await history(page)).toContain('history.brush');
  const painted = await pixel(page, 1, 90, 40);
  expect(painted[3]).toBeGreaterThan(200);

  await page.keyboard.press('e');
  await drag(page, [60, 40], [120, 40]);
  const erased = await pixel(page, 1, 90, 40);
  expect(erased[3]).toBeLessThan(30);
});

test('sélectionne au rectangle et efface les pixels', async ({ page }) => {
  await openTestPhoto(page);
  // Sélectionne le calque de fond.
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
  await page.keyboard.press('m');
  await drag(page, [10, 10], [60, 60]);
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().hasPixelSelection)).toBe(true);
  await page.keyboard.press('Delete');
  expect((await pixel(page, 0, 30, 30))[3]).toBe(0);
  expect((await pixel(page, 0, 100, 100))[3]).toBe(255);
  await page.keyboard.press('Control+d');
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().hasPixelSelection)).toBe(false);
});

test('la baguette magique sélectionne le carré rouge', async ({ page }) => {
  await openTestPhoto(page);
  await page.keyboard.press('w');
  await page.mouse.click(...(await screen(page, 200, 150)));
  const b = await page.evaluate(() => {
    const s = (window as any).poulpe.photo.getSelection();
    return s ? { w: s.width, h: s.height } : null;
  });
  expect(b).not.toBeNull();
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().hasPixelSelection)).toBe(true);
});

test('la gomme magique fait disparaître le carré rouge', async ({ page }) => {
  await openTestPhoto(page);
  await page.evaluate(() => (window as any).poulpe.ui.set({ tool: 'magicEraser' }));
  await page.evaluate(() => (window as any).poulpe.ui.get().brushes);
  // Un gros pinceau qui couvre le carré.
  await page.evaluate(() => {
    const { ui } = (window as any).poulpe;
    const b = ui.get().brushes;
    ui.set({ brushes: { ...b, magicEraser: { ...b.magicEraser, size: 50 } } });
  });
  for (const y of [125, 140, 155, 170, 175]) await drag(page, [165, y], [235, y], 12);
  await expect.poll(() => history(page), { timeout: 20_000 }).toContain('history.magicEraser');
  await expect(page.getByTestId('busy')).toHaveCount(0, { timeout: 20_000 });
  const c = await pixel(page, 0, 200, 150);
  // Le centre est redevenu bleu.
  expect(c[2]).toBeGreaterThan(c[0]);
});

test("remplit la sélection d'après le contenu, avec aperçu, sur un nouveau calque", async ({ page }) => {
  await openTestPhoto(page);
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
  await page.keyboard.press('m');
  await drag(page, [160, 110], [240, 190]);
  await page.getByRole('button', { name: 'Édition' }).click();
  await page.getByRole('menuitem', { name: "Remplir d'après le contenu" }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('contentfill-apply')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('contentfill-variant').click();
  await expect(page.getByTestId('contentfill-apply')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('contentfill-apply').click();
  await expect(dialog).toBeHidden();
  const names = await page.evaluate(() =>
    (window as any).poulpe.editor.doc.artboards[0].children.map((n: { name: string }) => n.name),
  );
  expect(names).toHaveLength(2);
  expect(names[1]).toBe('Remplissage');
  // Le nouveau calque couvre le carré rouge avec le bleu d'autour.
  const c = await pixel(page, 1, 200, 150);
  expect(c[3]).toBe(255);
  expect(c[2]).toBeGreaterThan(c[0]);
  expect((await pixel(page, 1, 20, 20))[3]).toBe(0);
});

test('déforme le calque en tirant un point de la grille', async ({ page }) => {
  await openTestPhoto(page);
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
  expect((await pixel(page, 0, 240, 150))[2]).toBeGreaterThan(150);
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Déformation en maillage…' }).click();
  const c = (await page.getByTestId('warp-canvas').boundingBox())!;
  // Le point du milieu de la grille 4 × 4 part de 50 px vers la droite.
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2 + (50 * c.width) / 400, c.y + c.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId('warp-apply').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(() => history(page)).toContain('history.meshWarp');
  const p = await pixel(page, 0, 240, 150);
  expect(p[0]).toBeGreaterThan(p[2]);
});

test('ajoute un calque de réglage et un masque', async ({ page }) => {
  await openTestPhoto(page);
  await page.getByRole('toolbar').getByTestId('add-adjustment').click();
  await page.getByTestId('adjustment-invert').click();
  let list = await nodes(page);
  expect(list.at(-1)!.type).toBe('adjustment');
  expect(list.at(-1)!.adjustment.kind).toBe('invert');

  // Masque sur le fond.
  await page.evaluate(() => {
    const { editor, photo } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
    photo.addMask();
  });
  list = await nodes(page);
  expect(list[0].mask?.enabled).toBe(true);
  await expect(page.getByTestId(`mask-${list[0].id}`)).toBeVisible();
});

test('enregistre et rouvre une retouche (pixels, masque, réglage), puis exporte', async ({ page }, info) => {
  await openTestPhoto(page);
  await page.keyboard.press('b');
  await drag(page, [40, 40], [140, 40]);
  await page.getByRole('toolbar').getByTestId('add-adjustment').click();
  await page.getByTestId('adjustment-blackWhite').click();
  await page.evaluate(() => {
    const { editor, photo } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
    photo.addMask();
  });
  const before = (await nodes(page)).map((n) => ({ type: n.type, mask: !!n.mask, kind: n.adjustment?.kind }));

  for (const kind of ['png', 'svg', 'pdf'] as const) {
    await page.getByRole('button', { name: 'Exporter', exact: true }).first().click();
    await page.getByTestId(`export-${kind}`).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-go').click(),
    ]);
    const path = info.outputPath(`photo.${kind}`);
    await download.saveAs(path);
    expect(readFileSync(path).length).toBeGreaterThan(200);
  }

  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const path = info.outputPath('photo.poulpe');
  await download.saveAs(path);

  await page.keyboard.press('Control+n');
  await page.getByTestId('new-create').click();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  // (Fichier passé par son contenu : Playwright ne transmet pas les chemins accentués.)
  await (
    await chooser
  ).setFiles({ name: 'photo.poulpe', mimeType: 'application/octet-stream', buffer: readFileSync(path) });
  await expect
    .poll(async () =>
      (await nodes(page)).map((n) => ({ type: n.type, mask: !!n.mask, kind: n.adjustment?.kind })),
    )
    .toEqual(before);
  expect(await page.evaluate(() => (window as any).poulpe.editor.doc.version)).toBe(8);
  // Le coup de pinceau a survécu à l'enregistrement.
  expect((await pixel(page, 1, 90, 40))[3]).toBeGreaterThan(200);
});

test('applique un filtre flou gaussien', async ({ page }) => {
  await openTestPhoto(page);
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
  await page.evaluate(() => (window as any).poulpe.photo.applyFilter({ kind: 'gaussianBlur', radius: 8 }));
  await page.waitForTimeout(200);
  const edge = await pixel(page, 0, 170, 150);
  // Le bord du carré est mélangé (ni bleu pur ni rouge pur).
  expect(edge[0]).toBeGreaterThan(0x33 + 10);
  expect(edge[0]).toBeLessThan(0xdd - 10);
});
