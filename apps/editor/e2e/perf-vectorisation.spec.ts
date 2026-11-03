import { expect, test } from '@playwright/test';

/* Vectorisation : budget de temps sur 3 Mpx (étiquetage par le moteur Rust), même résultat que le TS. */
test('vectorisation : 3 Mpx en moins de 6 s, plus vite que le TypeScript et pareil', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  const r = await page.evaluate(async () => {
    const { traceAsync } = (window as any).poulpe.core;
    const w = 2000,
      h = 1500;
    const data = new Uint8ClampedArray(w * h * 4).map((_, i) =>
      i % 4 === 3 ? 255 : (((i >> 2) % w) / 9 + (i >> 2) / w / 7 + (i % 4) * 30) % 256,
    );
    const px = { data, width: w, height: h };
    const options = {
      mode: 'color',
      colors: 16,
      noise: 8,
      tolerance: 1,
      cornerAngle: 60,
      ignoreWhite: false,
    };
    // Premiers appels : chargent le worker et le moteur et chauffent le code, hors mesure.
    await traceAsync(px, options);
    await traceAsync(px, options, undefined, true);
    let t = performance.now();
    const rs = await traceAsync(px, options);
    const ms = performance.now() - t;
    t = performance.now();
    const ts = await traceAsync(px, options, undefined, true);
    const tsMs = performance.now() - t;
    return { ms, tsMs, same: JSON.stringify(rs) === JSON.stringify(ts) };
  });
  console.log(`vectorisation 3 Mpx : Rust ${Math.round(r.ms)} ms, TypeScript ${Math.round(r.tsMs)} ms`);
  expect(r.same).toBe(true);
  expect(r.ms).toBeLessThan(6000);
  expect(r.ms).toBeLessThan(r.tsMs);
});
