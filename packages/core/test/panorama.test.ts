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
    const out = stitchPanorama(views, { perspective: false })!;
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
    expect(() => stitchPanorama([noise(1), noise(2)])).toThrow(
      expect.objectContaining({ code: 'noOverlap', index: 1 }),
    );
    expect(() => stitchPanorama([noise(1)])).toThrow(expect.objectContaining({ code: 'tooFew' }));
  });

  it('annulation', () => {
    const views = [crop(full, 0, 0, 180, 120), crop(full, 120, 0, 180, 120)];
    expect(stitchPanorama(views, { progress: () => true })).toBeNull();
  });
});

describe('panorama avec perspective', () => {
  // Scène de rectangles et de disques, vue à travers trois homographies qui se recouvrent.
  const SW = 900,
    SH = 300;
  const sc = new Float32Array(SW * SH).fill(0.5);
  let seed = 11;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed / 4294967296);
  for (let n = 0; n < 260; n++) {
    const cx = rnd() * SW,
      cy = rnd() * SH,
      r = 6 + rnd() * 20,
      v = rnd(),
      disc = rnd() < 0.5;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(SH, cy + r); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(SW, cx + r); x++)
        if (!disc || Math.hypot(x - cx, y - cy) < r) sc[y * SW + x] = v;
  }
  const at = (x: number, y: number) => {
    if (x < 0 || y < 0 || x > SW - 1 || y > SH - 1) return 0.5;
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      x1 = Math.min(SW - 1, x0 + 1),
      y1 = Math.min(SH - 1, y0 + 1),
      fx = x - x0,
      fy = y - y0;
    return (
      sc[y0 * SW + x0] * (1 - fx) * (1 - fy) +
      sc[y0 * SW + x1] * fx * (1 - fy) +
      sc[y1 * SW + x0] * (1 - fx) * fy +
      sc[y1 * SW + x1] * fx * fy
    );
  };
  const view = (H: number[]): Pixels => {
    const w = 320,
      h = 300;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = H[6] * x + H[7] * y + H[8];
        const g = at((H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d) * 255;
        data.set([g, g, g, 255], (y * w + x) * 4);
      }
    return { data, width: w, height: h };
  };
  const left = view([0.99, 0.02, 100, -0.02, 1, 5, 0.00005, 0, 1]);
  const mid = view([1, 0, 300, 0, 1, 0, 0, 0, 1]);
  const right = view([1.01, -0.02, 500, 0.02, 1, -5, -0.00005, 0, 1]);

  it('recale trois vues inclinées sur la scène', () => {
    const out = stitchPanorama([left, mid, right])!;
    expect(out.ref).toBe(1);
    // La vue du milieu sert de repère : le pixel (X, Y) du panorama est le pixel (X + ox, Y + oy) de
    // la vue du milieu, soit le point (X + ox + 300, Y + oy) de la scène.
    let err = 0,
      n = 0;
    for (let Y = 30; Y < out.height - 30; Y++)
      for (let X = 0; X < out.width; X++) {
        if (out.data[(Y * out.width + X) * 4 + 3] < 255) continue;
        const sx = X + out.origin.x + 300,
          sy = Y + out.origin.y;
        if (sx < 20 || sx > SW - 20) continue;
        err += Math.abs(out.data[(Y * out.width + X) * 4] - at(sx, sy) * 255);
        n++;
      }
    expect(n).toBeGreaterThan(out.width * 100);
    expect(err / n).toBeLessThan(10);
  });

  it('sans perspective, retombe sur une simple translation', () => {
    const out = stitchPanorama([mid, view([1, 0, 480, 0, 1, 0, 0, 0, 1])], { perspective: false })!;
    expect(out.offsets[1]).toEqual({ x: 180, y: 0 });
    expect(out.width).toBe(500);
  });
});

describe('panorama cylindrique', () => {
  const F = 130,
    VW = 160,
    VH = 120;
  /** Bruit de valeurs lissé, non périodique (hachage de la grille). */
  const hash = (i: number, j: number) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const noise = (a: number, b: number, cell: number) => {
    const x = a / cell,
      y = b / cell,
      i = Math.floor(x),
      j = Math.floor(y);
    const fx = x - i,
      fy = y - j;
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    return (
      hash(i, j) * (1 - sx) * (1 - sy) +
      hash(i + 1, j) * sx * (1 - sy) +
      hash(i, j + 1) * (1 - sx) * sy +
      hash(i + 1, j + 1) * sx * sy
    );
  };
  /** Texture de la scène sur un cylindre de rayon F : (a, b) = (arc en pixels, hauteur en pixels). */
  const g = (a: number, b: number) => 40 + 110 * noise(a, b, 14) + 70 * noise(a + 500, b, 5);
  /** Vue sténopé de l'appareil tourné de `yaw` radians autour de l'axe vertical. */
  function view(yaw: number): Pixels {
    const data = new Uint8ClampedArray(VW * VH * 4);
    for (let y = 0; y < VH; y++)
      for (let x = 0; x < VW; x++) {
        const dx = x + 0.5 - VW / 2;
        const a = F * (yaw + Math.atan(dx / F));
        const b = ((y + 0.5 - VH / 2) * F) / Math.hypot(dx, F);
        const v = g(a, b);
        data.set([v, v * 0.85, 255 - v, 255], (y * VW + x) * 4);
      }
    return { data, width: VW, height: VH };
  }
  // 5 vues espacées de 40° : 160° d'écart entre la première et la dernière, plus 62° de champ.
  const yaws = [0, 1, 2, 3, 4].map((i) => (i * 40 * Math.PI) / 180);
  const views = yaws.map(view);
  const expectedWidth = F * (yaws[4] + 2 * Math.atan(VW / 2 / F));

  it('assemble une vue de plus de 200° (impossible à plat)', () => {
    const out = stitchPanorama(views, { projection: 'cylindrical' })!;
    expect(out.width).toBeGreaterThan(expectedWidth * 0.95);
    expect(out.width).toBeLessThan(expectedWidth * 1.05);
    expect(out.height).toBeGreaterThanOrEqual(VH - 2);
    expect(out.height).toBeLessThanOrEqual(VH + 6);
    // Le résultat ressemble à la scène : écart moyen faible, à quelques pixels de décalage près.
    const a0 = F * (yaws[0] - Math.atan(VW / 2 / F));
    let best = Infinity;
    for (let sx = -3; sx <= 3; sx++)
      for (let sy = -3; sy <= 3; sy++) {
        let err = 0,
          n = 0;
        for (let y = 12; y < out.height - 12; y += 3)
          for (let x = 12; x < out.width - 12; x += 3) {
            if (out.data[(y * out.width + x) * 4 + 3] < 255) continue;
            err += Math.abs(out.data[(y * out.width + x) * 4] - g(a0 + x + sx, y - out.height / 2 + sy));
            n++;
          }
        best = Math.min(best, err / n);
      }
    expect(best).toBeLessThan(12);
  });

  it('passe tout seul en cylindrique quand la vue est trop large', () => {
    const out = stitchPanorama(views)!;
    expect(out.width).toBeGreaterThan(expectedWidth * 0.95);
    expect(out.width).toBeLessThan(expectedWidth * 1.05);
  });

  it('laisse une vue étroite à plat (translation)', () => {
    const full = scene(300, 120);
    const flat = [crop(full, 0, 0, 180, 120), crop(full, 110, 4, 180, 110)];
    expect(stitchPanorama(flat)!.width).toBe(290);
  });
});
