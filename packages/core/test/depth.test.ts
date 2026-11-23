import { describe, expect, it } from 'vitest';
import { depthAt, depthBlur, depthInput, depthMap, depthSize } from '../src/depth';

describe('depth', () => {
  it('donne au modèle des côtés multiples de 14', () => {
    for (const [w, h] of [
      [640, 480],
      [4000, 3000],
      [100, 3000],
      [30, 20],
    ]) {
      const s = depthSize(w, h);
      expect(s.width % 14).toBe(0);
      expect(s.height % 14).toBe(0);
      expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(1036 + 14);
    }
    expect(depthSize(640, 480)).toEqual({ width: 686, height: 518 });
  });

  it("normalise l'image comme le modèle", () => {
    const t = depthInput({ data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 });
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(t[1]).toBeCloseTo((0 - 0.456) / 0.224, 5);
  });

  it('met la réponse du modèle entre 0 et 1, grand = proche, à la taille voulue', () => {
    const pred = new Float32Array(4 * 4);
    for (let i = 0; i < 16; i++) pred[i] = 10 + (i % 4) * 5;
    const d = depthMap(pred, 4, 4, 8, 8);
    expect(d.length).toBe(64);
    expect(d[0]).toBeLessThan(0.1);
    expect(d[7]).toBeGreaterThan(0.9);
    expect(depthMap(new Float32Array(4).fill(3), 2, 2, 2, 2)[0]).toBe(0.5);
  });

  it('floute plus ce qui est loin du plan net, et garde le plan net intact', () => {
    const w = 32,
      h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    const depth = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = (x + y) % 2 ? 255 : 0; // damier fin : le flou le lisse
        data.set([v, v, v, 255], (y * w + x) * 4);
        depth[y * w + x] = x / (w - 1); // gauche loin, droite près
      }
    const out = depthBlur({ data, width: w, height: h }, depth, { focus: 1, range: 0.1, sigma: 3 });
    const spread = (x0: number, x1: number) => {
      let lo = 255,
        hi = 0;
      for (let y = 0; y < h; y++)
        for (let x = x0; x < x1; x++) {
          lo = Math.min(lo, out[(y * w + x) * 4]);
          hi = Math.max(hi, out[(y * w + x) * 4]);
        }
      return hi - lo;
    };
    expect(spread(28, 32)).toBe(255); // net
    expect(spread(8, 20)).toBeLessThan(80); // flou
    // Sans flou demandé : copie.
    expect(depthBlur({ data, width: w, height: h }, depth, { focus: 1, range: 0.1, sigma: 0 })).toEqual(data);
    // Plan net couvrant toute la profondeur : copie.
    expect(depthBlur({ data, width: w, height: h }, depth, { focus: 0.5, range: 0.6, sigma: 3 })).toEqual(
      data,
    );
  });

  it('lit la profondeur au point choisi', () => {
    const d = new Float32Array(100).fill(0.2);
    d[55] = 0.9;
    expect(depthAt(d, 10, 10, 5, 5)).toBeCloseTo(0.2);
    expect(depthAt(d, 10, 10, -3, 99)).toBeCloseTo(0.2);
  });
});
