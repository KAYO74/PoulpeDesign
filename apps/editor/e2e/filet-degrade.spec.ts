import { expect, test, type Page } from '@playwright/test';
import { choose } from './choose';

/* Filet de dégradé : outil Filet sur le canevas et type « Filet » du panneau Couleur. */

const fill = (page: Page) =>
  page.evaluate(() => (window as any).poulpe.editor.getState().doc.artboards[0].children[0].fill);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test("l'outil Filet pose, colore, déplace et retire un point", async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y];
  await page.keyboard.press('u');
  await page.mouse.move(...at(300, 200));
  await page.mouse.down();
  await page.mouse.move(...at(600, 500), { steps: 8 });
  await page.mouse.up();
  // G, puis G encore : Remplissage, puis Filet.
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect.poll(() => page.evaluate(() => (window as any).poulpe.ui.get().tool)).toBe('mesh');
  await page.mouse.click(...at(400, 300));
  let f = await fill(page);
  expect(f.type).toBe('mesh');
  expect([f.cols, f.rows]).toEqual([2, 2]);
  await expect(page.getByTestId('mesh-size')).toContainText('2 × 2');
  await page.getByTestId('mesh-color').fill('#ff0000');
  f = await fill(page);
  expect(f.colors[4]).toBe('#ff0000');
  // Le point se glisse.
  await page.mouse.move(...at(400, 300));
  await page.mouse.down();
  await page.mouse.move(...at(450, 350), { steps: 6 });
  await page.mouse.up();
  f = await fill(page);
  expect(f.points[4].x).toBeGreaterThan(0.45);
  await page.getByTestId('canvas').screenshot({ path: test.info().outputPath('filet.png') });
  // Suppr retire sa rangée et sa colonne.
  await page.keyboard.press('Delete');
  f = await fill(page);
  expect([f.cols, f.rows]).toEqual([1, 1]);
  await page.getByTestId('mesh-remove').click();
  expect((await fill(page)).type).toBe('solid');
});

test('le panneau Couleur passe un remplissage en filet', async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 450, { steps: 8 });
  await page.mouse.up();
  await choose(page.getByTestId('color-paint-type'), 'mesh');
  const f = await fill(page);
  expect(f.type).toBe('mesh');
  expect(f.colors).toHaveLength(9);
  expect(f.colors[4]).not.toBe(f.colors[0]);
  // Le filet est bien peint : le milieu est plus clair que le coin.
  await page.mouse.move(box.x + 50, box.y + 50);
  const shot = (await page.getByTestId('canvas').screenshot()).toString('base64');
  const [mid, corner] = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const k = img.width / document.querySelector('[data-testid="canvas"]')!.getBoundingClientRect().width;
    const px = (x: number, y: number) => [...g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data];
    return [px(450, 325), px(310, 210)];
  }, shot);
  expect(mid[0] + mid[1] + mid[2]).toBeGreaterThan(corner[0] + corner[1] + corner[2] + 60);
});
