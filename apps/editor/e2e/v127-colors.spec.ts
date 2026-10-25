import { expect, test, type Page } from '@playwright/test';

/* Version 1.2.7 : sélecteur de couleur à roue, « aucune couleur », œil des calques, taille du pinceau. */

const ui = (page: Page) => page.evaluate(() => (window as any).poulpe.ui.get());

async function rect(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 380, { steps: 4 });
  await page.mouse.up();
}

const fill = (page: Page) =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].fill);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('double-clic sur le remplissage ouvre la roue, qui colore la forme', async ({ page }) => {
  await rect(page);
  await page.getByTestId('tool-fill').dblclick();
  const win = page.getByTestId('float-color-picker');
  await expect(win).toBeVisible();
  const ring = (await win.getByTestId('color-wheel').boundingBox())!;
  // En bas de la roue : teinte cyan (180°).
  await page.mouse.click(ring.x + ring.width / 2, ring.y + ring.height - 4);
  await win.getByRole('slider', { name: 'Saturation' }).click({ position: { x: 60, y: 2 } });
  const f = await fill(page);
  expect(f.type).toBe('solid');
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(f.color.slice(i, i + 2), 16));
  expect(g).toBeGreaterThan(r + 60);
  expect(Math.abs(g - b)).toBeLessThan(40);

  await win.getByTestId('color-window-none').click();
  expect((await fill(page)).type).toBe('none');
  await page.keyboard.press('Control+z');
  expect((await fill(page)).type).toBe('solid');
  await win.getByTestId('color-window-close').click();
  await expect(win).toBeHidden();
});

test('le sélecteur s’ouvre depuis le contour de la colonne d’outils', async ({ page }) => {
  await rect(page);
  await page.getByTestId('tool-stroke').dblclick();
  await expect(page.getByTestId('float-color-picker')).toBeVisible();
  expect((await ui(page)).colorTarget).toBe('stroke');
  await page.getByTestId('color-window-close').click();
  await page.getByTestId('tool-none').click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].stroke.paint))
          .type,
    )
    .toBe('none');
  await page.getByTestId('tool-fill').click();
  await page.getByTestId('tool-none').click();
  expect((await fill(page)).type).toBe('none');
});

test('l’œil des calques reste visible sans survol', async ({ page }) => {
  await rect(page);
  await page.getByTestId('studio').getByTestId('tab-layers').click();
  const id = await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].id);
  await page.mouse.move(5, 5);
  await expect(page.getByTestId(`layer-eye-${id}`)).toHaveCSS('opacity', '1');
  await page.getByTestId(`layer-eye-${id}`).click();
  expect(await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].visible)).toBe(
    false,
  );
});

test('Alt + clic droit glissé change la taille du pinceau', async ({ page }) => {
  await page.getByTestId('persona-photo').click();
  await page.getByTestId('tool-brush').click();
  const before = (await ui(page)).brushes.brush?.size ?? 24;
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.keyboard.down('Alt');
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + 400, box.y + 300, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Alt');
  expect((await ui(page)).brushes.brush.size).toBe(before + 100);
  await expect(page.getByTestId('canvas-menu')).toHaveCount(0);
});
