import { expect, test, type Page } from '@playwright/test';

/* Onglet Développer : réglages à la Lightroom dans un seul calque de réglage. */

type AnyNode = Record<string, any>;
const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);

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

/** Capture d'un coin de la photo (bleu uni). */
async function shot(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const p = await page.evaluate(() => (window as any).poulpe.controller().toScreen({ x: 40, y: 40 }));
  return page.screenshot({ clip: { x: box.x + p.x, y: box.y + p.y, width: 20, height: 20 } });
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

test('un curseur crée un calque Développer, puis le modifie', async ({ page }) => {
  await page.getByTestId('tab-develop').click();
  await expect(page.getByTestId('develop-panel')).toBeVisible();
  const before = await shot(page);
  expect(await nodes(page)).toHaveLength(1);

  await page.getByTestId('develop-presence').getByLabel('Saturation').fill('-100');
  let list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list[1].type).toBe('adjustment');
  expect(list[1].adjustment.kind).toBe('develop');
  expect(list[1].adjustment.saturation).toBe(-100);

  // Un deuxième curseur modifie le même calque.
  await page.getByTestId('develop-whiteBalance').getByLabel('Température').fill('40');
  list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list[1].adjustment.temperature).toBe(40);
  expect(list[1].adjustment.saturation).toBe(-100);

  await page.waitForTimeout(500);
  expect((await shot(page)).equals(before)).toBe(false);
});

test('une plage de couleur ne touche que sa teinte', async ({ page }) => {
  await page.getByTestId('tab-develop').click();
  await page.getByTestId('develop-band-blue').click();
  await page.getByTestId('develop-color').getByLabel('Saturation').fill('-100');
  const list = await nodes(page);
  const adj = list[1].adjustment;
  expect(adj.sat).toEqual([0, 0, 0, 0, 0, -100, 0, 0]);
  expect(adj.hue).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test('remettre à zéro, et le menu Réglage ajoute aussi Développer', async ({ page }) => {
  await page.getByTestId('tab-develop').click();
  await page.getByTestId('develop-presence').getByLabel('Vibrance').fill('50');
  await page.getByTestId('develop-reset').click();
  expect((await nodes(page))[1].adjustment.vibrance).toBe(0);
  await page.getByRole('toolbar').getByTestId('add-adjustment').click();
  await page.getByTestId('adjustment-develop').click();
  expect(await nodes(page)).toHaveLength(3);
  expect((await nodes(page))[2].adjustment.kind).toBe('develop');
});
