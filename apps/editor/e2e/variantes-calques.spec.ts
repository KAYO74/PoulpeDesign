import { expect, test } from '@playwright/test';

test('Calque > Variantes de calques enregistre et rappelle un état', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 380, { steps: 4 });
  await page.mouse.up();
  const visible = () =>
    page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children[0].visible);
  expect(await visible()).toBe(true);
  await page.evaluate(() => (window as any).poulpe.ui.set({ dialog: 'comps' }));
  await page.getByTestId('comp-name').fill('Avec');
  await page.getByTestId('comp-add').click();
  await expect(page.getByTestId('comp-row')).toHaveCount(1);
  await page.evaluate(() =>
    (window as any).poulpe.editor.apply('history.visibility', (d: any) => {
      d.artboards[0].children[0].visible = false;
    }),
  );
  expect(await visible()).toBe(false);
  await page.getByTestId('comp-apply').click();
  await expect.poll(visible).toBe(true);
});
