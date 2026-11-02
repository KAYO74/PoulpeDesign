import { expect, test } from '@playwright/test';

test('Calque > Plusieurs calques de pixels en crée plusieurs d’un coup', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const count = () => page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children.length);
  const before = await count();
  await page.getByRole('navigation', { name: 'Menu' }).getByText('Calque', { exact: true }).click();
  await page.getByRole('menuitem', { name: /Plusieurs calques de pixels/ }).click();
  await page.getByTestId('layers-count').fill('4');
  await page.getByTestId('layers-count').press('Enter');
  await page.getByTestId('layers-go').click();
  await expect.poll(count).toBe(before + 4);
});
