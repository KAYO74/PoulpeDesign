import { expect, test } from '@playwright/test';

/*
 * Budgets de vitesse sur de gros fichiers : les marges sont larges (machines de CI lentes), le test
 * sert à repérer un ralentissement net, pas à mesurer finement.
 */

test.setTimeout(120_000);

test('gros document et photo de 100 Mpx restent fluides', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false })),
  );
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const r = await page.evaluate(async () => {
    const p = (window as any).poulpe;
    p.perf.setPerformanceSettings({ parallelDrawing: false, cacheMb: 0 });
    const avgDraw = () => {
      const c = p.controller();
      c.draw();
      const t = performance.now();
      for (let i = 0; i < 5; i++) {
        c.invalidate();
        c.draw();
      }
      return (performance.now() - t) / 5;
    };
    await p.loadBenchDocument(2000);
    p.controller().zoomToFit();
    const draw2000 = avgDraw();
    const cv = new OffscreenCanvas(10000, 10000);
    const g = cv.getContext('2d')!;
    g.fillStyle = '#c48';
    g.fillRect(0, 0, 10000, 10000);
    const bytes = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
    const t = performance.now();
    await p.photo.openPhotoBytes(bytes, 'image/png', 'grande.png');
    const open100Mpx = performance.now() - t;
    p.controller().zoomToFit();
    return { draw2000, open100Mpx, draw100Mpx: avgDraw() };
  });
  expect(r.draw2000).toBeLessThan(1000);
  expect(r.open100Mpx).toBeLessThan(10_000);
  expect(r.draw100Mpx).toBeLessThan(1000);
});
