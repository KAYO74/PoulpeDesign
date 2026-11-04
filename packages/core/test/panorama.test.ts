import { describe, expect, it } from 'vitest';
import { alignPair, stitchPanorama } from '../src/panorama';
import type { Pixels } from '../src/adjust';

/** Scène de test : bruit lisse déterministe, qu'on découpe en vues qui se recouvrent. */
function scene(w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v =
        128 + 60 * Math.sin(x / 7 + Math.sin(y / 11) * 2) + 50 * Math.cos(y / 5 + x / 13) * Math.sin(x / 3);
      const i = (y * w + x) * 4;
      data.set([v, v * 0.8, 255 - v, 255], i);
    }
  return { data, width: w, height: h };
}

function crop(src: Pixels, x0: number, y0: number, w: number, h: number, gain = 1): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * src.width + x0 + x) * 4,
        t = (y * w + x) * 4;
      data[t] = src.data[s] * gain;
      data[t + 1] = src.data[s + 1] * gain;
      data[t + 2] = src.data[s + 2] * gain;
      data[t + 3] = 255;
    }
  return { data, width: w, height: h };
}

describe('panorama', () => {
  const full = scene(300, 120);

  it('retrouve le décalage entre deux vues', () => {
    const r = alignPair(crop(full, 0, 0, 180, 120), crop(full, 110, 4, 180, 110));
    expect(r.dx).toBe(110);
    expect(r.dy).toBe(4);
    expect(r.score).toBeGreaterThan(0.9);
  });

  it('assemble trois vues en une image de la taille de la scène', () => {
    const views = [crop(full, 0, 0, 130, 120), crop(full, 85, 0, 130, 120), crop(full, 170, 0, 130, 120)];
    const out = stitchPanorama(views)!;
    expect(out.offsets).toEqual([
      { x: 0, y: 0 },
      { x: 85, y: 0 },
      { x: 170, y: 0 },
    ]);
    expect(out.width).toBe(300);
    expect(out.height).toBe(120);
    // Le résultat ressemble à la scène d'origine.
    let err = 0;
    for (let i = 0; i < 300 * 120; i++) err += Math.abs(out.data[i * 4] - full.data[i * 4]);
    expect(err / (300 * 120)).toBeLessThan(3);
  });

  it('égalise la luminosité entre vues', () => {
    const views = [crop(full, 0, 0, 180, 120), crop(full, 120, 0, 180, 120, 0.8)];
    const out = stitchPanorama(views)!;
    // Dans la zone de la seconde vue seule, la luminosité est ramenée vers celle de la scène.
    let err = 0;
    for (let y = 0; y < 120; y++)
      for (let x = 200; x < 300; x++)
        err += Math.abs(out.data[(y * 300 + x) * 4] - full.data[(y * 300 + x) * 4]);
    expect(err / (100 * 120)).toBeLessThan(6);
  });

  it('refuse des images qui ne se recouvrent pas, et moins de deux images', () => {
    const noise = (seed: number): Pixels => {
      const d = new Uint8ClampedArray(60 * 60 * 4);
      let s = seed;
      for (let i = 0; i < d.length; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        d[i] = i % 4 === 3 ? 255 : s >> 8;
      }
      return { data: d, width: 60, height: 60 };
    };
    expect(() => stitchPanorama([noise(1), noise(2)])).toThrow();
    expect(() => stitchPanorama([noise(1)])).toThrow();
  });

  it('annulation', () => {
    const views = [crop(full, 0, 0, 180, 120), crop(full, 120, 0, 180, 120)];
    expect(stitchPanorama(views, { progress: () => true })).toBeNull();
  });
});
