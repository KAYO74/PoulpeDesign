import { expect, test } from '@playwright/test';

/* Épreuve CMJN à l'écran : budget de temps sur 3 Mpx avec le moteur Rust, même résultat que le TS. */
test('épreuve CMJN : 3 Mpx en moins de 1,5 s, plus vite que le TypeScript et pareil', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(await page.evaluate(() => (window as any).poulpe.engine.start())).toBe(true);
  const r = await page.evaluate(() => {
    const { softProofPixels, softProofPixelsTs } = (window as any).poulpe.core;
    const n = 2000 * 1500 * 4;
    // Couleurs variées (peu de répétitions) : le pire cas pour le cache.
    const src = new Uint8ClampedArray(n).map((_, i) => (Math.imul(i, 2654435761) >>> 24) ^ (i >> 10));
    // Tables construites, mémoire du moteur réservée et code chauffé, hors mesure (une fois par session).
    softProofPixels(new Uint8ClampedArray(src));
    softProofPixelsTs(new Uint8ClampedArray(4096).fill(200));
    const a = new Uint8ClampedArray(src),
      b = new Uint8ClampedArray(src);
    let t = performance.now();
    softProofPixels(a);
    const ms = performance.now() - t;
    t = performance.now();
    softProofPixelsTs(b);
    const tsMs = performance.now() - t;
    let same = true;
    for (let i = 0; i < n && same; i++) same = Math.abs(a[i] - b[i]) <= 1;
    return { ms, tsMs, same };
  });
  console.log(`épreuve CMJN 3 Mpx : Rust ${Math.round(r.ms)} ms, TypeScript ${Math.round(r.tsMs)} ms`);
  expect(r.same).toBe(true);
  expect(r.ms).toBeLessThan(1500);
  expect(r.ms).toBeLessThan(r.tsMs);
});
