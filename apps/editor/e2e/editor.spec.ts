import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Snapshot = {
  history: string[];
  nodes: {
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    fill: string;
  }[];
};

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = (window as unknown as { poulpe: { editor: { getState: () => any } } }).poulpe.editor.getState();
    return {
      history: s.history,
      nodes: s.doc.artboards[0].children.map((n: any) => ({
        type: n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
        width: Math.round(n.width),
        height: Math.round(n.height),
        rotation: Math.round(n.rotation),
        fill: n.fill?.type ?? '',
      })),
    };
  });
}

async function canvas(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y];
  const drag = async (a: [number, number], b: [number, number]) => {
    await page.mouse.move(...at(...a));
    await page.mouse.down();
    await page.mouse.move(...at(...b), { steps: 8 });
    await page.mouse.up();
  };
  return { at, drag };
}

test.beforeEach(async ({ page }) => {
  // L'écran d'accueil masquerait le canevas : les tests partent d'un document vide.
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  // Le téléchargement remplace la boîte de dialogue d'enregistrement du navigateur.
  await page.evaluate(
    () => ((window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined),
  );
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('interface en français avec les outils à droite', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Fichier' })).toBeVisible();
  const tools = (await page.getByTestId('tool-select').boundingBox())!;
  const canvasBox = (await page.getByTestId('canvas').boundingBox())!;
  expect(tools.x).toBeGreaterThan(canvasBox.x + canvasBox.width);
});

test('dessine des formes, les déplace, les redimensionne et les fait tourner', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([350, 150], [600, 330]);
  let s = await snapshot(page);
  expect(s.nodes).toHaveLength(1);
  expect(s.nodes[0].type).toBe('rect');
  const first = s.nodes[0];

  await page.keyboard.press('v');
  await drag([450, 250], [500, 290]);
  s = await snapshot(page);
  expect(s.nodes[0].x).toBeGreaterThan(first.x);
  expect(s.history.at(-1)).toBe('history.move');

  // Poignée bas droite : on part de la nouvelle position du coin.
  const moved = s.nodes[0];
  await page.getByTestId('tab-transform').click();
  await page.getByTestId('tf-w').fill('400');
  await page.getByTestId('tf-w').press('Enter');
  s = await snapshot(page);
  expect(s.nodes[0].width).toBe(400);
  expect(s.nodes[0].x).toBe(moved.x);

  await page.getByTestId('tf-r').fill('30');
  await page.getByTestId('tf-r').press('Enter');
  s = await snapshot(page);
  expect(s.nodes[0].rotation).toBe(30);

  await page.keyboard.press('Control+z');
  s = await snapshot(page);
  expect(s.nodes[0].rotation).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  s = await snapshot(page);
  expect(s.nodes[0].rotation).toBe(30);
});

test('crée un texte et le modifie', async ({ page }) => {
  const { at } = await canvas(page);
  await page.keyboard.press('t');
  await page.mouse.click(...at(400, 400));
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Festival des Mers');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-editor')).toHaveCount(0);
  const text = await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0]);
  expect(text.type).toBe('text');
  expect(text.text).toBe('Festival des Mers');
  expect(text.width).toBeGreaterThan(100);
  const s = await snapshot(page);
  expect(s.history).toEqual(['history.open', 'history.add']);
});

test('met une partie du texte en gras', async ({ page }) => {
  const { at } = await canvas(page);
  await page.getByTestId('tab-character').click();
  await page.keyboard.press('t');
  await page.mouse.click(...at(400, 400));
  await page.keyboard.type('Festival des Mers');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Gras', exact: true }).click();
  // La saisie reprend dans le texte : la suite tapée garde le style du mot.
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' !');
  await page.keyboard.press('Escape');
  const text = await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0]);
  expect(text.text).toBe('Festival des Mers !');
  expect(text.runs).toEqual([{ start: 13, end: 19, style: { fontWeight: 700 } }]);
  const s = await snapshot(page);
  expect(s.history).toEqual(['history.open', 'history.add']);
});

test('recadre une image', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('tool-image').click();
  await (
    await chooser
  ).setFiles(new URL('../../desktop/src-tauri/icons/128x128.png', import.meta.url).pathname);
  // Comme dans Affinity, l'image choisie se pose d'un clic (à sa taille réelle).
  await expect.poll(() => page.evaluate(() => (window as any).poulpe.ui.get().tool)).toBe('image');
  const area = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
  await expect.poll(async () => (await snapshot(page)).nodes.length).toBe(1);
  const toScreen = async (x: number, y: number): Promise<[number, number]> => {
    const box = (await page.getByTestId('canvas').boundingBox())!;
    const v = await page.evaluate(() => (window as any).poulpe.ui.get().view);
    return [box.x + x * v.zoom + v.panX, box.y + y * v.zoom + v.panY];
  };
  const img = () => page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0]);
  const start = await img();
  await page.keyboard.press('v');
  await page.mouse.dblclick(...(await toScreen(start.x + start.width / 2, start.y + start.height / 2)));
  await expect(page.getByTestId('crop')).toHaveAttribute('aria-pressed', 'true');

  // Poignée droite vers la gauche : le cadre rétrécit, l'image ne bouge pas.
  const [hx, hy] = await toScreen(start.x + start.width, start.y + start.height / 2);
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 40, hy, { steps: 5 });
  await page.mouse.up();
  let n = await img();
  expect(n.width).toBeLessThan(start.width);
  expect(n.x).toBeCloseTo(start.x, 3);
  expect(n.crop.x).toBe(0);
  expect(n.crop.width).toBeCloseTo(n.width / start.width, 3);

  // Glisser dans le cadre déplace l'image : on montre sa partie droite.
  const [cx, cy] = await toScreen(n.x + n.width / 2, n.y + n.height / 2);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 200, cy, { steps: 5 });
  await page.mouse.up();
  n = await img();
  expect(n.crop.x).toBeCloseTo(1 - n.crop.width, 3);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('crop')).toHaveAttribute('aria-pressed', 'false');
  expect((await snapshot(page)).history.slice(-2)).toEqual(['history.crop', 'history.crop']);
});

test('tire un repère depuis la règle, s’y aligne et le retire', async ({ page }) => {
  const ruler = (await page.getByTestId('ruler-y').boundingBox())!;
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const guides = () => page.evaluate(() => (window as any).poulpe.editor.doc.guides);
  // Règle verticale (à gauche) : repère vertical.
  await page.mouse.move(ruler.x + ruler.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 300, { steps: 6 });
  await page.mouse.up();
  const g = await guides();
  expect(g.x).toHaveLength(1);
  expect(g.y).toHaveLength(0);
  const v = await page.evaluate(() => (window as any).poulpe.ui.get().view);
  const gx = g.x[0] * v.zoom + v.panX;
  expect(Math.abs(gx - 400)).toBeLessThan(8);

  // Un rectangle dessiné près du repère s'y colle.
  await page.keyboard.press('u');
  await page.mouse.move(box.x + gx + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + gx + 150, box.y + 320, { steps: 6 });
  await page.mouse.up();
  const rect = await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0]);
  expect(rect.x).toBeCloseTo(g.x[0], 3);

  // Ramené sur la règle, le repère disparaît.
  await page.keyboard.press('v');
  await page.mouse.move(box.x + gx, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(ruler.x + ruler.width / 2, box.y + 500, { steps: 6 });
  await page.mouse.up();
  expect((await guides()).x).toHaveLength(0);
  expect((await snapshot(page)).history.filter((h) => h === 'history.guide')).toHaveLength(2);
});

test('rouvre le brouillon après une fermeture sans enregistrer', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([350, 150], [600, 330]);
  const before = (await snapshot(page)).nodes;
  // Le brouillon est écrit peu après la modification.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const req = indexedDB.open('poulpe', 1);
            req.onsuccess = () => {
              const get = req.result.transaction('drafts').objectStore('drafts').get('current');
              get.onsuccess = () => resolve(get.result?.doc.artboards[0].children.length ?? 0);
            };
          }),
      ),
    )
    .toBe(1);
  page.on('dialog', (d) => d.accept());
  await page.reload();
  await page.getByTestId('draft-restore').click();
  const s = await snapshot(page);
  expect(s.nodes).toEqual(before);
  await expect(page.locator('.doc-tab .dot')).toBeVisible();
});

test('applique un dégradé et groupe des objets', async ({ page }) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('e');
  await drag([300, 300], [450, 450]);
  await page.getByTestId('color-paint-type').selectOption('linear');
  await page.keyboard.press('u');
  await drag([500, 300], [650, 450]);
  await page.getByTestId('color-paint-type').selectOption('radial');
  let s = await snapshot(page);
  expect(s.nodes.map((n) => n.fill)).toEqual(['linear', 'radial']);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  s = await snapshot(page);
  expect(s.nodes.map((n) => n.type)).toEqual(['group']);
  await expect(page.getByRole('treeitem', { name: /Groupe/ })).toBeVisible();
});

test('exporte en PNG, JPEG, SVG et PDF, puis enregistre et rouvre un .poulpe', async ({ page }, info) => {
  const { drag, at } = await canvas(page);
  await page.keyboard.press('u');
  await drag([350, 150], [600, 330]);
  await page.keyboard.press('t');
  await page.mouse.click(...at(400, 450));
  await page.keyboard.type('Poulpe');
  await page.keyboard.press('Escape');
  for (const kind of ['png', 'jpeg', 'svg', 'pdf'] as const) {
    await page.getByRole('button', { name: 'Exporter', exact: true }).first().click();
    await page.getByTestId(`export-${kind}`).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-go').click(),
    ]);
    const path = info.outputPath(`export.${kind}`);
    await download.saveAs(path);
    const head = readFileSync(path).subarray(0, 8);
    const magic = { png: [0x89, 0x50], jpeg: [0xff, 0xd8], svg: [0x3c, 0x73], pdf: [0x25, 0x50] }[kind];
    expect([...head.subarray(0, 2)]).toEqual(magic);
    // La police du texte (Inter, fournie avec Poulpe) est intégrée au PDF.
    if (kind === 'pdf') expect(readFileSync(path).includes('/FontFile2')).toBe(true);
  }
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const path = info.outputPath('doc.poulpe');
  await download.saveAs(path);
  const before = await snapshot(page);

  // Nouveau document, puis réouverture du fichier enregistré.
  await page.keyboard.press('Control+n');
  await page.getByTestId('new-create').click();
  expect((await snapshot(page)).nodes).toHaveLength(0);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles(path);
  await expect.poll(async () => (await snapshot(page)).nodes).toEqual(before.nodes);
});

test('passe en anglais et déplace la colonne d’outils à gauche', async ({ page }) => {
  await page.keyboard.press('Control+,');
  await page.getByTestId('prefs-language').selectOption('en');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'File' })).toBeVisible();
  await page.getByRole('button', { name: 'Tools column' }).click();
  const tools = (await page.getByTestId('tool-select').boundingBox())!;
  const canvasBox = (await page.getByTestId('canvas').boundingBox())!;
  expect(tools.x).toBeLessThan(canvasBox.x);
});
