import { expect, test, type Page } from '@playwright/test';

/* Version 1.2.8 : création de pinceau (forme depuis une image, pinceaux Photoshop .abr, angle). */

const brush = (page: Page): Promise<Record<string, any>> =>
  page.evaluate(() => (window as any).poulpe.ui.get().brushes.brush);
const tips = (page: Page): Promise<number> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('poulpe.brushTips') ?? '[]').length);

/** Photo de test 400×300, toute bleue. */
async function openTestPhoto(page: Page) {
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3366cc';
    g.fillRect(0, 0, 400, 300);
    (window as any).poulpe.photo.openPhotoDocument(c.toDataURL('image/png'), 'image/png', 400, 300, 'Test');
  });
  await page.waitForTimeout(300);
}

async function screen(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const p = await page.evaluate(([x, y]) => (window as any).poulpe.controller().toScreen({ x, y }), [x, y]);
  return [box.x + p.x, box.y + p.y];
}

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    async ([x, y]) => {
      const { editor, controller } = (window as any).poulpe;
      // Le pinceau peint sur un nouveau calque de pixels, au-dessus de la photo.
      const n = editor.doc.artboards[0].children.at(-1);
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
    [x, y],
  );
}

/** Une barre noire horizontale sur fond blanc (le sombre peint). */
async function barPng(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 60;
    c.height = 60;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 60, 60);
    g.fillStyle = '#000';
    g.fillRect(0, 26, 60, 8);
    return c.toDataURL('image/png');
  });
  return Buffer.from(url.split(',')[1], 'base64');
}

const dark = (p: number[]) => p[3] > 128 && p[0] + p[1] + p[2] < 200;
const empty = (p: number[]) => p[3] < 30;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await openTestPhoto(page);
  await page.keyboard.press('b');
  await page.getByTestId('studio').getByTestId('tab-brush').click();
  await page.getByTestId('brush-create').click();
  await expect(page.getByTestId('float-brush-editor')).toBeVisible();
});

test('une forme créée depuis une image peint sa forme, et l’angle la tourne', async ({ page }) => {
  await page
    .getByTestId('brush-tip-image')
    .setInputFiles({ name: 'barre.png', mimeType: 'image/png', buffer: await barPng(page) });
  await expect.poll(async () => (await brush(page)).tip).toMatch(/^tip-/);
  expect((await brush(page)).spacing).toBe(25);
  await page.evaluate(() =>
    (window as any).poulpe.ui.set((s: any) => ({
      brushes: { ...s.brushes, brush: { ...s.brushes.brush, size: 40 } },
    })),
  );

  // La fenêtre reste ouverte : on essaie sur le document.
  await page.mouse.click(...(await screen(page, 80, 80)));
  await expect.poll(async () => dark(await pixel(page, 95, 80))).toBe(true);
  expect(empty(await pixel(page, 80, 95))).toBe(true);

  await page.getByTestId('brush-angle').fill('90');
  expect((await brush(page)).angle).toBe(90);
  await page.mouse.click(...(await screen(page, 80, 200)));
  await expect.poll(async () => dark(await pixel(page, 80, 215))).toBe(true);
  expect(empty(await pixel(page, 95, 200))).toBe(true);

  // Enregistré comme préréglage, avec sa forme.
  await page.getByTestId('brush-editor-name').fill('Barre');
  await page.getByTestId('brush-editor-save').click();
  const presets = await page.evaluate(() => JSON.parse(localStorage.getItem('poulpe.brushPresets') ?? '[]'));
  expect(presets.at(-1)).toMatchObject({ name: 'Barre', angle: 90 });
  expect(presets.at(-1).tip).toMatch(/^tip-/);

  await page.getByTestId('brush-tip-round').click();
  expect((await brush(page)).tip).toBeUndefined();
  await page.getByTestId('brush-editor-close').click();
  await expect(page.getByTestId('float-brush-editor')).toBeHidden();
});

test('importe les formes d’un pinceau Photoshop (.abr anciens et récents)', async ({ page }) => {
  // Version 1 : une forme échantillonnée 4×4.
  const v1 = Buffer.alloc(4 + 6 + 50);
  let o = 0;
  o = v1.writeUInt16BE(1, o);
  o = v1.writeUInt16BE(1, o);
  o = v1.writeUInt16BE(2, o);
  o = v1.writeUInt32BE(50, o);
  o += 4 + 2 + 1 + 8;
  o = v1.writeInt32BE(0, o);
  o = v1.writeInt32BE(0, o);
  o = v1.writeInt32BE(4, o);
  o = v1.writeInt32BE(4, o);
  o = v1.writeUInt16BE(8, o);
  o = v1.writeUInt8(0, o);
  v1.fill(255, o, o + 16);
  await page
    .getByTestId('brush-tip-abr')
    .setInputFiles({ name: 'ancien.abr', mimeType: 'application/octet-stream', buffer: v1 });
  await expect.poll(() => tips(page)).toBe(1);

  // Version 6.2 : bloc « samp », une forme 3×2 compressée (PackBits).
  const rows = [Buffer.from([0xfe, 200]), Buffer.from([0xfe, 120])];
  const body = Buffer.alloc(301 + 16 + 3 + 4 + rows[0].length + rows[1].length);
  let b = 301;
  b = body.writeInt32BE(0, b);
  b = body.writeInt32BE(0, b);
  b = body.writeInt32BE(2, b);
  b = body.writeInt32BE(3, b);
  b = body.writeUInt16BE(8, b);
  b = body.writeUInt8(1, b);
  b = body.writeUInt16BE(2, b);
  b = body.writeUInt16BE(2, b);
  rows[0].copy(body, b);
  rows[1].copy(body, b + 2);
  const item = Buffer.concat([Buffer.alloc(4), body]);
  item.writeUInt32BE(body.length, 0);
  const padded = Buffer.concat([item, Buffer.alloc((4 - (body.length % 4)) % 4)]);
  const head = Buffer.alloc(16);
  head.writeUInt16BE(6, 0);
  head.writeUInt16BE(2, 2);
  head.write('8BIMsamp', 4, 'latin1');
  head.writeUInt32BE(padded.length, 12);
  await page.getByTestId('brush-tip-abr').setInputFiles({
    name: 'recent.abr',
    mimeType: 'application/octet-stream',
    buffer: Buffer.concat([head, padded]),
  });
  await expect.poll(() => tips(page)).toBe(2);
  expect((await brush(page)).tip).toMatch(/^tip-/);
});
