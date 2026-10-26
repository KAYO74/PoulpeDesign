import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/* Développement RAW : un DNG ouvert passe par la fenêtre de développement, puis en Persona Photo. */

const DNG = readFileSync(new URL('./fixtures/test.dng', import.meta.url)).toString('base64');

/** Couleur d'un point de l'image du document développé. */
const pixel = (page: Page, x: number, y: number) =>
  page.evaluate(
    async ([x, y]) => {
      const d = (window as any).poulpe.editor.doc;
      const asset = d.assets[d.artboards[0].children[0].assetId];
      const img = new Image();
      img.src = asset.data;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
    },
    [x, y],
  );

test('ouvre un DNG et le développe en Persona Photo', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: true })),
  );
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'photo.dng'));
    const el = document.querySelector('[role="dialog"]')!;
    for (const type of ['dragover', 'drop'])
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, DNG);
  const dialog = page.getByRole('dialog', { name: 'Développement RAW' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('64 × 48 px')).toBeVisible();
  await page.getByTestId('raw-develop').click();
  await expect(dialog).toBeHidden();
  const state = await page.evaluate(() => {
    const p = (window as any).poulpe;
    const ab = p.editor.doc.artboards[0];
    return { persona: p.ui.get().persona, w: ab.width, h: ab.height, name: p.editor.doc.name };
  });
  expect(state).toEqual({ persona: 'photo', w: 64, h: 48, name: 'photo' });
  const [r1, , b1] = await pixel(page, 10, 20);
  const [r2, , b2] = await pixel(page, 50, 20);
  expect(r1).toBeGreaterThan(b1 + 100);
  expect(b2).toBeGreaterThan(r2 + 100);
});

test('un fichier RAW illisible est signalé', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const message = new Promise<string>((resolve) =>
    page.once('dialog', (d) => {
      resolve(d.message());
      void d.dismiss();
    }),
  );
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'abime.nef'));
    const el = document.querySelector('[data-testid="canvas"]')!;
    for (const type of ['dragover', 'drop'])
      el.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 600,
          clientY: 400,
          dataTransfer: dt,
        }),
      );
  });
  expect(await message).toContain('RAW n’est pas reconnu');
});
