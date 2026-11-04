import { expect, test } from '@playwright/test';

/* Panorama : trois vues qui se recouvrent donnent une seule image de la largeur de la scène. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

test('assemble trois vues en un panorama', async ({ page }) => {
  await page.evaluate(() => {
    // Scène 300×120, découpée en trois vues de 130 px qui se recouvrent de 45 px.
    const scene = document.createElement('canvas');
    scene.width = 300;
    scene.height = 120;
    const g = scene.getContext('2d')!;
    const img = g.createImageData(300, 120);
    for (let y = 0; y < 120; y++)
      for (let x = 0; x < 300; x++) {
        const v =
          128 + 60 * Math.sin(x / 7 + Math.sin(y / 11) * 2) + 50 * Math.cos(y / 5 + x / 13) * Math.sin(x / 3);
        img.data.set([v, v * 0.8, 255 - v, 255], (y * 300 + x) * 4);
      }
    g.putImageData(img, 0, 0);
    const view = (x0: number) => {
      const c = document.createElement('canvas');
      c.width = 130;
      c.height = 120;
      c.getContext('2d')!.drawImage(scene, x0, 0, 130, 120, 0, 0, 130, 120);
      return c.toDataURL('image/png');
    };
    const { photo, editor } = (window as any).poulpe;
    photo.openPhotoDocument(view(0), 'image/png', 130, 120, 'Test');
    editor.apply('test', (d: any) => {
      const first = d.artboards[0].children[0];
      [85, 170].forEach((x0, i) => {
        const id = `view${i}`;
        d.assets[id] = { id, mime: 'image/png', width: 130, height: 120, data: view(x0) };
        d.artboards[0].children.push({
          ...JSON.parse(JSON.stringify(first)),
          id: `n${i}`,
          assetId: id,
          x: first.x + x0,
        });
      });
    });
    editor.select(editor.doc.artboards[0].children.map((n: any) => n.id));
  });
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Assembler un panorama…' }).click();
  await page.getByTestId('panorama-run').click();
  await expect(page.getByTestId('panorama-run')).toHaveCount(0, { timeout: 30_000 });
  const info = await page.evaluate(() => {
    const kids = (window as any).poulpe.editor.doc.artboards[0].children;
    const n = kids[kids.length - 1];
    return { count: kids.length, name: n.name, w: n.width, h: n.height };
  });
  expect(info.count).toBe(4);
  expect(info.name).toBe('Panorama');
  expect(Math.abs(info.w - 300)).toBeLessThan(3);
  expect(Math.abs(info.h - 120)).toBeLessThan(3);
});

test('la commande demande au moins deux images', async ({ page }) => {
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Assembler un panorama…' })).toBeDisabled();
});
