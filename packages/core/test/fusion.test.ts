import { describe, expect, it } from 'vitest';
import { fitFusion, fuseImages } from '../src/fusion';
import type { Pixels } from '../src/adjust';

function solid(w: number, h: number, v: number, a = 255): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([v, v, v, a], i * 4);
  return { data, width: w, height: h };
}

/** Damier de contraste donné, sur la moitié gauche seulement (le reste est uni). */
function checker(w: number, h: number, amp: number, left: boolean): Pixels {
  const im = solid(w, h, 128);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = left ? x < w / 2 : x >= w / 2;
      if (!inside) continue;
      const v = (x + y) % 2 ? 128 + amp : 128 - amp;
      im.data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return im;
}

describe('fusion', () => {
  it('exposition : le résultat est entre les deux images', () => {
    const out = fuseImages([solid(64, 64, 20), solid(64, 64, 128)], { mode: 'exposure' })!;
    const v = out.data[(32 * 64 + 32) * 4];
    expect(v).toBeGreaterThan(20);
    expect(v).toBeLessThanOrEqual(130);
  });
  it('exposition : préfère la bonne exposition', () => {
    const out = fuseImages([solid(64, 64, 5), solid(64, 64, 128)], { mode: 'exposure' })!;
    expect(out.data[(32 * 64 + 32) * 4]).toBeGreaterThan(100);
  });
  it('mise au point : prend chaque zone là où elle est nette', () => {
    const a = checker(64, 64, 100, true);
    const b = checker(64, 64, 100, false);
    const out = fuseImages([a, b], { mode: 'focus' })!;
    const sd = (x0: number, x1: number) => {
      let s = 0,
        s2 = 0,
        n = 0;
      for (let y = 8; y < 56; y++)
        for (let x = x0; x < x1; x++) {
          const v = out.data[(y * 64 + x) * 4];
          s += v;
          s2 += v * v;
          n++;
        }
      return Math.sqrt(s2 / n - (s / n) ** 2);
    };
    expect(sd(4, 24)).toBeGreaterThan(40);
    expect(sd(40, 60)).toBeGreaterThan(40);
  });
  it('une seule image revient à elle-même', () => {
    const im = checker(32, 32, 60, true);
    const out = fuseImages([im], { mode: 'exposure' })!;
    for (let i = 0; i < 32 * 32; i++)
      expect(Math.abs(out.data[i * 4] - im.data[i * 4])).toBeLessThanOrEqual(2);
  });
  it('tailles différentes ou aucune image : erreur', () => {
    expect(() => fuseImages([solid(8, 8, 1), solid(9, 8, 1)], { mode: 'focus' })).toThrow();
    expect(() => fuseImages([], { mode: 'focus' })).toThrow();
  });
  it('transparent partout : reste transparent', () => {
    const out = fuseImages([solid(16, 16, 100, 0), solid(16, 16, 200, 0)], { mode: 'exposure' })!;
    expect(out.data[3]).toBe(0);
  });
  it('annulation', () => {
    expect(
      fuseImages([solid(32, 32, 50), solid(32, 32, 90)], { mode: 'exposure', progress: () => true }),
    ).toBeNull();
  });
  it('fitFusion réduit au-delà de la limite', () => {
    const small = fitFusion(solid(100, 100, 7), 2500);
    expect(small.width * small.height).toBeLessThanOrEqual(2500);
    expect(small.data[0]).toBe(7);
    const same = solid(10, 10, 1);
    expect(fitFusion(same)).toBe(same);
  });
});
