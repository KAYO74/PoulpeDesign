import { expect, test, type Page } from '@playwright/test';
import { choose } from './choose';

/* Panneau Couleur : carré, roue ou triangle ; couleurs de la barre du haut dans une petite fenêtre. */

async function rect(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 380, { steps: 4 });
  await page.mouse.up();
}

const fill = (page: Page) =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].fill.color as string);
const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('la barre du haut ouvre Échantillons, Couleur et Dégradé, comme dans Affinity', async ({ page }) => {
  await rect(page);
  await page.getByTestId('ctx-fill').click();
  const pop = page.getByTestId('color-pop');
  await expect(pop).toBeVisible();

  // Échantillons : une couleur de la gamme devient le remplissage.
  await pop.getByTestId('cpop-swatches').click();
  await pop.getByTestId('cpop-palette').locator('.swatch').last().click();
  expect(await fill(page)).toBe('#000000');

  // Dégradé : linéaire, puis inversé.
  await pop.getByTestId('cpop-gradient').click();
  await pop.getByTestId('cpop-kind-linear').click();
  const paint = () => page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].fill);
  expect((await paint()).type).toBe('linear');
  const before = (await paint()).stops.map((s: { offset: number }) => s.offset);
  await pop.getByTestId('cpop-reverse').click();
  expect((await paint()).stops.map((s: { offset: number }) => s.offset)).toEqual(
    before.map((o: number) => 1 - o),
  );

  // Aucune couleur sur le contour.
  await page.keyboard.press('Escape');
  await page.getByTestId('ctx-stroke').click();
  await page.getByTestId('color-pop').getByTestId('ctx-none').click();
  expect(
    await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].stroke.paint.type),
  ).toBe('none');
});

test('le panneau Couleur passe en roue puis en triangle, et le choix reste', async ({ page }) => {
  await rect(page);
  const panel = page.getByTestId('studio');
  await panel.getByTestId('tab-color').click();
  await choose(panel.getByTestId('color-shape'), 'wheel');
  const wheel = panel.getByTestId('color-wheel');
  await expect(wheel).toBeVisible();

  await choose(panel.getByTestId('color-shape'), 'triangle');
  await expect(panel.getByTestId('color-triangle')).toBeVisible();
  const ring = (await wheel.boundingBox())!;
  // Bas de la roue : teinte cyan (180°) ; le triangle tourne, son sommet coloré passe en bas.
  await page.mouse.click(ring.x + ring.width / 2, ring.y + ring.height - 4);
  await page.mouse.click(ring.x + ring.width / 2, ring.y + ring.height / 2 + ring.height * 0.27);
  const [r, g, b] = rgb(await fill(page));
  expect(g).toBeGreaterThan(r + 120);
  expect(Math.abs(g - b)).toBeLessThan(40);

  // Sommet blanc (en haut à droite une fois tourné de 180°) : blanc.
  const a = Math.PI; // rotation de la teinte
  const [wx, wy] = [-Math.sqrt(3) / 2, 0.5];
  const x = wx * Math.cos(a) - wy * Math.sin(a);
  const y = wx * Math.sin(a) + wy * Math.cos(a);
  await page.mouse.click(ring.x + ring.width * (0.5 + 0.27 * x), ring.y + ring.height * (0.5 + 0.27 * y));
  expect(Math.min(...rgb(await fill(page)))).toBeGreaterThan(220);

  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().settings.colorShape)).toBe('triangle');
});

test('la couleur barrée retire le remplissage', async ({ page }) => {
  await rect(page);
  const panel = page.getByTestId('studio');
  await panel.getByTestId('tab-color').click();
  await panel.getByTestId('swatch-none').click();
  expect(
    await page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].fill.type),
  ).toBe('none');
});
