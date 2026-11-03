import { expect, test } from '@playwright/test';

/* Budget de temps du correcteur (moteur Rust) sur une image de 3 Mpx. */
test('correcteur : 3 Mpx en moins de 3 s avec le moteur Rust', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(await page.evaluate(() => (window as any).poulpe.engine.start())).toBe(true);
  const ms = await page.evaluate(() => {
    const { healBlend } = (window as any).poulpe.core;
    const w = 2000,
      h = 1500;
    const mk = (k: number) => ({
      data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i * k) % 256),
      width: w,
      height: h,
    });
    const d = mk(7),
      s = mk(13);
    const t = performance.now();
    healBlend(d, s, 8);
    return performance.now() - t;
  });
  console.log(`correcteur 3 Mpx : ${Math.round(ms)} ms`);
  expect(ms).toBeLessThan(3000);
});
