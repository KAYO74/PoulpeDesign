import { describe, expect, it } from 'vitest';
import { planTiles, placeTile, tileInput, upscaleAlpha } from '../src/upscale';

describe('agrandissement par IA', () => {
  it('découpe en tuiles qui couvrent toute l’image, avec des marges à l’intérieur seulement', () => {
    const tiles = planTiles(500, 200, 192, 16);
    expect(tiles).toHaveLength(3 * 2);
    const covered = new Uint8Array(500 * 200);
    for (const t of tiles) {
      for (let y = t.cy0; y < t.cy1; y++) for (let x = t.cx0; x < t.cx1; x++) covered[y * 500 + x]++;
      expect(t.x0).toBe(Math.max(0, t.cx0 - 16));
      expect(t.x1).toBe(Math.min(500, t.cx1 + 16));
    }
    // Chaque pixel est gardé une fois et une seule.
    expect(covered.every((v) => v === 1)).toBe(true);
    expect(tiles[0].x0).toBe(0);
    expect(tiles[0].y0).toBe(0);
  });

  it('prépare une tuile : canaux séparés de 0 à 1', () => {
    const data = new Uint8ClampedArray(4 * 2 * 4);
    for (let i = 0; i < 8; i++) data.set([255, 128, 0, 255], i * 4);
    const t = { x0: 1, y0: 0, x1: 3, y1: 2, cx0: 1, cy0: 0, cx1: 3, cy1: 2 };
    const v = tileInput({ data, width: 4, height: 2 }, t);
    expect(v).toHaveLength(3 * 2 * 2);
    expect(v[0]).toBe(1);
    expect(v[4]).toBeCloseTo(128 / 255);
    expect(v[8]).toBe(0);
  });

  it('recolle seulement le centre de la tuile, au bon endroit', () => {
    // Image 8 × 4, deux tuiles de 4 de large avec 1 de marge, facteur 2.
    const tiles = planTiles(8, 4, 4, 1);
    const out = new Uint8ClampedArray(16 * 8 * 4);
    tiles.forEach((t, k) => {
      const rw = (t.x1 - t.x0) * 2,
        rh = (t.y1 - t.y0) * 2;
      const res = new Float32Array(3 * rw * rh).fill((k + 1) / 10);
      placeTile(out, 16, res, t, 2);
    });
    expect(out[(0 * 16 + 0) * 4]).toBe(Math.round(255 * 0.1));
    expect(out[(0 * 16 + 7) * 4]).toBe(Math.round(255 * 0.1));
    expect(out[(0 * 16 + 8) * 4]).toBe(Math.round(255 * 0.2));
    expect(out[(7 * 16 + 15) * 4 + 2]).toBe(Math.round(255 * 0.2));
  });

  it('agrandit l’opacité, ou la met à 255 si tout est opaque', () => {
    const solid = { data: new Uint8ClampedArray(2 * 2 * 4).fill(255), width: 2, height: 2 };
    let out = new Uint8ClampedArray(4 * 4 * 4);
    upscaleAlpha(solid, out, 2);
    expect(out[3]).toBe(255);
    const half = { data: new Uint8ClampedArray(2 * 1 * 4), width: 2, height: 1 };
    half.data.set([0, 0, 0, 0, 0, 0, 0, 255]);
    out = new Uint8ClampedArray(4 * 2 * 4);
    upscaleAlpha(half, out, 2);
    expect(out[3]).toBe(0);
    expect(out[(0 * 4 + 3) * 4 + 3]).toBe(255);
    expect(out[(0 * 4 + 1) * 4 + 3]).toBeGreaterThan(0);
    expect(out[(0 * 4 + 1) * 4 + 3]).toBeLessThan(255);
  });
});
