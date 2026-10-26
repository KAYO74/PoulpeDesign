import { readFileSync } from 'node:fs';
import { choose } from './choose';
import { expect, test, type Page } from '@playwright/test';

/* Mise en page (v0.5) : pages, pages maîtres, numéros de page, cadres de texte liés, PDF d'impression. */

type AnyDoc = Record<string, any>;

const doc = (page: Page): Promise<AnyDoc> => page.evaluate(() => (window as any).poulpe.editor.doc);

async function canvas(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y];
  const drag = async (a: [number, number], b: [number, number], steps = 8) => {
    await page.mouse.move(...at(...a));
    await page.mouse.down();
    await page.mouse.move(...at(...b), { steps });
    await page.mouse.up();
  };
  return { at, drag, box };
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await page.evaluate(
    () => ((window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined),
  );
  await expect(page.getByTestId('canvas')).toBeVisible();
});

/** Nouveau document A4 de `n` pages, depuis l'écran « Nouveau document ». */
async function newA4(page: Page, n: number) {
  await page.keyboard.press('Control+n');
  await page.getByTestId('new-print').click();
  await page.getByTestId('preset-a4').click();
  const pages = page.getByTestId('new-pages');
  await pages.fill(String(n));
  await pages.press('Enter');
  await page.getByTestId('new-create').click();
}

test('crée un document de plusieurs pages et gère ses pages', async ({ page }) => {
  await newA4(page, 3);
  // Un document de plusieurs pages s'ouvre dans la Persona Mise en page, avec le panneau Pages.
  await expect(page.getByTestId('persona-layout')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('pages-panel')).toBeVisible();
  let d = await doc(page);
  expect(d.artboards).toHaveLength(3);
  expect(d.layout.dpi).toBe(300);
  // Les pages sont rangées en colonne.
  expect(d.artboards[1].y).toBeGreaterThan(d.artboards[0].y + d.artboards[0].height);

  await page.getByTestId('page-1').click();
  await page.getByTestId('duplicate-page').click();
  await page.getByTestId('add-page').click();
  d = await doc(page);
  expect(d.artboards.map((a: AnyDoc) => a.name)).toEqual([
    'Page 1',
    'Page 2',
    'Page 2 (copie)',
    'Page 5',
    'Page 3',
  ]);
  await page.getByTestId('delete-page').click();
  expect((await doc(page)).artboards).toHaveLength(4);
  await page.keyboard.press('Control+z');
  expect((await doc(page)).artboards).toHaveLength(5);

  // Retour à la Persona Dessin : la bibliothèque revient.
  await page.getByTestId('persona-draw').click();
  await expect(page.getByTestId('library')).toBeVisible();
});

test('affiche la page maître et son numéro de page sur chaque page', async ({ page }) => {
  await newA4(page, 2);
  await page.getByTestId('add-master').click();
  let d = await doc(page);
  const master = d.artboards.find((a: AnyDoc) => a.master);
  expect(master.name).toBe('A-Maître');
  // La page active (page 1) prend la nouvelle page maître ; la page 2 la reçoit par le menu.
  expect(d.artboards[0].masterId).toBe(master.id);
  await page.evaluate(() => (window as any).poulpe.layout.insertPageNumber());
  await page.getByTestId('page-1').click();
  await choose(page.getByLabel('Page maître', { exact: true }), { label: 'A-Maître' });
  d = await doc(page);
  expect(d.artboards[1].masterId).toBe(master.id);
  const num = d.artboards.find((a: AnyDoc) => a.master).children[0];
  expect(num.text).toBe('{page}');

  // Le PDF montre « 1 » et « 2 » à la place du champ, à la taille réelle d'une page A4.
  await page.getByRole('button', { name: 'Exporter', exact: true }).first().click();
  await page.getByTestId('export-pdf').click();
  await expect(page.getByText('Taille réelle : 210 × 297 mm à 300 ppp')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-go').click(),
  ]);
  const pdf = (await download.path()) && readFileSync((await download.path())!).toString('latin1');
  expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);
  expect(pdf).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.9\d*\]/);
  expect(pdf).toContain('/TrimBox');
});

test('fait couler un texte d’un cadre à un autre', async ({ page }) => {
  await newA4(page, 2);
  const { drag, at } = await canvas(page);
  // Un cadre de texte en haut de la page 1.
  await page.getByTestId('page-0').click();
  let d = await doc(page);
  const p1 = d.artboards[0];
  const a = await toScreen(page, p1.x + 200, p1.y + 200);
  const b = await toScreen(page, p1.x + 1400, p1.y + 700);
  await page.keyboard.press('t');
  await drag(a, b);
  const words = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ');
  await page.keyboard.type(words);
  await page.keyboard.press('Escape');
  d = await doc(page);
  const frame = d.artboards[0].children[0];
  expect(frame.frame).toBe(true);
  const height = frame.height;

  // Le texte déborde : clic sur l'indicateur rouge, puis clic plus bas pour créer le cadre suivant.
  await page.keyboard.press('v');
  await page.mouse.click(...at(...(await toScreen(page, frame.x + frame.width / 2, frame.y + 10))));
  const corner = await toScreen(page, frame.x + frame.width, frame.y + frame.height);
  await page.mouse.click(...at(...corner));
  await page.mouse.click(...at(...(await toScreen(page, p1.x + 200, p1.y + 1500))));
  d = await doc(page);
  const [first, second] = d.artboards[0].children;
  expect(first.next).toBe(second.id);
  expect(second.frame).toBe(true);
  // Le premier cadre garde sa hauteur ; le deuxième affiche la suite.
  expect(first.height).toBeCloseTo(height, 0);
  const shown = await page.evaluate(
    ([id]) => {
      const p = (window as any).poulpe;
      return p.layout.flowParts(id).map((x: { start: number; end: number }) => [x.start, x.end]);
    },
    [first.id],
  );
  expect(shown).toHaveLength(2);
  expect(shown[1][0]).toBe(shown[0][1]);
  expect(shown[1][1]).toBeGreaterThan(shown[1][0]);

  // Rompre le lien : la chaîne se défait.
  await page.evaluate(([id]) => (window as any).poulpe.editor.select([id]), [second.id]);
  await page.evaluate(() => (window as any).poulpe.layout.unlinkSelected());
  expect((await doc(page)).artboards[0].children[0].next).toBeUndefined();
});

test('règle marges et fond perdu, puis exporte avec traits de coupe', async ({ page }) => {
  await newA4(page, 1);
  await page.getByTestId('persona-layout').click();
  await page.getByRole('button', { name: 'Réglages du document…' }).first().click();
  await page.getByTestId('doc-margins').check();
  const bleed = page.getByTestId('doc-bleed');
  await bleed.fill('3');
  await bleed.press('Enter');
  await page.getByTestId('doc-apply').click();
  const d = await doc(page);
  expect(d.layout.bleed).toBeCloseTo(35.43, 1);
  expect(d.layout.margins.top).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Exporter', exact: true }).first().click();
  await page.getByTestId('export-pdf').click();
  await expect(page.getByTestId('export-bleed')).toBeChecked();
  await page.getByTestId('export-marks').check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-go').click(),
  ]);
  const pdf = readFileSync((await download.path())!).toString('latin1');
  // A4 + 2 × (3 mm de fond perdu + 18 pt pour les traits de coupe).
  const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)!;
  expect(Number(media[1])).toBeCloseTo(595.28 + 2 * (8.5 + 18), 0);
  expect(pdf).toMatch(/\/BleedBox \[18\.?\d* 18\.?\d* /);
  expect(pdf).toMatch(/\/TrimBox \[26\.50\d* 26\.50\d* /);
});
