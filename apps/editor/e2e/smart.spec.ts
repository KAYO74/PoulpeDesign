import { expect, test, type Page } from '@playwright/test';
import { choose } from './choose';

/* v1.0 : vectorisation d'image et détourage automatique (modèle d'IA local). */

type AnyNode = Record<string, any>;

const nodes = (page: Page): Promise<AnyNode[]> =>
  page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children);

/** Photo de test 400×300 : fond gris en dégradé, un disque rouge au centre ; l'image est sélectionnée. */
async function openTestPhoto(page: Page) {
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 400, 300);
    grad.addColorStop(0, '#d8d8d8');
    grad.addColorStop(1, '#b0b0b0');
    g.fillStyle = grad;
    g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#d02020';
    g.beginPath();
    g.arc(200, 150, 80, 0, Math.PI * 2);
    g.fill();
    (window as any).poulpe.photo.openPhotoDocument(c.toDataURL('image/png'), 'image/png', 400, 300, 'Test');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const { editor } = (window as any).poulpe;
    editor.select([editor.doc.artboards[0].children[0].id]);
  });
}

async function menu(page: Page, top: string, item: string) {
  await page.getByRole('navigation', { name: 'Menu' }).getByText(top, { exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('vectorise une image en tracés de couleur', async ({ page }) => {
  await openTestPhoto(page);
  await menu(page, 'Calque', 'Vectoriser l’image…');
  await choose(page.getByTestId('trace-preset'), 'logo');
  await expect(page.getByTestId('trace-preview')).toBeVisible();
  await expect(page.getByTestId('trace-apply')).toBeEnabled();
  await page.getByTestId('trace-apply').click();
  const list = await nodes(page);
  expect(list).toHaveLength(2);
  expect(list[0].visible).toBe(false);
  const group = list[1];
  expect(group.type).toBe('group');
  expect(group.children.length).toBeGreaterThanOrEqual(2);
  for (const p of group.children) {
    expect(p.type).toBe('path');
    expect(p.fillRule).toBe('evenodd');
  }
  // La couleur rouge du disque fait partie des couleurs trouvées.
  const isRed = (c: string) => parseInt(c.slice(1, 3), 16) - parseInt(c.slice(3, 5), 16) > 80;
  expect(group.children.some((p: AnyNode) => isRed(p.fill.color))).toBe(true);
  // Annuler retire la vectorisation d'un coup.
  await page.keyboard.press('Control+z');
  expect(await nodes(page)).toHaveLength(1);
});

test('vectorise en noir et blanc : un seul tracé qui suit le disque', async ({ page }) => {
  await openTestPhoto(page);
  await menu(page, 'Calque', 'Vectoriser l’image…');
  await choose(page.getByTestId('trace-preset'), 'blackWhite');
  await expect(page.getByTestId('trace-apply')).toBeEnabled();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('trace-apply')).toBeEnabled();
  await page.getByTestId('trace-apply').click();
  const group = (await nodes(page))[1];
  expect(group.children).toHaveLength(1);
  const disc = group.children[0];
  expect(disc.fill.color).toBe('#000000');
  expect(Math.abs(disc.width - 160)).toBeLessThan(4);
  expect(Math.abs(disc.height - 160)).toBeLessThan(4);
  expect(Math.abs(disc.x + disc.width / 2 - 200)).toBeLessThan(2);
  // Un cercle lisse : quelques courbes, pas un escalier de pixels.
  expect(disc.d.split('C').length - 1).toBeGreaterThanOrEqual(4);
  expect(disc.d.length).toBeLessThan(1200);
});

test('supprime l’arrière-plan avec un masque de calque', async ({ page }) => {
  test.setTimeout(90_000);
  await openTestPhoto(page);
  await menu(page, 'Calque', 'Supprimer l’arrière-plan');
  await expect.poll(async () => !!(await nodes(page))[0]?.mask, { timeout: 60_000 }).toBe(true);
  const alpha = await page.evaluate(async () => {
    const { editor, controller } = (window as any).poulpe;
    const n = editor.doc.artboards[0].children[0];
    const imgs = controller().images;
    await imgs.ready?.(editor.doc);
    const m = imgs.get(editor.doc, n.mask.assetId);
    const c = document.createElement('canvas');
    c.width = m.width;
    c.height = m.height;
    const g = c.getContext('2d')!;
    g.drawImage(m, 0, 0);
    const at = (x: number, y: number) =>
      g.getImageData(Math.round(x * m.width), Math.round(y * m.height), 1, 1).data[3];
    return { center: at(0.5, 0.5), corner: at(0.05, 0.05), edge: at(0.5, 0.95) };
  });
  expect(alpha.center).toBeGreaterThan(200);
  expect(alpha.corner).toBeLessThan(40);
  expect(alpha.edge).toBeLessThan(40);
});

test('sélectionne le sujet', async ({ page }) => {
  test.setTimeout(90_000);
  await page.getByTestId('persona-photo').click();
  await openTestPhoto(page);
  await menu(page, 'Sélection', 'Sélectionner le sujet');
  await expect
    .poll(() => page.evaluate(() => (window as any).poulpe.ui.get().hasPixelSelection), { timeout: 60_000 })
    .toBe(true);
});
