import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('remplit une forme de hachures et les règle', async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 450, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId('color-paint-type').selectOption('hatch');
  await page.getByTestId('hatch-style').selectOption('cross');
  const spacing = page.getByTestId('hatch-spacing');
  await spacing.fill('20');
  await spacing.press('Enter');
  const fill = () =>
    page.evaluate(
      () =>
        (window as unknown as { poulpe: { editor: { getState: () => any } } }).poulpe.editor.getState().doc
          .artboards[0].children[0].fill,
    );
  await expect.poll(fill).toMatchObject({ type: 'hatch', style: 'cross', spacing: 20 });
  await page.getByTestId('canvas').screenshot({ path: test.info().outputPath('hachures.png') });
});
