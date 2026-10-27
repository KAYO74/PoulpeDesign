import { expect, test, type Page } from '@playwright/test';
import { choose } from './choose';

/* Déformation du texte (arc, vague) : le texte suit une courbe calculée d'après sa largeur. */

const texts = (page: Page): Promise<Record<string, any>[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);

test('déforme un texte en arc, règle la courbure, le remet droit', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.type('Bonjour le monde');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-warp')).toBeVisible();

  await choose(page.getByTestId('text-warp'), 'arc');
  let [n] = await texts(page);
  expect(n.path.warp).toEqual({ kind: 'arc', bend: 0.5 });
  expect(n.path.d.startsWith('M0')).toBe(true);
  const arcHeight = n.height;
  expect(arcHeight).toBeGreaterThan(n.width * 0.2);

  // Plus de courbure : le texte se creuse davantage.
  await page.getByTestId('text-warp-bend').fill('100');
  await page.getByTestId('text-warp-bend').dispatchEvent('keyup');
  [n] = await texts(page);
  expect(n.path.warp.bend).toBe(1);
  expect(n.height).toBeGreaterThan(arcHeight);

  // Vague, puis retour au texte droit.
  await choose(page.getByTestId('text-warp'), 'wave');
  [n] = await texts(page);
  expect(n.path.warp.kind).toBe('wave');
  await choose(page.getByTestId('text-warp'), '');
  [n] = await texts(page);
  expect(n.path).toBeUndefined();
  expect(n.text).toBe('Bonjour le monde');

  // Annuler ramène la vague.
  await page.keyboard.press('Control+z');
  [n] = await texts(page);
  expect(n.path?.warp.kind).toBe('wave');
});
