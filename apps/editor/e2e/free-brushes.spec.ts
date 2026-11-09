import { expect, test, type Page } from '@playwright/test';

/* Pinceaux libres (MyPaint, CC0) : installés en un clic depuis le panneau Pinceau, retirés comme un paquet. */

const presets = (page: Page): Promise<{ name: string; tip?: string; flow: number }[]> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('poulpe.brushPresets') ?? '[]'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('installe les pinceaux libres, les applique, puis les retire', async ({ page }) => {
  await page.getByTestId('persona-photo').click();
  await page.keyboard.press('b');
  await page.getByTestId('studio').getByTestId('tab-brush').click();
  await page.getByTestId('brushes-free').click();
  await expect(page.getByTestId('brushes-free')).toBeDisabled();
  const list = await presets(page);
  expect(list.length).toBeGreaterThan(80);
  expect(list.some((p) => p.name.startsWith('David Revoy ·'))).toBe(true);
  expect(list.some((p) => p.name.startsWith('Ramón Miranda ·'))).toBe(true);
  // Les formes (grain, craie…) sont installées avec les pinceaux qui s'en servent.
  const tips = await page.evaluate(() => JSON.parse(localStorage.getItem('poulpe.brushTips') ?? '[]').length);
  expect(tips).toBeGreaterThanOrEqual(5);
  expect(list.some((p) => p.tip)).toBe(true);

  // Un pinceau libre s'applique à l'outil.
  const charcoal = list.find((p) => p.name === 'MyPaint · Charcoal')!;
  await page
    .getByRole('option', { name: /MyPaint · Charcoal/ })
    .getByRole('button')
    .first()
    .click();
  const brush = await page.evaluate(() => (window as any).poulpe.ui.get().brushes.brush);
  expect(brush.flow).toBe(charcoal.flow);
  expect(brush.tip).toMatch(/^tip-/);

  // Rechargé : toujours là, et le bouton le sait.
  await page.reload();
  await page.getByTestId('persona-photo').click();
  await page.keyboard.press('b');
  await page.getByTestId('studio').getByTestId('tab-brush').click();
  await expect(page.getByTestId('brushes-free')).toBeDisabled();
});
