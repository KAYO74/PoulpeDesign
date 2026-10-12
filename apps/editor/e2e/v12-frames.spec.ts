import { expect, test, type Page } from '@playwright/test';

/* Version 1.2 : cadres d'image, outil Image, Tableau et panneau Pages (Persona Mise en page). */

type AnyDoc = Record<string, any>;

const ICON = (name: string) => new URL(`../../desktop/src-tauri/icons/${name}`, import.meta.url).pathname;

const doc = (page: Page): Promise<AnyDoc> => page.evaluate(() => (window as any).poulpe.editor.doc);
const tool = (page: Page): Promise<string> => page.evaluate(() => (window as any).poulpe.ui.get().tool);

/** Position à l'écran (fenêtre) d'un point du document. */
async function screen(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const v = await page.evaluate(() => (window as any).poulpe.ui.get().view);
  return [box.x + x * v.zoom + v.panX, box.y + y * v.zoom + v.panY];
}

async function drag(page: Page, a: [number, number], b: [number, number]) {
  await page.mouse.move(...(await screen(page, ...a)));
  await page.mouse.down();
  await page.mouse.move(...(await screen(page, ...b)), { steps: 8 });
  await page.mouse.up();
}

async function choose(page: Page, click: () => Promise<void>, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await click();
  await (await chooser).setFiles(ICON(file));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

/** Nouveau document A4 de `n` pages (Persona Mise en page). */
async function newA4(page: Page, n: number) {
  await page.keyboard.press('Control+n');
  await page.getByTestId('new-print').click();
  await page.getByTestId('preset-a4').click();
  const pages = page.getByTestId('new-pages');
  await pages.fill(String(n));
  await pages.press('Enter');
  await page.getByTestId('new-create').click();
  await expect(page.getByTestId('persona-layout')).toHaveAttribute('aria-pressed', 'true');
}

test('dessine un cadre d’image, y place une image qui suit le cadre, la remplace', async ({ page }) => {
  await newA4(page, 2);
  // F choisit le cadre rectangle, puis le cadre ellipse, puis revient au rectangle.
  await page.keyboard.press('f');
  expect(await tool(page)).toBe('pictureFrameRect');
  await page.keyboard.press('f');
  expect(await tool(page)).toBe('pictureFrameEllipse');
  await page.keyboard.press('f');
  expect(await tool(page)).toBe('pictureFrameRect');

  // Alt : sans magnétisme, pour une taille exacte.
  await page.keyboard.down('Alt');
  await drag(page, [200, 200], [1200, 1000]);
  await page.keyboard.up('Alt');
  let frame = (await doc(page)).artboards[0].children[0];
  expect(frame.type).toBe('group');
  expect(frame.picture).toEqual({ fit: 'fill' });
  expect(frame.children).toHaveLength(1);
  const m = frame.children[0];
  expect(m.x).toBeCloseTo(200, -1);
  expect(m.width).toBeCloseTo(1000, -1);
  expect(m.height).toBeCloseTo(800, -1);
  // Taille exacte pour la suite.
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.apply('history.resize', (d: any) => {
      Object.assign(d.artboards[0].children[0].children[0], { x: 200, y: 200, width: 1000, height: 800 });
    });
  });

  // Cadre vide sélectionné : « Placer une image » le remplit (échelle max. : l'image couvre le cadre).
  await page.keyboard.press('v');
  await choose(page, () => page.getByTestId('frame-place').click(), '128x128.png');
  await expect.poll(async () => (await doc(page)).artboards[0].children[0].children.length).toBe(2);
  frame = (await doc(page)).artboards[0].children[0];
  expect(frame.children[1]).toMatchObject({ type: 'image', width: 1000, height: 1000, x: 200, y: 100 });
  // La sélection et ses poignées restent celles du cadre.
  expect(frame.height).toBe(800);

  await page.getByTestId('frame-fit').selectOption('fit');
  frame = (await doc(page)).artboards[0].children[0];
  expect(frame.children[1]).toMatchObject({ width: 800, height: 800, x: 300, y: 200 });

  // Retour à l'échelle max., puis le cadre s'élargit : l'image le couvre toujours, sans déformation.
  await page.getByTestId('frame-fit').selectOption('fill');
  await drag(page, [1200, 600], [1600, 600]);
  frame = (await doc(page)).artboards[0].children[0];
  expect(frame.children[0].width).toBeCloseTo(1400, 0);
  expect(frame.children[1].width).toBeCloseTo(1400, 0);
  expect(frame.children[1].height).toBeCloseTo(1400, 0);

  // Zoom de l'image dans le cadre.
  const zoom = page.getByTestId('frame-zoom-value');
  await zoom.fill('150');
  await zoom.press('Enter');
  frame = (await doc(page)).artboards[0].children[0];
  expect(frame.children[1].width).toBeCloseTo(2100, 0);

  // Remplacer l'image : la nouvelle garde la place, la taille et le zoom.
  const before = frame.children[1];
  await choose(page, () => page.getByTestId('frame-replace').click(), '32x32.png');
  await expect
    .poll(async () => (await doc(page)).artboards[0].children[0].children[1].assetId)
    .not.toBe(before.assetId);
  frame = (await doc(page)).artboards[0].children[0];
  expect(frame.children[1].width).toBeCloseTo(before.width, 3);
  expect(frame.children[1].x).toBeCloseTo(before.x, 3);
  await page.keyboard.press('Control+z');
  expect((await doc(page)).artboards[0].children[0].children[1].assetId).toBe(before.assetId);

  // Double-clic dans le cadre : on prend l'image, qu'un glisser déplace dans le cadre.
  const [cx, cy] = await screen(page, 900, 600);
  await page.mouse.dblclick(cx, cy);
  const sel = await page.evaluate(() => (window as any).poulpe.editor.selection);
  expect(sel).toEqual([before.id]);
  await drag(page, [900, 600], [1000, 600]);
  frame = (await doc(page)).artboards[0].children[0];
  expect(frame.children[1].x).toBeCloseTo(before.x + 100, 0);
  expect(frame.children[0].x).toBe(200);

  // Cadre ellipse, puis une image déposée dessus depuis le panneau.
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.keyboard.press('f');
  await drag(page, [400, 1400], [900, 1900]);
  const ellipse = (await doc(page)).artboards[0].children[1];
  expect(ellipse.children[0].type).toBe('ellipse');
});

test('l’outil Image pose une image à sa taille réelle d’un clic, ou à la taille d’un glisser', async ({
  page,
}) => {
  await choose(page, () => page.getByTestId('tool-image').click(), '128x128.png');
  await expect.poll(() => tool(page)).toBe('image');
  await expect(page.getByTestId('image-pending')).toHaveText('128 × 128 px');
  expect((await doc(page)).artboards[0].children).toHaveLength(0);
  const [x, y] = await screen(page, 100, 120);
  await page.mouse.click(x, y);
  let img = (await doc(page)).artboards[0].children[0];
  expect(img).toMatchObject({ type: 'image', width: 128, height: 128 });
  expect(img.x).toBeCloseTo(100, 0);
  expect(img.y).toBeCloseTo(120, 0);
  expect(await tool(page)).toBe('select');

  await choose(page, () => page.getByTestId('tool-image').click(), '128x128.png');
  await expect.poll(() => tool(page)).toBe('image');
  await drag(page, [300, 500], [700, 600]);
  img = (await doc(page)).artboards[0].children[1];
  // Les proportions de l'image sont gardées : 400 × 400.
  expect(img.width).toBeCloseTo(400, 0);
  expect(img.height).toBeCloseTo(400, 0);
  expect(img.x).toBeCloseTo(300, 0);

  // Échap annule une image en attente.
  await choose(page, () => page.getByTestId('tool-image').click(), '32x32.png');
  await expect.poll(() => tool(page)).toBe('image');
  await page.keyboard.press('Escape');
  expect(await tool(page)).toBe('select');
  expect((await doc(page)).artboards[0].children).toHaveLength(2);
});

test('crée un tableau, écrit dans ses cellules et règle ses lignes et son en-tête', async ({ page }) => {
  await newA4(page, 2);
  // T passe du cadre de texte au texte artistique, puis au tableau.
  for (let i = 0; i < 3; i++) await page.keyboard.press('t');
  expect(await tool(page)).toBe('table');
  await drag(page, [300, 300], [1500, 700]);
  let table = (await doc(page)).artboards[0].children[0];
  expect(table.table).toMatchObject({ rows: 3, cols: 3 });
  expect(table.children).toHaveLength(18);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  const editorBox = page.getByTestId('text-editor');
  await page.keyboard.type('Nom');
  await page.keyboard.press('Tab');
  await expect(editorBox).toBeFocused();
  await page.keyboard.type('Prix');
  await page.keyboard.press('Shift+Tab');
  // Retour dans la première cellule : son texte est sélectionné, Fin place le curseur après.
  await expect(editorBox).toHaveValue('Nom');
  await expect(editorBox).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' complet');
  await page.keyboard.press('Escape');
  table = (await doc(page)).artboards[0].children[0];
  expect(table.children[1].text).toBe('Nom complet');
  expect(table.children[3].text).toBe('Prix');

  // Un texte de plusieurs lignes fait grandir sa ligne.
  const rowH = table.children[0].height;
  const [cx, cy] = await screen(page, 1300, 400);
  await page.mouse.click(cx, cy);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('a');
  for (const ch of 'bcde') {
    await page.keyboard.press('Enter');
    await page.keyboard.type(ch);
  }
  await page.keyboard.press('Escape');
  table = (await doc(page)).artboards[0].children[0];
  expect(table.children[5].text).toBe('a\nb\nc\nd\ne');
  expect(table.children[0].height).toBeGreaterThan(rowH * 1.5);
  // Toute la ligne grandit, et la ligne suivante descend.
  expect(table.children[2].height).toBeCloseTo(table.children[0].height, 3);
  expect(table.children[6].y).toBeCloseTo(table.children[0].y + table.children[0].height, 3);

  // Une ligne de plus, l'en-tête, puis une colonne de moins.
  await page.getByTestId('table-add-row').click();
  table = (await doc(page)).artboards[0].children[0];
  expect(table.table.rows).toBe(4);
  await page.getByTestId('table-header').check();
  table = (await doc(page)).artboards[0].children[0];
  expect(table.table.header).toBe(true);
  expect(table.children[1].style.fontWeight).toBe(700);
  const cols = page.getByTestId('table-cols');
  await cols.fill('2');
  await cols.press('Enter');
  table = (await doc(page)).artboards[0].children[0];
  expect(table.table.cols).toBe(2);
  expect(table.children).toHaveLength(16);
  await page.keyboard.press('Control+z');
  expect((await doc(page)).artboards[0].children[0].table.cols).toBe(3);
});

test('choisit plusieurs pages, en ajoute, applique une page maître et en détache des objets', async ({
  page,
}) => {
  await newA4(page, 4);
  await page.getByTestId('page-0').click();
  await page.getByTestId('page-2').click({ modifiers: ['Control'] });
  await expect(page.getByText('2 pages choisies')).toBeVisible();
  await page.getByTestId('delete-page').click();
  let d = await doc(page);
  expect(d.artboards.map((a: AnyDoc) => a.name)).toEqual(['Page 2', 'Page 4']);

  // Maj + clic : toutes les pages entre les deux, dupliquées ensemble.
  await page.getByTestId('page-0').click();
  await page.getByTestId('page-1').click({ modifiers: ['Shift'] });
  await page.getByTestId('duplicate-page').click();
  d = await doc(page);
  expect(d.artboards.map((a: AnyDoc) => a.name)).toEqual([
    'Page 2',
    'Page 4',
    'Page 2 (copie)',
    'Page 4 (copie)',
  ]);

  // Ajouter des pages : trois pages au début.
  await page.getByTestId('add-pages').click();
  await page.getByTestId('add-pages-count').fill('3');
  await page.getByTestId('add-pages-position').selectOption('start');
  await page.getByTestId('add-pages-go').click();
  d = await doc(page);
  expect(d.artboards).toHaveLength(7);
  expect(d.artboards[3].name).toBe('Page 2');

  // Une page maître avec un bandeau, appliquée aux pages impaires.
  await page.getByTestId('add-master').click();
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.apply('history.add', (doc: any) => {
      const m = doc.artboards.find((a: any) => a.master);
      m.children.push({
        id: 'band',
        name: 'Bandeau',
        type: 'rect',
        x: m.x + 200,
        y: m.y + 200,
        width: 800,
        height: 300,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
        fill: { type: 'solid', color: '#e5484d' },
        stroke: { paint: { type: 'none' }, width: 1 },
        cornerRadius: 0,
      });
    });
  });
  await page.getByTestId('apply-master').click();
  await page.getByTestId('apply-master-scope').selectOption('odd');
  await page.getByTestId('apply-master-go').click();
  d = await doc(page);
  const master = d.artboards.find((a: AnyDoc) => a.master);
  const pages = d.artboards.filter((a: AnyDoc) => !a.master);
  expect(pages.map((p: AnyDoc) => p.masterId === master.id)).toEqual([
    true,
    false,
    true,
    false,
    true,
    false,
    true,
  ]);

  // Double-clic sur le bandeau de la page 3 : il est détaché sur la page.
  await page.getByTestId('page-2').click();
  await page.keyboard.press('v');
  const p3 = pages[2];
  await page.waitForTimeout(100);
  const [bx, by] = await screen(page, p3.x + 600, p3.y + 350);
  await page.mouse.dblclick(bx, by);
  d = await doc(page);
  const page3 = d.artboards.find((a: AnyDoc) => a.id === p3.id);
  expect(page3.masterHidden).toEqual(['band']);
  expect(page3.children[0]).toMatchObject({ name: 'Bandeau', x: p3.x + 200, y: p3.y + 200 });
  expect(await page.evaluate(() => (window as any).poulpe.editor.selection)).toEqual([page3.children[0].id]);

  // Détacher la page 5 de sa page maître : elle garde une copie du bandeau.
  await page.getByTestId('page-4').click();
  await page.getByTestId('detach-master').click();
  d = await doc(page);
  const page5 = d.artboards.filter((a: AnyDoc) => !a.master)[4];
  expect(page5.masterId).toBeUndefined();
  expect(page5.children.map((c: AnyDoc) => c.name)).toEqual(['Bandeau']);
});
