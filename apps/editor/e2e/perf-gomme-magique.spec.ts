import { expect, test } from '@playwright/test';

/*
 * Gomme magique (remplissage d'après le contenu) : budget de temps sur 3 Mpx avec le moteur
 * Rust, et même résultat que la version TypeScript (1 niveau de couleur au plus).
 */
test('gomme magique : trou de 200×200 sur 3 Mpx en moins de 4 s, comme le TypeScript', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const r = await page.evaluate(async () => {
    const { inpaintAsync } = (window as any).poulpe.core;
    const w = 2000,
      h = 1500;
    const mk = () =>
      new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : ((i * 7) ^ (i >> 9)) % 256));
    const mask = () => {
      const m = new Uint8Array(w * h);
      for (let y = 600; y < 800; y++) for (let x = 900; x < 1100; x++) m[y * w + x] = 1;
      return m;
    };
    // Premier appel : charge le worker et le moteur, hors budget.
    await inpaintAsync(new Uint8ClampedArray(64 * 64 * 4), 64, 64, new Uint8Array(64 * 64).fill(1, 0, 100));
    const [a, b] = [mk(), mk()];
    const t = performance.now();
    const rs = await inpaintAsync(a, w, h, mask(), undefined, 7);
    const ms = performance.now() - t;
    const t2 = performance.now();
    const ts = await inpaintAsync(b, w, h, mask(), undefined, 7, true);
    const tsMs = performance.now() - t2;
    let maxDiff = 0;
    for (let i = 0; i < rs.length; i++) maxDiff = Math.max(maxDiff, Math.abs(rs[i] - ts[i]));
    return { ms, tsMs, maxDiff };
  });
  console.log(`gomme magique 3 Mpx : Rust ${Math.round(r.ms)} ms, TypeScript ${Math.round(r.tsMs)} ms`);
  expect(r.maxDiff).toBeLessThanOrEqual(1);
  expect(r.ms).toBeLessThan(4000);
});
