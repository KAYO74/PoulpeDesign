import { expect, test } from '@playwright/test';

/* Instantanés : l'état du document gardé sous un nom, pour y revenir après d'autres étapes. */

test('revient à un instantané après avoir ajouté des formes, puis annule ce retour', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const count = () => page.evaluate(() => (window as any).poulpe.editor.doc.artboards[0].children.length);
  const drawRect = async (x: number) => {
    await page.keyboard.press('u');
    await page.mouse.move(box.x + x, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + x + 60, box.y + 360, { steps: 3 });
    await page.mouse.up();
  };

  await drawRect(300);
  await page.getByTestId('tab-history').click();
  await page.getByTestId('snapshot-add').click();
  const snap = page.getByRole('list', { name: 'Instantanés' }).getByRole('button', { name: 'Instantané 1' });
  await expect(snap).toBeVisible();

  await drawRect(400);
  await drawRect(500);
  expect(await count()).toBe(3);

  // Renommer, puis revenir à l'instantané.
  await page.getByRole('button', { name: 'Renommer l’instantané' }).click();
  await page.getByRole('textbox', { name: 'Renommer l’instantané' }).fill('Une forme');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Une forme' }).click();
  expect(await count()).toBe(1);
  await expect(page.getByRole('button', { name: 'Retour à un instantané' })).toBeVisible();

  // Le retour est une étape annulable.
  await page.keyboard.press('Control+z');
  expect(await count()).toBe(3);
});
