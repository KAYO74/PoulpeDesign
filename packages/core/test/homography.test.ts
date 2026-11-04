import { describe, expect, it } from 'vitest';
import { applyMat, estimateHomography, fitHomography, invMat, mulMat, type Mat3 } from '../src/homography';
import type { Pixels } from '../src/adjust';

/** Scène de test : rectangles et disques de gris variés, posés au hasard (déterministe). */
function scene(w: number, h: number): Float32Array {
  const d = new Float32Array(w * h).fill(0.5);
  let s = 7;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
  for (let n = 0; n < 160; n++) {
    const cx = rnd() * w,
      cy = rnd() * h,
      r = 6 + rnd() * 22,
      v = rnd(),
      disc = rnd() < 0.5;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, cy + r); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, cx + r); x++)
        if (!disc || Math.hypot(x - cx, y - cy) < r) d[y * w + x] = v;
  }
  return d;
}

function sample(src: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0.5;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(w - 1, x0 + 1),
    y1 = Math.min(h - 1, y0 + 1),
    fx = x - x0,
    fy = y - y0;
  return (
    src[y0 * w + x0] * (1 - fx) * (1 - fy) +
    src[y0 * w + x1] * fx * (1 - fy) +
    src[y1 * w + x0] * (1 - fx) * fy +
    src[y1 * w + x1] * fx * fy
  );
}

/** Vue de la scène à travers l'homographie `H` (pixels de la vue → pixels de la scène). */
function view(src: Float32Array, sw: number, sh: number, w: number, h: number, H: Mat3): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [u, v] = applyMat(H, x, y);
      const g = sample(src, sw, sh, u, v) * 255;
      data.set([g, g, g, 255], (y * w + x) * 4);
    }
  return { data, width: w, height: h };
}

describe('homographie', () => {
  it('fitHomography retrouve une transformation exacte', () => {
    const H: Mat3 = [0.97, 0.05, 40, -0.03, 1.02, 12, 0.0002, 0.0001, 1];
    const from = [
      { x: 0, y: 0 },
      { x: 300, y: 10 },
      { x: 280, y: 200 },
      { x: 20, y: 220 },
      { x: 150, y: 100 },
    ];
    const to = from.map((p) => {
      const [x, y] = applyMat(H, p.x, p.y);
      return { x, y };
    });
    const F = fitHomography(from, to)!;
    for (const p of from) {
      const [x, y] = applyMat(F, p.x, p.y);
      const [tx, ty] = applyMat(H, p.x, p.y);
      expect(Math.hypot(x - tx, y - ty)).toBeLessThan(1e-6);
    }
  });

  it("inverse d'une matrice", () => {
    const H: Mat3 = [0.97, 0.05, 40, -0.03, 1.02, 12, 0.0002, 0.0001, 1];
    const I = mulMat(H, invMat(H)!);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(I[i]).toBeCloseTo(v, 9));
  });

  it('recale deux vues qui diffèrent par une perspective', () => {
    const SW = 700,
      SH = 420;
    const sc = scene(SW, SH);
    const a = view(sc, SW, SH, 420, 300, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const Hs: Mat3 = [0.98, 0.03, 230, -0.025, 1.0, 20, 0.00008, 0.00004, 1];
    const b = view(sc, SW, SH, 420, 300, Hs);
    const fit = estimateHomography(a, b)!;
    expect(fit).toBeTruthy();
    expect(fit.inliers).toBeGreaterThan(20);
    // Points dans la zone commune (le côté gauche de la vue b).
    for (const [x, y] of [
      [10, 10],
      [170, 20],
      [160, 280],
      [20, 290],
      [90, 150],
    ]) {
      const [ex, ey] = applyMat(fit.H, x, y);
      const [tx, ty] = applyMat(Hs, x, y);
      expect(Math.hypot(ex - tx, ey - ty)).toBeLessThan(2);
    }
  });

  it("renvoie null si les images n'ont rien en commun", () => {
    const sc1 = scene(300, 200);
    let s = 99;
    const other = new Float32Array(300 * 200).map(
      () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296),
    );
    const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const a = view(sc1, 300, 200, 300, 200, I);
    const b = view(other, 300, 200, 300, 200, I);
    expect(estimateHomography(a, b)).toBeNull();
  });
});
