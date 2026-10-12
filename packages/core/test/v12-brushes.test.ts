import { describe, expect, it } from 'vitest';
import {
  Stabilizer,
  createDocument,
  createGroup,
  createRect,
  dodgeBurnCurve,
  dodgeBurnPixels,
  edgeCosts,
  liveWire,
  nodesAbove,
  refineMask,
  simplifyPolyline,
  type Pixels,
} from '../src';

/* Version 1.2 : pinceaux et sélections de la Persona Photo (comme Affinity Photo). */

function pixels(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number],
): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fill(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}

describe('Éclaircir et Assombrir : plage de tons', () => {
  it('chaque plage agit surtout sur ses tons', () => {
    const gain = (v: number, r: 'shadows' | 'midtones' | 'highlights') => dodgeBurnCurve(v, 1, r) - v;
    // Ombres : le sombre bouge plus que le clair.
    expect(gain(0.1, 'shadows')).toBeGreaterThan(gain(0.9, 'shadows'));
    // Hautes lumières : l'inverse.
    expect(gain(0.9, 'highlights')).toBeGreaterThan(gain(0.1, 'highlights'));
    // Tons moyens : les extrémités ne bougent pas, le milieu si.
    expect(dodgeBurnCurve(0, 1, 'midtones')).toBe(0);
    expect(dodgeBurnCurve(1, 1, 'midtones')).toBe(1);
    expect(gain(0.5, 'midtones')).toBeGreaterThan(0.05);
  });

  it('assombrir baisse les valeurs, éclaircir les monte, sans sortir de 0..1', () => {
    for (const r of ['shadows', 'midtones', 'highlights'] as const)
      for (const v of [0, 0.2, 0.5, 0.8, 1]) {
        const up = dodgeBurnCurve(v, 1, r);
        const down = dodgeBurnCurve(v, -1, r);
        expect(up).toBeGreaterThanOrEqual(v);
        expect(down).toBeLessThanOrEqual(v);
        expect(up).toBeLessThanOrEqual(1);
        expect(down).toBeGreaterThanOrEqual(0);
      }
  });

  it('protéger la teinte garde les proportions des canaux', () => {
    const px = pixels(1, 1, () => [200, 100, 50, 255]);
    dodgeBurnPixels(px, -1, 'midtones', true);
    const [r, g, b, a] = px.data;
    expect(r).toBeLessThan(200);
    expect(r / g).toBeCloseTo(2, 1);
    expect(r / b).toBeCloseTo(4, 0);
    expect(a).toBe(255);
    // Sans protection, la teinte bouge (les canaux ne suivent pas la même proportion).
    const free = pixels(1, 1, () => [200, 100, 50, 255]);
    dodgeBurnPixels(free, -1, 'midtones', false);
    expect(free.data[0] / free.data[2]).toBeGreaterThan(4.3);
  });
});

describe('Stabilisateur', () => {
  it('corde : les petits tremblements ne font pas bouger le pinceau', () => {
    const s = new Stabilizer('rope', 10);
    s.start({ x: 0, y: 0, pressure: 1 });
    expect(s.push({ x: 4, y: 3, pressure: 1 })).toHaveLength(0);
    const out = s.push({ x: 30, y: 0, pressure: 1 });
    expect(out).toHaveLength(1);
    // Le pinceau reste à une corde de distance du pointeur.
    expect(Math.hypot(30 - out[0].x, out[0].y)).toBeCloseTo(10, 5);
    expect(s.finish()).toHaveLength(0);
  });

  it('fenêtre : moyenne des dernières positions, rattrape le pointeur à la fin', () => {
    const s = new Stabilizer('window', 4);
    s.start({ x: 0, y: 0, pressure: 1 });
    let last = { x: 0, y: 0, pressure: 1 };
    for (const x of [10, 0, 10, 0, 10]) last = s.push({ x, y: 0, pressure: 1 })[0];
    // Le zigzag est lissé autour de 5.
    expect(Math.abs(last.x - 5)).toBeLessThanOrEqual(2.5);
    const end = s.finish();
    expect(end[end.length - 1].x).toBe(10);
  });
});

describe('Lasso magnétique', () => {
  it('le chemin colle au bord d’un carré au lieu de couper droit', () => {
    // Carré sombre de 20 à 40 sur fond clair.
    const px = pixels(60, 60, (x, y) =>
      x >= 20 && x < 40 && y >= 20 && y < 40 ? [20, 20, 20, 255] : [230, 230, 230, 255],
    );
    const cost = edgeCosts(px);
    expect(cost[30 * 60 + 20]).toBeLessThan(cost[30 * 60 + 30]);
    // D'un coin à l'autre, en passant par le coin (40, 20) plutôt qu'en diagonale.
    const path = liveWire(cost, 60, 60, { x: 20, y: 20 }, { x: 40, y: 40 }, 8);
    expect(path[0]).toEqual({ x: 20, y: 20 });
    expect(path[path.length - 1]).toEqual({ x: 40, y: 40 });
    const onEdge = path.filter(
      (p) => Math.min(Math.abs(p.x - 20), Math.abs(p.x - 40), Math.abs(p.y - 20), Math.abs(p.y - 40)) <= 1,
    );
    expect(onEdge.length / path.length).toBeGreaterThan(0.9);
  });

  it('simplifie un contour fermé sans le réduire à un point', () => {
    const loop = [];
    for (let i = 0; i <= 10; i++) loop.push({ x: i, y: 0 });
    for (let i = 1; i <= 10; i++) loop.push({ x: 10, y: i });
    for (let i = 9; i >= 0; i--) loop.push({ x: i, y: 10 });
    for (let i = 9; i >= 0; i--) loop.push({ x: 0, y: i });
    const s = simplifyPolyline(loop, 0.5);
    expect(s).toHaveLength(5);
    expect(s).toContainEqual({ x: 10, y: 10 });
  });

  it('simplifie une ligne presque droite', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i % 2 ? 0.2 : 0 }));
    expect(simplifyPolyline(pts, 0.5)).toHaveLength(2);
  });
});

describe('Calques du dessous', () => {
  it('cache ce qui est peint au-dessus du calque, groupes compris', () => {
    const doc = createDocument({ width: 100, height: 100 });
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const b = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const c = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const d = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const g = createGroup([b, c]);
    doc.artboards[0].children.push(a, g, d);
    // Sous b : a seul ; c (au-dessus dans le groupe) et d sont cachés.
    expect([...nodesAbove(doc, b.id, true)].sort()).toEqual([c.id, d.id].sort());
    // Sans le calque lui-même.
    expect(nodesAbove(doc, b.id, false).has(b.id)).toBe(true);
    expect(nodesAbove(doc, d.id, true).size).toBe(0);
  });
});

describe('Affiner la sélection', () => {
  const square = () =>
    pixels(40, 40, (x, y) => [255, 255, 255, x >= 10 && x < 30 && y >= 10 && y < 30 ? 255 : 0]);
  const count = (px: Pixels) => {
    let n = 0;
    for (let i = 3; i < px.data.length; i += 4) if (px.data[i] >= 128) n++;
    return n;
  };

  it('agrandit, réduit et adoucit', () => {
    const grown = square();
    refineMask(grown, { adjust: 4, smooth: 0, feather: 0 });
    expect(count(grown)).toBeGreaterThan(400 + 4 * 20 * 3);
    const shrunk = square();
    refineMask(shrunk, { adjust: -4, smooth: 0, feather: 0 });
    expect(count(shrunk)).toBeLessThan(400 - 4 * 20 * 3);
    const soft = square();
    refineMask(soft, { adjust: 0, smooth: 0, feather: 6 });
    const edge = soft.data[(20 * 40 + 10) * 4 + 3];
    expect(edge).toBeGreaterThan(40);
    expect(edge).toBeLessThan(215);
  });

  it('le lissage efface un petit îlot isolé', () => {
    const px = square();
    px.data[(2 * 40 + 2) * 4 + 3] = 255;
    refineMask(px, { adjust: 0, smooth: 4, feather: 0 });
    expect(px.data[(2 * 40 + 2) * 4 + 3]).toBe(0);
    expect(px.data[(20 * 40 + 20) * 4 + 3]).toBe(255);
  });
});
