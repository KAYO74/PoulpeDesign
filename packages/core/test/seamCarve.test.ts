import { describe, expect, it } from 'vitest';
import { contentAwareScale, type Pixels } from '../src';

/** Fond dégradé doux avec un carré très contrasté (un « objet ») au centre-gauche. */
function scene(w = 120, h = 60) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inObj = x >= 20 && x < 40 && y >= 20 && y < 40;
      const v = inObj ? ((x + y) % 2 ? 255 : 0) : 100 + ((x * 7 + y * 13 + x * y) % 17);
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { data, width: w, height: h } as Pixels;
}

/** Nombre de pixels très contrastés (l'objet damier). */
const hard = (p: Pixels) => {
  let n = 0;
  for (let i = 0; i < p.data.length; i += 4) if (p.data[i] === 0 || p.data[i] === 255) n++;
  return n;
};

describe('contentAwareScale', () => {
  it('rétrécit en largeur et en hauteur aux tailles demandées', async () => {
    const out = (await contentAwareScale(scene(), 90, 45))!;
    expect([out.width, out.height]).toEqual([90, 45]);
    expect(out.data.length).toBe(90 * 45 * 4);
  });

  it("garde l'objet détaillé intact en rétrécissant", async () => {
    const src = scene();
    const out = (await contentAwareScale(src, 80, 60))!;
    expect(hard(out)).toBe(hard(src));
  });

  it('agrandit en largeur', async () => {
    const out = (await contentAwareScale(scene(), 150, 60))!;
    expect(out.width).toBe(150);
    expect(hard(out)).toBeGreaterThanOrEqual(hard(scene()));
  });

  it('la zone protégée reste entière', async () => {
    const src = scene();
    const protect = new Uint8Array(src.width * src.height);
    for (let y = 0; y < src.height; y++) for (let x = 60; x < 80; x++) protect[y * src.width + x] = 1;
    // Un deuxième damier, protégé cette fois, sur la droite.
    for (let y = 10; y < 30; y++)
      for (let x = 60; x < 80; x++) {
        const i = (y * src.width + x) * 4;
        src.data[i] = src.data[i + 1] = src.data[i + 2] = (x + y) % 2 ? 255 : 0;
      }
    const out = (await contentAwareScale(src, 70, 60, { protect }))!;
    expect(hard(out)).toBe(hard(src));
  });

  it("retire d'abord les zones transparentes", async () => {
    const src = scene(100, 40);
    for (let y = 0; y < 40; y++) for (let x = 50; x < 90; x++) src.data[(y * 100 + x) * 4 + 3] = 0;
    const out = (await contentAwareScale(src, 60, 40))!;
    let visible = 0;
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i] > 0) visible++;
    expect(visible / (60 * 40)).toBeGreaterThan(0.95);
  });

  it('peut être annulée', async () => {
    const out = await contentAwareScale(scene(), 60, 60, { tick: () => true });
    expect(out).toBeNull();
  });

  it('même taille : renvoie la même image', async () => {
    const src = scene();
    const out = (await contentAwareScale(src, 120, 60))!;
    expect(out.data).toEqual(src.data);
  });
});
