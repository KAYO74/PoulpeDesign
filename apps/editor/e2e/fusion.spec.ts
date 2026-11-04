import { expect, test } from '@playwright/test';
import { choose } from './choose';

/* Fusion d'expositions : deux photos du même cadre (sombre, claire) donnent une image entre les deux. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('poulpe.settings'))
      localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false }));
  });
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
});

async function twoShots(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const shot = (v: number) => {
      const c = document.createElement('canvas');
      c.width = 120;
      c.height = 90;
      const g = c.getContext('2d')!;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, 0, 120, 90);
      return c.toDataURL('image/png');
    };
    const { photo, editor } = (window as any).poulpe;
    photo.openPhotoDocument(shot(30), 'image/png', 120, 90, 'Test');
    editor.apply('test', (d: any) => {
      const first = d.artboards[0].children[0];
      d.assets.light = { id: 'light', mime: 'image/png', width: 120, height: 90, data: shot(200) };
      d.artboards[0].children.push({
        ...JSON.parse(JSON.stringify(first)),
        id: 'light-layer',
        assetId: 'light',
      });
    });
    editor.select(d0(editor));
    function d0(e: any) {
      return e.doc.artboards[0].children.map((n: any) => n.id);
    }
  });
}

test('fusionne deux expositions en une image au-dessus', async ({ page }) => {
  await twoShots(page);
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Fusionner des expositions…' }).click();
  await choose(page.getByTestId('fusion-mode'), 'exposure');
  await page.getByTestId('fusion-run').click();
  await expect(page.getByTestId('fusion-run')).toHaveCount(0, { timeout: 30_000 });
  const info = await page.evaluate(async () => {
    const { editor, controller } = (window as any).poulpe;
    const kids = editor.doc.artboards[0].children;
    const n = kids[kids.length - 1];
    const imgs = controller().images;
    await imgs.ready?.(editor.doc);
    const img = imgs.get(editor.doc, n.assetId);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return { count: kids.length, name: n.name, v: g.getImageData(60, 45, 1, 1).data[0] };
  });
  expect(info.count).toBe(3);
  expect(info.name).toBe('Fusion HDR');
  expect(info.v).toBeGreaterThan(30);
  expect(info.v).toBeLessThan(200);
});

test('la commande demande au moins deux images', async ({ page }) => {
  await page.getByRole('button', { name: 'Calque', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Fusionner des expositions…' })).toBeDisabled();
});
