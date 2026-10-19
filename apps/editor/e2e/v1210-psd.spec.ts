import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readPsd } from 'ag-psd';

/*
 * Version 1.2.10 : enregistrer le projet en PSD. Le fichier a des calques (Photoshop, Affinity) et
 * Poulpe Design le rouvre avec ses objets vectoriels.
 */

const kids = (page: Page): Promise<{ type: string; name: string }[]> =>
  page.evaluate(() =>
    (window as any).poulpe.editor.doc.artboards[0].children.map((n: any) => ({ type: n.type, name: n.name })),
  );

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
    delete (window as any).showSaveFilePicker;
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('Fichier › Enregistrer en PSD donne un PSD à calques que Poulpe rouvre tel quel', async ({ page }) => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  for (const [x, key] of [
    [300, 'u'],
    [500, 'm'],
  ] as const) {
    await page.keyboard.press(key);
    await page.mouse.move(box.x + x, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + x + 80, box.y + 380, { steps: 4 });
    await page.mouse.up();
  }
  const before = await kids(page);
  expect(before).toHaveLength(2);
  expect(before.every((k) => k.type !== 'image')).toBe(true);

  await page.getByRole('button', { name: 'Fichier' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Enregistrer en PSD (Photoshop, Affinity)…' }).click();
  const dl = await download;
  expect(dl.suggestedFilename()).toMatch(/\.psd$/);
  const bytes = readFileSync((await dl.path())!);

  // Un vrai PSD : un calque par objet (en plus du fond).
  const psd = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  expect(psd.children!.map((l) => l.name)).toEqual(['Fond', ...before.map((k) => k.name)]);

  // Rouvert dans Poulpe Design : les objets restent des formes, pas des images.
  await page.evaluate(() =>
    (window as any).poulpe.editor.load({ ...(window as any).poulpe.editor.doc, artboards: [] }),
  );
  page.once('dialog', (d) => void d.accept());
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (
    await chooser
  ).setFiles({ name: 'Projet.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: bytes });
  await expect.poll(() => kids(page)).toEqual(before);
  expect(await page.evaluate(() => (window as any).poulpe.ui.get().filePath)).toBe('Projet.psd');
});
