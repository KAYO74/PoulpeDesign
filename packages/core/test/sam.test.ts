import { describe, expect, it } from 'vitest';
import { SAM_MASK, SAM_SIZE, samBest, samInput, samMask, samPrompt } from '../src/sam';

const solid = (w: number, h: number, v: number) => {
  const data = new Uint8ClampedArray(w * h * 4).fill(v);
  return { data, width: w, height: h };
};

describe('sam', () => {
  it("met l'image au format du modèle, avec du vide en bas et à droite", () => {
    const r = samInput(solid(2000, 1000, 255));
    expect(r.scale).toBeCloseTo(SAM_SIZE / 2000);
    expect(r.width).toBe(SAM_SIZE);
    expect(r.height).toBe(512);
    expect(r.tensor.length).toBe(3 * SAM_SIZE * SAM_SIZE);
    // Blanc normalisé dans l'image, 0 dans le remplissage.
    expect(r.tensor[0]).toBeCloseTo((255 - 123.675) / 58.395, 4);
    expect(r.tensor[600 * SAM_SIZE + 10]).toBe(0);
  });

  it('agrandit une petite image', () => {
    const r = samInput(solid(100, 50, 0));
    expect(r.scale).toBeCloseTo(10.24);
    expect(r.width).toBe(SAM_SIZE);
    expect(r.tensor[SAM_SIZE * SAM_SIZE + 5]).toBeCloseTo(-116.28 / 57.12, 4);
  });

  it('traduit les clics dans le cadre du modèle', () => {
    const { points, labels } = samPrompt(
      [
        { x: 100, y: 50, positive: true },
        { x: 10, y: 20, positive: false },
      ],
      2,
    );
    expect(Array.from(points)).toEqual([200, 100, 20, 40]);
    expect(Array.from(labels)).toEqual([1n, 0n]);
  });

  it('choisit le masque de meilleure note', () => {
    expect(samBest([0.2, 0.9, 0.5])).toBe(1);
  });

  it("agrandit le masque à la taille de l'image, bord adouci", () => {
    // Image 400 × 200 : cadre du modèle 1024 × 512, masque utile 256 × 128 ; disque au centre.
    const logits = new Float32Array(SAM_MASK * SAM_MASK).fill(-20);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 256; x++)
        if ((x - 128) ** 2 + (y - 64) ** 2 < 40 * 40) logits[y * SAM_MASK + x] = 20;
    const scale = SAM_SIZE / 400;
    const m = samMask(logits, scale, 400, 200);
    expect(m[100 * 400 + 200]).toBe(255);
    expect(m[5 * 400 + 5]).toBe(0);
    // Le centre du disque est au centre de l'image ; son rayon (40 px du masque) fait 62,5 px d'image.
    expect(m[100 * 400 + 200 + 60]).toBe(255);
    expect(m[100 * 400 + 200 + 66]).toBe(0);
  });
});
