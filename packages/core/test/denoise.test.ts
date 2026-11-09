import { describe, expect, it } from 'vitest';
import { applyAdjustment, defaultAdjustment, isNeutral, type Pixels } from '../src';

/** Aplat bleu/orange avec un contour net au milieu, plus du bruit pseudo-aléatoire. */
function noisy(w = 64, h = 48, amp = 18): { clean: Pixels; noisy: Pixels } {
  const clean = new Uint8ClampedArray(w * h * 4);
  const dirty = new Uint8ClampedArray(w * h * 4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const left = x < w / 2;
      const c = left ? [40, 90, 200] : [220, 140, 40];
      for (let k = 0; k < 3; k++) {
        clean[i + k] = c[k];
        dirty[i + k] = c[k] + rnd() * amp;
      }
      clean[i + 3] = dirty[i + 3] = 255;
    }
  return { clean: { data: clean, width: w, height: h }, noisy: { data: dirty, width: w, height: h } };
}

/** Écart moyen à l'image propre. */
const err = (a: Pixels, b: Pixels) => {
  let s = 0;
  for (let i = 0; i < a.data.length; i += 4)
    for (let k = 0; k < 3; k++) s += Math.abs(a.data[i + k] - b.data[i + k]);
  return s / (a.data.length / 4) / 3;
};

describe('denoise', () => {
  it('neutre à zéro', () => {
    expect(isNeutral({ kind: 'denoise', luminance: 0, color: 0 })).toBe(true);
    expect(isNeutral(defaultAdjustment('denoise'))).toBe(false);
    const { noisy: px } = noisy();
    const before = new Uint8ClampedArray(px.data);
    applyAdjustment(px, { kind: 'denoise', luminance: 0, color: 0 });
    expect(px.data).toEqual(before);
  });

  it('réduit le bruit et garde le contour', () => {
    const { clean, noisy: px } = noisy();
    const e0 = err(px, clean);
    applyAdjustment(px, { kind: 'denoise', luminance: 60, color: 60 });
    expect(err(px, clean)).toBeLessThan(e0 * 0.6);
    // Le contour reste net : de part et d'autre du milieu, les couleurs restent très différentes.
    const w = px.width;
    const a = px.data[(10 * w + w / 2 - 3) * 4];
    const b = px.data[(10 * w + w / 2 + 3) * 4];
    expect(b - a).toBeGreaterThan(130);
  });

  it('la couleur seule lisse la chrominance sans toucher le contour de luminance', () => {
    const { clean, noisy: px } = noisy();
    const e0 = err(px, clean);
    applyAdjustment(px, { kind: 'denoise', luminance: 0, color: 80 });
    expect(err(px, clean)).toBeLessThan(e0);
  });

  it("n'altère ni l'opacité ni les pixels transparents voisins", () => {
    const { noisy: px } = noisy(20, 20);
    for (let i = 0; i < 20; i++) px.data[i * 4 + 3] = 0;
    applyAdjustment(px, { kind: 'denoise', luminance: 80, color: 80 });
    for (let i = 0; i < 20; i++) expect(px.data[i * 4 + 3]).toBe(0);
    for (const v of px.data) expect(Number.isNaN(v)).toBe(false);
  });
});
