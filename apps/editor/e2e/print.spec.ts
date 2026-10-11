import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { expect, test, type FileChooser, type Page } from '@playwright/test';
import { readPsd, writePsd, type Psd } from 'ag-psd';
import { unzipSync } from 'fflate';
import { jsPDF } from 'jspdf';

/*
 * Impression et formats (v0.5, deuxième partie) : CMJN, épreuvage, PDF/X-4, ouverture des fichiers
 * PDF, Illustrator et Photoshop, export PSD et export par lots.
 */

type AnyDoc = Record<string, any>;

const doc = (page: Page): Promise<AnyDoc> => page.evaluate(() => (window as any).poulpe.editor.doc);

/** Objets du document, à plat (groupes compris). */
function flat(nodes: AnyDoc[]): AnyDoc[] {
  return nodes.flatMap((n) => [n, ...(n.children ? flat(n.children) : [])]);
}

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

/** Petit PDF de deux pages : un rectangle rouge, un trait bleu, un texte vert, un dégradé. */
function samplePdf(): Buffer {
  const pdf = new jsPDF({ unit: 'pt', format: [400, 300], orientation: 'landscape' });
  pdf.setFillColor(255, 0, 0);
  pdf.rect(20, 20, 100, 60, 'F');
  pdf.setDrawColor(0, 0, 255);
  pdf.setLineWidth(4);
  pdf.line(20, 150, 300, 150);
  pdf.setTextColor(0, 128, 0);
  pdf.setFontSize(24);
  pdf.text('Bonjour Poulpe', 150, 60);
  pdf.addPage([400, 300], 'landscape');
  pdf.setFillColor(0, 0, 0);
  pdf.circle(200, 150, 50, 'F');
  return Buffer.from(pdf.output('arraybuffer'));
}

async function openFile(page: Page, name: string, buffer: Buffer) {
  // Quand la machine est chargée, le premier raccourci arrive parfois avant que la page écoute.
  let chooser: FileChooser | undefined;
  await expect(async () => {
    const waiting = page.waitForEvent('filechooser', { timeout: 4_000 });
    await page.keyboard.press('Control+o');
    chooser = await waiting;
  }).toPass({ timeout: 20_000 });
  await chooser!.setFiles({ name, mimeType: 'application/octet-stream', buffer });
}

/** Flux d'un PDF, décompressés. */
function pdfStreams(bytes: Buffer): string[] {
  const s = bytes.toString('latin1');
  const out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      out.push(inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'));
    } catch {
      out.push(m[1]);
    }
  }
  return out;
}

test('ouvre un PDF en objets modifiables, page par page', async ({ page }) => {
  await openFile(page, 'essai.pdf', samplePdf());
  await expect.poll(async () => (await doc(page)).artboards.length, { timeout: 20_000 }).toBe(2);
  const d = await doc(page);
  expect(d.layout.dpi).toBe(72);
  expect(d.artboards[0].width).toBe(400);
  await expect(page.getByTestId('persona-layout')).toHaveAttribute('aria-pressed', 'true');
  const nodes = flat(d.artboards[0].children);
  const rect = nodes.find((n) => n.type === 'path' && n.fill.type === 'solid' && n.fill.color === '#ff0000')!;
  expect(rect).toBeTruthy();
  expect(rect.x - d.artboards[0].x).toBeCloseTo(20, 0);
  expect(rect.width).toBeCloseTo(100, 0);
  const line = nodes.find((n) => n.type === 'path' && n.stroke.paint.color === '#0000ff')!;
  expect(line.stroke.width).toBeCloseTo(4, 1);
  const text = nodes.find((n) => n.type === 'text')!;
  expect(text.text).toBe('Bonjour Poulpe');
  expect(text.style.fontSize).toBeCloseTo(24, 0);
  expect(text.fill.color).toBe('#008000');
  expect(flat(d.artboards[1].children).some((n) => n.type === 'path' && n.fill.color === '#000000')).toBe(
    true,
  );
});

test('ouvre un fichier Illustrator par sa partie PDF', async ({ page }) => {
  await openFile(page, 'logo.ai', samplePdf());
  await expect.poll(async () => (await doc(page)).artboards.length, { timeout: 20_000 }).toBe(2);
  expect((await doc(page)).name).toBe('logo');
  // Un ancien fichier AI sans compatibilité PDF est refusé avec une explication.
  // Le document importé n'est pas enregistré : on accepte de l'abandonner.
  const messages: string[] = [];
  page.on('dialog', (d) => {
    messages.push(d.message());
    void (d.type() === 'confirm' ? d.accept() : d.dismiss());
  });
  await openFile(page, 'ancien.ai', Buffer.from('%!PS-Adobe-3.0\n%%Creator: Illustrator\n'));
  await expect.poll(() => messages.some((m) => m.includes('compatible PDF'))).toBe(true);
});

/** Calque de pixels d'une couleur unie. */
function solidLayer(name: string, w: number, h: number, rgba: number[], extra: Record<string, unknown> = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { name, left: 0, top: 0, imageData: { width: w, height: h, data }, ...extra };
}

test('ouvre un fichier Photoshop avec ses calques, puis l’exporte en PSD', async ({ page }, info) => {
  const psd: Psd = {
    width: 120,
    height: 80,
    imageData: { width: 120, height: 80, data: new Uint8ClampedArray(120 * 80 * 4).fill(255) },
    children: [
      solidLayer('Fond rouge', 120, 80, [255, 0, 0, 255]),
      {
        name: 'Groupe',
        children: [
          solidLayer('Carré bleu', 30, 20, [0, 0, 255, 255], {
            left: 10,
            top: 15,
            opacity: 0.5,
            blendMode: 'multiply',
          }),
          solidLayer('Caché', 10, 10, [0, 255, 0, 255], { hidden: true }),
        ],
      },
      { name: 'Négatif', adjustment: { type: 'invert' } },
    ],
  } as unknown as Psd;
  const bytes = Buffer.from(writePsd(psd, { noBackground: false }));
  await openFile(page, 'retouche.psd', bytes);
  await expect.poll(async () => (await doc(page)).artboards[0].children.length).toBe(3);
  await expect(page.getByTestId('persona-photo')).toHaveAttribute('aria-pressed', 'true');
  const d = await doc(page);
  const [bg, group, adj] = d.artboards[0].children;
  expect(d.artboards[0].width).toBe(120);
  expect(bg.type).toBe('image');
  expect(bg.name).toBe('Fond rouge');
  expect(group.type).toBe('group');
  const [blue, hidden] = group.children;
  expect([blue.x, blue.y, blue.width, blue.height]).toEqual([10, 15, 30, 20]);
  expect(blue.opacity).toBeCloseTo(0.5, 2);
  expect(blue.blendMode).toBe('multiply');
  expect(hidden.visible).toBe(false);
  expect(adj.type).toBe('adjustment');
  expect(adj.adjustment.kind).toBe('invert');

  // Export PSD : un calque par objet, le groupe en groupe de calques.
  await page.getByRole('button', { name: 'Exporter', exact: true }).first().click();
  await page.getByTestId('export-psd').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-go').click(),
  ]);
  const path = info.outputPath('export.psd');
  await download.saveAs(path);
  const back = readPsd(readFileSync(path), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  expect(back.width).toBe(120);
  // Le négatif s'applique à ce qui est dessous : fond et groupe sont réunis dans son calque.
  expect(back.children!.map((l) => l.name)).toEqual(['Négatif']);
});

test('exporte un PDF/X-4 en CMJN avec les valeurs saisies en CMJN', async ({ page }, info) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([350, 150], [600, 330]);
  // Document d'impression : couleurs CMJN.
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'document' }));
  await page.getByTestId('doc-color').selectOption('cmyk');
  await page.getByTestId('doc-apply').click();
  expect((await doc(page)).layout.colorMode).toBe('cmyk');
  // Le sélecteur de couleur s'ouvre en CMJN : 100 % cyan.
  await expect(page.getByTestId('cmyk-0')).toBeVisible();
  for (const [i, v] of [
    [0, '100'],
    [1, '0'],
    [2, '0'],
    [3, '0'],
  ] as const) {
    const field = page.getByTestId(`cmyk-${i}`);
    await field.fill(v);
    await field.press('Enter');
  }
  const d = await doc(page);
  const rect = d.artboards[0].children[0];
  expect(Object.values(d.layout.cmyk)).toContainEqual([100, 0, 0, 0]);
  expect(d.layout.cmyk[rect.fill.color]).toEqual([100, 0, 0, 0]);

  await page.getByRole('button', { name: 'Exporter', exact: true }).first().click();
  await page.getByTestId('export-pdf').click();
  await expect(page.getByTestId('export-color')).toHaveValue('cmyk');
  await page.getByTestId('export-pdfx').check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-go').click(),
  ]);
  const path = info.outputPath('pdfx.pdf');
  await download.saveAs(path);
  const bytes = readFileSync(path);
  const raw = bytes.toString('latin1');
  expect(raw.startsWith('%PDF-1.6')).toBe(true);
  expect(raw).toContain('/GTS_PDFX');
  expect(raw).toContain('/OutputIntents');
  expect(raw).toContain('(FOGRA39)');
  expect(raw).toContain('/TrimBox');
  expect(raw).not.toContain('/DeviceRGB');
  const streams = pdfStreams(bytes);
  // Flux de contenu des pages : le cyan saisi en CMJN sort tel quel, aucune couleur RVB ne reste.
  const content = streams.filter((x) => /\bre\b|\bcm\b/.test(x) && !x.includes('\0')).join('\n');
  expect(content).toMatch(/\b1 0 0 0 k\b/);
  expect(content).not.toMatch(/\b(rg|RG)\b/);
  expect(streams.join('\n')).toContain('pdfxid:GTS_PDFXVersion>PDF/X-4');
});

test('l’épreuvage CMJN montre les couleurs vives plus ternes', async ({ page }) => {
  const { drag, at } = await canvas(page);
  await page.keyboard.press('u');
  await drag([350, 150], [600, 330]);
  await page.getByTestId('hex-input').fill('00FF00');
  await page.getByTestId('hex-input').press('Enter');
  await page.keyboard.press('Escape');
  const pixel = () =>
    page.evaluate(
      ([x, y]) => {
        const c = document.querySelector('[data-testid=canvas]') as HTMLCanvasElement;
        const dpr = c.width / c.getBoundingClientRect().width;
        return [...c.getContext('2d')!.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data];
      },
      [475, 240],
    );
  void at;
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await pixel())[1]).toBeLessThan(200);
  const proof = await pixel();
  expect(proof[0]).toBeLessThan(80);
  await page.keyboard.press('Control+y');
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
});

test('exporte par lots plusieurs formats et tailles dans un ZIP', async ({ page }, info) => {
  const { drag } = await canvas(page);
  await page.keyboard.press('u');
  await drag([350, 150], [600, 330]);
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'batch' }));
  await page.getByTestId('batch-svg').check();
  await page.getByTestId('batch-scale-2').check();
  await page.getByTestId('batch-scale-3').check();
  await page.getByTestId('batch-scale-3').uncheck();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('batch-go').click()]);
  const path = info.outputPath('lot.zip');
  await download.saveAs(path);
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const name = (await doc(page)).artboards[0].name;
  expect(Object.keys(files).sort()).toEqual([`${name}.svg`, `${name}@1x.png`, `${name}@2x.png`].sort());
  expect([...files[`${name}@2x.png`].subarray(0, 2)]).toEqual([0x89, 0x50]);
});
