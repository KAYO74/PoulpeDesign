import { expect, test, type Page } from '@playwright/test';

/* Version 1.2.6 : fusionner et grouper depuis le panneau Calques, supprimer un plan de travail. */

const names = (page: Page) =>
  page.evaluate(() =>
    (window as any).poulpe.editor.doc.artboards[0].children.map((n: { name: string }) => n.name),
  );

const types = (page: Page) =>
  page.evaluate(() =>
    (window as any).poulpe.editor.doc.artboards[0].children.map((n: { type: string }) => n.type),
  );

/** Deux rectangles qui se chevauchent, nommés A (dessous) et B. */
async function twoShapes(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 380, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => {
    const ed = (window as any).poulpe.editor;
    ed.apply('test', (d: any) => {
      const base = d.artboards[0].children[0];
      d.artboards[0].children = ['A', 'B'].map((name, i) => ({
        ...JSON.parse(JSON.stringify(base)),
        id: `t${i}`,
        name,
        x: base.x + i * 40,
      }));
    });
    ed.select([]);
  });
  await page.keyboard.press('v');
}

const row = (page: Page, name: string) =>
  page
    .getByTestId('layer-tree')
    .locator('.layer', { has: page.locator('.layer-name', { hasText: new RegExp(`^${name}$`) }) });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('studio').getByTestId('tab-layers').click();
});

test('clic droit › Fusionner › Union réunit deux formes en une courbe', async ({ page }) => {
  await twoShapes(page);
  await row(page, 'A').click();
  await row(page, 'B').click({ modifiers: ['Shift'] });
  await row(page, 'B').click({ button: 'right' });
  await page.getByTestId('layer-menu').getByText('Fusionner', { exact: true }).hover();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Union' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await types(page)).toEqual(['path']);
  await page.keyboard.press('Control+z');
  expect(await names(page)).toEqual(['A', 'B']);
});

test('glisser un calque sur un autre propose de grouper ou de fusionner', async ({ page }) => {
  await twoShapes(page);
  const b = row(page, 'A');
  const bb = (await b.boundingBox())!;
  await row(page, 'B').dragTo(b, { targetPosition: { x: bb.width / 2, y: bb.height / 2 } });
  const menu = page.getByTestId('layer-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Grouper' }).click();
  expect(await types(page)).toEqual(['group']);

  await page.keyboard.press('Control+z');
  await row(page, 'A').click();
  const a = row(page, 'B');
  const ab = (await a.boundingBox())!;
  await row(page, 'A').dragTo(a, { targetPosition: { x: ab.width / 2, y: ab.height / 2 } });
  await page.getByTestId('layer-menu').getByRole('menuitem', { name: 'Fusionner en une image' }).click();
  expect(await types(page)).toEqual(['image']);
  expect(await names(page)).toEqual(['Calques fusionnés']);
});

test('bouton Grouper sous les calques, et clic droit sur un plan de travail pour le supprimer', async ({
  page,
}) => {
  await twoShapes(page);
  await expect(page.getByTestId('layers-group')).toBeDisabled();
  await row(page, 'A').click();
  await row(page, 'B').click({ modifiers: ['Shift'] });
  await page.getByTestId('layers-group').click();
  expect(await types(page)).toEqual(['group']);

  const count = () => page.evaluate(() => (window as any).poulpe.editor.doc.artboards.length);
  const artboards = page.getByTestId('layer-tree').locator('.layer.artboard');
  await artboards.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ajouter un plan de travail' }).click();
  expect(await count()).toBe(2);
  await artboards.last().click({ button: 'right' });
  await page.getByTestId('artboard-delete').click();
  expect(await count()).toBe(1);
});
