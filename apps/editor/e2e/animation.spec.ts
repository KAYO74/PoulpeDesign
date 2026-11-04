import { expect, test } from '@playwright/test';
import { choose } from './choose';

/* Animation simple : entrée par objet, aperçu en boucle, export GIF. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('anime un objet et exporte le plan de travail en GIF', async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 400, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Animation…' }).click();
  await expect(page.getByTestId('anim-export')).toBeDisabled();
  await choose(page.getByTestId('anim-kind'), 'pop');
  const duration = page.getByTestId('anim-duration');
  await duration.fill('0.4');
  await duration.press('Enter');
  const anim = () =>
    page.evaluate(() => (window as any).poulpe.editor.getState().doc.artboards[0].children[0].animation);
  await expect.poll(anim).toEqual({ kind: 'pop', delay: 0, duration: 0.4 });
  // L'aperçu tourne.
  await expect.poll(() => page.getByTestId('anim-preview').getAttribute('data-time')).not.toBe(null);
  // Export : le GIF est téléchargé (navigateur sans sélecteur de fichier).
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  const download = page.waitForEvent('download');
  await page.getByTestId('anim-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.gif$/);
  const bytes = await (await import('fs')).promises.readFile((await file.path())!);
  expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
  // Une seule étape d'historique par réglage ; « Aucune » retire l'animation.
  await choose(page.getByTestId('anim-kind'), 'none');
  await expect.poll(anim).toBeUndefined();
});

test("l'export GIF montre son avancement et s'annule", async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('u');
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 400, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Animation…' }).click();
  await choose(page.getByTestId('anim-kind'), 'fade');
  const duration = page.getByTestId('anim-duration');
  await duration.fill('45');
  await duration.press('Enter');
  // Au-delà de 30 s, le GIF est coupé : la fenêtre le dit.
  await expect(page.getByText('Le GIF s’arrête à 30 s')).toBeVisible();
  await choose(page.getByTestId('anim-size'), '1080');
  await page.getByTestId('anim-export').click();
  await expect(page.getByTestId('anim-progress')).toBeVisible();
  await page.getByTestId('anim-cancel').click();
  await expect(page.getByTestId('anim-status')).toHaveText('Export annulé.');
  await expect(page.getByTestId('anim-export')).toBeEnabled();
});
