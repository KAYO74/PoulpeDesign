import { describe, expect, it } from 'vitest';
import {
  blemishOffset,
  colorCloseness,
  colorizePixels,
  fitRatio,
  fixRedEye,
  gradientPosition,
  inscribedSize,
  levelAngle,
  moveCrop,
  patchBlend,
  removeBlemish,
  resizeCrop,
  similarDab,
  spongePixels,
  type Pixels,
} from '../src';

/* Outils de pixels de la version 1.2 : recadrage, dégradé, éponge, gommes, retouches. */

function solid(w: number, h: number, c: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(c, i);
  return { data, width: w, height: h };
}

const at = (px: Pixels, x: number, y: number) =>
  Array.from(px.data.slice((y * px.width + x) * 4, (y * px.width + x) * 4 + 4));

describe('recadrage', () => {
  it('l’angle de redressement rend la ligne horizontale ou verticale', () => {
    expect(levelAngle({ x: 0, y: 0 }, { x: 100, y: 10 })).toBeCloseTo(5.71, 1);
    expect(levelAngle({ x: 0, y: 0 }, { x: -100, y: -10 })).toBeCloseTo(5.71, 1);
    // Presque verticale : on la rend verticale.
    expect(levelAngle({ x: 0, y: 0 }, { x: 10, y: 100 })).toBeCloseTo(-5.71, 1);
    expect(Math.abs(levelAngle({ x: 0, y: 0 }, { x: 50, y: 0 }))).toBe(0);
  });

  it('le cadre inscrit cache les coins vides d’une image tournée', () => {
    expect(inscribedSize(400, 300, 0, 4 / 3)).toEqual({ width: 400, height: 300 });
    const s = inscribedSize(400, 300, 10, 4 / 3);
    expect(s.width / s.height).toBeCloseTo(4 / 3);
    expect(s.width).toBeLessThan(400);
    // Les coins du cadre restent dans l'image tournée.
    const a = (10 * Math.PI) / 180;
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
    ]) {
      const x = (sx * s.width) / 2,
        y = (sy * s.height) / 2;
      const u = x * Math.cos(a) + y * Math.sin(a),
        v = -x * Math.sin(a) + y * Math.cos(a);
      expect(Math.abs(u)).toBeLessThanOrEqual(200 + 1e-6);
      expect(Math.abs(v)).toBeLessThanOrEqual(150 + 1e-6);
    }
  });

  it('proportions et déplacement dans les limites', () => {
    expect(fitRatio({ x: 0, y: 0, width: 400, height: 300 }, 1)).toEqual({
      x: 50,
      y: 0,
      width: 300,
      height: 300,
    });
    const b = { x: 0, y: 0, width: 400, height: 300 };
    expect(moveCrop({ x: 10, y: 10, width: 100, height: 100 }, 500, -50, b)).toEqual({
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it('les poignées gardent le côté opposé et les proportions', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 300 };
    const start = { x: 100, y: 100, width: 100, height: 100 };
    // Coin bas droit, libre.
    expect(resizeCrop(start, 'se', { x: 250, y: 220 }, null, bounds)).toEqual({
      x: 100,
      y: 100,
      width: 150,
      height: 120,
    });
    // Coin haut gauche avec un rapport 1:1 : la plus petite dimension commande.
    const sq = resizeCrop(start, 'nw', { x: 20, y: 60 }, 1, bounds);
    expect(sq.width).toBeCloseTo(140);
    expect(sq.height).toBeCloseTo(140);
    expect(sq.x + sq.width).toBeCloseTo(200);
    expect(sq.y + sq.height).toBeCloseTo(200);
    // Côté droit avec 2:1 : la hauteur suit, autour du centre.
    const wide = resizeCrop(start, 'e', { x: 300, y: 0 }, 2, bounds);
    expect(wide).toEqual({ x: 100, y: 100 + 50 - 50, width: 200, height: 100 });
    // Le cadre ne sort pas des limites.
    const out = resizeCrop(start, 'se', { x: 900, y: 900 }, null, bounds);
    expect(out.x + out.width).toBe(400);
    expect(out.y + out.height).toBe(300);
    // Et ne s'inverse pas.
    expect(resizeCrop(start, 'e', { x: 0, y: 150 }, null, bounds).width).toBe(1);
  });
});

describe('dégradé', () => {
  const a = { x: 0, y: 0 },
    b = { x: 100, y: 0 };
  it('linéaire, radial, elliptique et conique', () => {
    expect(gradientPosition('linear', { x: 50, y: 30 }, a, b)).toBeCloseTo(0.5);
    expect(gradientPosition('linear', { x: -20, y: 0 }, a, b)).toBe(0);
    expect(gradientPosition('linear', { x: 200, y: 0 }, a, b)).toBe(1);
    expect(gradientPosition('radial', { x: 0, y: 50 }, a, b)).toBeCloseTo(0.5);
    // Elliptique : le petit axe est deux fois plus court.
    expect(gradientPosition('elliptical', { x: 0, y: 25 }, a, b, 0.5)).toBeCloseTo(0.5);
    expect(gradientPosition('conical', { x: 0, y: 10 }, a, b)).toBeCloseTo(0.25);
    expect(gradientPosition('conical', { x: -10, y: 0 }, a, b)).toBeCloseTo(0.5);
  });
});

describe('éponge et remplacement de couleur', () => {
  it('désature vers le gris et sature sans changer la teinte', () => {
    const px = solid(1, 1, [200, 100, 50, 255]);
    spongePixels(px, -1);
    const [r, g, b] = at(px, 0, 0);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
    const px2 = solid(1, 1, [150, 100, 80, 255]);
    spongePixels(px2, 1);
    const c = at(px2, 0, 0);
    expect(c[0] - c[2]).toBeGreaterThan(150 - 80);
    expect(c[0]).toBeLessThanOrEqual(255);
    expect(c[0]).toBeGreaterThan(c[1]);
    expect(c[1]).toBeGreaterThan(c[2]);
  });

  it('remplace la teinte en gardant la luminosité', () => {
    const px = solid(2, 1, [200, 40, 40, 255]);
    px.data.set([90, 15, 15, 255], 4);
    colorizePixels(px, { r: 30, g: 60, b: 220 });
    const light = at(px, 0, 0),
      dark = at(px, 1, 0);
    expect(light[2]).toBeGreaterThan(light[0]);
    expect(dark[2]).toBeGreaterThan(dark[0]);
    // L'ombre reste plus sombre que la lumière.
    expect(dark[2]).toBeLessThan(light[2]);
    const l = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    expect(l(light)).toBeCloseTo(0.3 * 200 + 0.59 * 40 + 0.11 * 40, -1);
  });

  it('ressemblance à la couleur prélevée', () => {
    const s = { r: 100, g: 100, b: 100, a: 255 };
    expect(colorCloseness(110, 95, 100, 255, s, 20)).toBe(1);
    expect(colorCloseness(200, 100, 100, 255, s, 20)).toBe(0);
    expect(colorCloseness(125, 100, 100, 255, s, 20)).toBeGreaterThan(0);
    expect(colorCloseness(125, 100, 100, 255, s, 20)).toBeLessThan(1);
    expect(colorCloseness(0, 0, 0, 0, s, 20)).toBe(0);
  });
});

describe('gomme d’arrière-plan', () => {
  it('ne couvre que les pixels proches de la couleur prélevée', () => {
    // Fond bleu, sujet rouge à droite.
    const px = solid(20, 20, [40, 60, 200, 255]);
    for (let y = 0; y < 20; y++)
      for (let x = 12; x < 20; x++) px.data.set([220, 30, 30, 255], (y * 20 + x) * 4);
    const cov = similarDab(px, 10, 10, 9, 100, { r: 40, g: 60, b: 200, a: 255 }, 30);
    expect(cov[10 * 20 + 6]).toBe(255);
    expect(cov[10 * 20 + 14]).toBe(0);
    // Hors du disque : rien.
    expect(cov[0]).toBe(0);
  });

  it('contigu : seulement la zone reliée au centre', () => {
    const px = solid(21, 1, [0, 0, 0, 255]);
    px.data.set([255, 255, 255, 255], 10 * 4);
    const loose = similarDab(px, 2.5, 0.5, 10, 100, { r: 0, g: 0, b: 0, a: 255 }, 10, false);
    const tight = similarDab(px, 2.5, 0.5, 10, 100, { r: 0, g: 0, b: 0, a: 255 }, 10, true);
    expect(loose[11]).toBe(255);
    expect(tight[11]).toBe(0);
    expect(tight[5]).toBe(255);
  });
});

describe('retouches', () => {
  it('yeux rouges : le rouge disparaît, la peau reste', () => {
    const px = solid(20, 20, [220, 170, 140, 255]);
    for (let y = 7; y < 13; y++)
      for (let x = 7; x < 13; x++) px.data.set([200, 30, 30, 255], (y * 20 + x) * 4);
    fixRedEye(px, 10, 10, 8, 8, 0.3);
    const pupil = at(px, 10, 10);
    expect(pupil[0]).toBeLessThan(40);
    expect(at(px, 4, 10)).toEqual([220, 170, 140, 255]);
  });

  it('correctif : la texture de la source prend la lumière de l’entourage', () => {
    const w = 40,
      h = 40;
    // Destination : gris clair uni, avec une tache noire au milieu.
    const dest = solid(w, h, [200, 200, 200, 255]);
    for (let y = 16; y < 24; y++)
      for (let x = 16; x < 24; x++) dest.data.set([0, 0, 0, 255], (y * w + x) * 4);
    // Source : gris sombre uni (une autre lumière).
    const src = solid(w, h, [100, 100, 100, 255]);
    const mask = new Uint8Array(w * h);
    for (let y = 12; y < 28; y++) for (let x = 12; x < 28; x++) mask[y * w + x] = 255;
    const out = patchBlend(dest, src, mask);
    // La tache est partie, et la zone a la lumière de l'entourage.
    expect(out[(20 * w + 20) * 4]).toBeGreaterThan(185);
    expect(out[(20 * w + 20) * 4]).toBeLessThan(215);
    // Hors de la zone, rien ne change.
    expect(out[(2 * w + 2) * 4]).toBe(200);
  });

  it('imperfections : un point isolé disparaît', () => {
    const px = solid(80, 80, [180, 140, 120, 255]);
    for (let y = 38; y < 42; y++)
      for (let x = 38; x < 42; x++) px.data.set([60, 30, 30, 255], (y * 80 + x) * 4);
    expect(blemishOffset(px, 40, 40, 4)).not.toBeNull();
    expect(removeBlemish(px, 40, 40, 4)).toBe(true);
    const c = at(px, 40, 40);
    expect(Math.abs(c[0] - 180)).toBeLessThan(8);
    expect(Math.abs(c[1] - 140)).toBeLessThan(8);
    // Trop près du bord : rien à faire.
    expect(removeBlemish(solid(10, 10, [0, 0, 0, 255]), 5, 5, 4)).toBe(false);
  });
});
