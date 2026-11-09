import { expect, test, type Page } from '@playwright/test';

/* Mise à l'échelle d'après le contenu : le calque change de taille, l'objet détaillé reste. */

type AnyNode = Record<string, any>;
const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);

async function openTestPhoto(page: Page) {
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d')!;
    // Fond texturé léger, et un carré rouge net à gauche.
    for (let y = 0; y < 300; y += 4)
      for (let x = 0; x < 400; x += 4) {
        g.fillStyle = `rgb(60,100,${170 + ((x * 7 + y * 3) % 30)})`;
        g.fillRect(x, y, 4, 4);
      }
    g.fillStyle = '#dd2222';
    g.fillRect(60, 100, 60, 60);
    (window as any).poulpe.photo.openPhotoDocument(c.toDataURL('image/png'), 'image/png', 400, 300, 'Test');
  });
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('persona-photo').click();
  await openTestPhoto(page);
});

test("réduit la largeur d'un calque selon son contenu, en un seul pas d'historique", async ({ page }) => {
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
  const before = (await nodes(page))[0];
  await page.getByRole('button', { name: 'Édition' }).click();
  await page.getByRole('menuitem', { name: "Mise à l'échelle d'après le contenu…" }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('contentscale-protect')).toBeDisabled();
  await page.getByTestId('contentscale-width').fill('70');
  await page.getByTestId('contentscale-apply').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 60_000 });

  const after = (await nodes(page))[0];
  expect(after.width).toBeCloseTo(before.width * 0.7, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
  expect(after.assetId).not.toBe(before.assetId);
  const asset = await page.evaluate(
    (id) => (window as any).poulpe.editor.doc.assets[id],
    after.assetId as string,
  );
  expect([asset.width, asset.height]).toEqual([280, 300]);
  // Le carré rouge net a gardé (presque) toute sa taille : 60 × 60 pixels.
  const red = await page.evaluate(async () => {
    const { editor, controller } = (window as any).poulpe;
    const n = editor.doc.artboards[0].children[0];
    const imgs = controller().images;
    await imgs.ready?.(editor.doc);
    const img = imgs.get(editor.doc, n.assetId);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let k = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 2] < 90) k++;
    return k;
  });
  expect(red).toBeGreaterThan(3300);
  const hist = await page.evaluate(() => (window as any).poulpe.editor.getState().history);
  expect(hist.filter((h: string) => h === 'history.contentScale')).toHaveLength(1);
});

test('une grande photo garde sa pleine résolution', async ({ page }) => {
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 3000;
    c.height = 2000;
    const g = c.getContext('2d')!;
    const img = g.createImageData(3000, 2000);
    for (let i = 0; i < 3000 * 2000; i++) {
      const v = 120 + ((i * 7919) % 40);
      img.data.set([60, 100, v + 60, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = '#dd2222';
    g.fillRect(400, 700, 300, 300);
    (window as any).poulpe.photo.openPhotoDocument(
      c.toDataURL('image/png'),
      'image/png',
      3000,
      2000,
      'Grande',
    );
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
  await page.getByRole('button', { name: 'Édition' }).click();
  await page.getByRole('menuitem', { name: "Mise à l'échelle d'après le contenu…" }).click();
  await page.getByTestId('contentscale-width').fill('80');
  await page.getByTestId('contentscale-apply').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 90_000 });
  const n = (await nodes(page))[0];
  const asset = await page.evaluate(
    (id) => (window as any).poulpe.editor.doc.assets[id],
    n.assetId as string,
  );
  expect([asset.width, asset.height]).toEqual([2400, 2000]);
});
