import { describe, expect, it } from 'vitest';
import {
  SHAPE_KINDS,
  applyBoolean,
  applyCorners,
  artboardToSvg,
  basePathCommands,
  commandsToCubics,
  cornerSites,
  createDocument,
  createPolygon,
  createRect,
  createShape,
  createStar,
  createEllipse,
  cubicPoint,
  decodePoulpe,
  defaultStyle,
  encodePoulpe,
  exactBounds,
  deleteAnchors,
  flattenCommands,
  fromSubpaths,
  insertAnchor,
  hitNode,
  pathToSvg,
  pointInPolylines,
  rectBase,
  setCornerType,
  setCorners,
  setPathCommands,
  shapeCommands,
  shapeParam,
  shapePath,
  syncShape,
  toPathNode,
  toSubpaths,
  type PathCommand,
  type PathNode,
  type Vec,
} from '../src';

/* Version 1.2, outils de forme : formes paramétriques, coins non destructifs, coins des rectangles. */

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/** Points du tracé où passe chaque courbe à mi-parcours (pour mesurer un arrondi). */
function midpoints(cmds: PathCommand[]): Vec[] {
  return commandsToCubics(cmds).flatMap((s) => s.cubics.map((c) => cubicPoint(c, 0.5)));
}

function expectBox(cmds: PathCommand[], w: number, h: number, digits = 1) {
  const b = exactBounds(cmds)!;
  expect(b.x).toBeCloseTo(0, digits);
  expect(b.y).toBeCloseTo(0, digits);
  expect(b.width).toBeCloseTo(w, digits);
  expect(b.height).toBeCloseTo(h, digits);
}

describe('formes paramétriques', () => {
  it('chaque forme remplit sa boîte et suit sa taille', () => {
    for (const kind of SHAPE_KINDS) {
      const spec = createShape(kind, box(0, 0, 200, 120), defaultStyle()).shape!;
      const cmds = shapeCommands(spec, 200, 120);
      const b = exactBounds(cmds)!;
      expect(b.x).toBeGreaterThanOrEqual(-0.01);
      expect(b.y).toBeGreaterThanOrEqual(-0.01);
      expect(b.x + b.width).toBeLessThanOrEqual(200.01);
      expect(b.y + b.height).toBeLessThanOrEqual(120.01);
      if (kind !== 'spiral') {
        expectBox(cmds, 200, 120);
        expect(cmds[cmds.length - 1].op).toBe('Z');
      } else expect(cmds.some((c) => c.op === 'Z')).toBe(false);
    }
  });

  it('le triangle suit la position de son sommet', () => {
    const cmds = shapeCommands({ kind: 'triangle', params: { apex: 0.25 } }, 100, 80);
    expect(cmds[0]).toMatchObject({ op: 'M', x: 25, y: 0 });
  });

  it('les réglages sont bornés et prennent leur valeur par défaut', () => {
    expect(shapeParam({ kind: 'cog', params: { teeth: 2.4 } }, 'teeth')).toBe(3);
    expect(shapeParam({ kind: 'cog', params: {} }, 'teeth')).toBe(12);
    expect(shapeParam({ kind: 'donut', params: { hole: 5 } }, 'hole')).toBe(0.98);
  });

  it("l'anneau a un vrai trou, le secteur s'ouvre", () => {
    const donut = flattenCommands(shapeCommands({ kind: 'donut', params: { hole: 0.5 } }, 100, 100), 0.2);
    expect(pointInPolylines(donut, { x: 50, y: 50 })).toBe(false);
    expect(pointInPolylines(donut, { x: 50, y: 10 })).toBe(true);
    // Secteur de 0° à 270° : le quart haut gauche est vide.
    const pie = flattenCommands(
      shapeCommands({ kind: 'pie', params: { start: 0, end: 270 } }, 100, 100),
      0.2,
    );
    expect(pointInPolylines(pie, { x: 30, y: 30 })).toBe(false);
    expect(pointInPolylines(pie, { x: 70, y: 70 })).toBe(true);
  });

  it("le rayon d'une bulle reste en pixels quand la boîte s'étire", () => {
    const spec = { kind: 'callout' as const, params: { radius: 20 } };
    for (const w of [200, 600]) {
      const cmds = shapeCommands(spec, w, 150);
      // Le tracé commence là où finit l'arrondi du coin haut gauche, à 20 px du coin.
      expect(cmds[0]).toMatchObject({ op: 'M' });
      expect((cmds[0] as { x: number }).x).toBeCloseTo(20, 3);
    }
  });

  it("une forme s'agrandit à partir de ses réglages, pas en étirant l'ancienne", () => {
    const n = createShape('callout', box(0, 0, 100, 100), defaultStyle(), { radius: 10 });
    n.width = 400;
    const p = shapePath(n);
    expect((p[0] as { x: number }).x).toBeCloseTo(10, 3);
    // Le contour de base de l'outil Nœud suit lui aussi la nouvelle taille.
    const vb = n.viewBox;
    const base = basePathCommands(n);
    expect(exactBounds(base)!.width).toBeCloseTo(vb.width, 3);
    syncShape(n);
    expect(n.viewBox.width).toBe(400);
    expect(exactBounds(shapePath(n))!.width).toBeCloseTo(400, 3);
  });
});

describe('coins non destructifs', () => {
  const square = rectBase(100, 100);

  it('arrondit un coin en vrai quart de cercle', () => {
    const out = applyCorners(square, { '0:0': { radius: 20 } });
    expectBox(out, 100, 100);
    // Le milieu de l'arrondi est à 20 px du centre du cercle (20, 20).
    const arc = midpoints(out).find((p) => p.x < 20 && p.y < 20)!;
    expect(Math.hypot(arc.x - 20, arc.y - 20)).toBeCloseTo(20, 1);
  });

  it('pan droit, arc concave et encoche', () => {
    const straight = applyCorners(square, { '0:0': { radius: 20, type: 'straight' } });
    expect(straight.some((c) => c.op === 'C')).toBe(false);
    expect(straight[0].op).toBe('M');
    expect((straight[0] as Vec).x).toBeCloseTo(20, 6);
    const cutout = applyCorners(square, { '0:0': { radius: 20, type: 'cutout' } });
    expect(cutout.some((c) => c.op === 'L' && Math.abs(c.x - 20) < 1e-6 && Math.abs(c.y - 20) < 1e-6)).toBe(
      true,
    );
    const concave = applyCorners(square, { '0:0': { radius: 20, type: 'concave' } });
    const arc = midpoints(concave).find((p) => p.x < 20 && p.y < 20)!;
    // Arc centré sur le coin lui-même.
    expect(Math.hypot(arc.x, arc.y)).toBeCloseTo(20, 1);
  });

  it('la clé * vaut pour tous les coins ; un rayon trop grand est limité', () => {
    const all = applyCorners(square, { '*': { radius: 500 } });
    // Rayon limité à la moitié du côté : un cercle.
    const poly = flattenCommands(all, 0.1);
    expect(pointInPolylines(poly, { x: 3, y: 3 })).toBe(false);
    expect(pointInPolylines(poly, { x: 50, y: 50 })).toBe(true);
    // Un coin à 0 sous `*` reste net.
    const some = applyCorners(square, { '*': { radius: 20 }, '0:2': { radius: 0 } });
    expect(some.some((c) => c.op !== 'Z' && c.x === 100 && c.y === 100)).toBe(true);
  });

  it("un rectangle garde des coins de 20 px quand on l'étire", () => {
    const r = createRect(box(0, 0, 200, 100));
    setCorners(r, ['0:0'], 20, 'straight');
    expect(r.radii).toEqual([20, 0, 0, 0]);
    expect(r.cornerType).toBe('straight');
    r.width = 600;
    const p = shapePath(r);
    expect(p[0]).toMatchObject({ op: 'M', x: 20, y: 0 });
    // Quatre rayons égaux : de nouveau liés.
    setCorners(r, ['0:1', '0:2', '0:3'], 20);
    expect(r.radii).toBeUndefined();
    expect(r.cornerRadius).toBe(20);
    setCornerType(r, 'round');
    expect(r.cornerType).toBeUndefined();
  });

  it('un rectangle arrondi ne se saisit pas dans ses coins', () => {
    const r = createRect(box(0, 0, 200, 200));
    r.cornerRadius = 80;
    expect(hitNode(r, { x: 3, y: 3 })).toBe(false);
    expect(hitNode(r, { x: 100, y: 100 })).toBe(true);
    // Un rectangle net se saisit toujours dans toute sa boîte.
    r.cornerRadius = 0;
    expect(hitNode(r, { x: 3, y: 3 })).toBe(true);
  });

  it("l'outil Coin pose, change et retire des coins sur un tracé", () => {
    const tri = createShape('triangle', box(0, 0, 100, 100), defaultStyle());
    expect(cornerSites(tri).map((s) => s.key)).toEqual(['0:0', '0:1', '0:2']);
    setCorners(tri, ['0:1'], 10);
    expect(tri.corners).toEqual({ '0:1': { radius: 10 } });
    expect(cornerSites(tri)[1].corner).toEqual({ radius: 10 });
    setCornerType(tri, 'concave');
    expect(tri.corners!['0:1'].type).toBe('concave');
    setCorners(tri, null, 6, 'round');
    expect(tri.corners).toEqual({ '*': { radius: 6 } });
    setCorners(tri, ['0:0'], 0);
    expect(tri.corners!['0:0']).toEqual({ radius: 0 });
    setCorners(tri, null, 0);
    expect(tri.corners).toBeUndefined();
  });

  it('polygones, étoiles et formes ont des coins ; pas les ellipses', () => {
    expect(cornerSites(createPolygon(box(0, 0, 100, 100), defaultStyle(), 6))).toHaveLength(6);
    expect(cornerSites(createStar(box(0, 0, 100, 100), defaultStyle(), 5, 0.5))).toHaveLength(10);
    expect(cornerSites(createEllipse(box(0, 0, 100, 100)))).toHaveLength(0);
    // Les coins d'un polygone restent quand on change son nombre de côtés.
    const poly = createPolygon(box(0, 0, 100, 100), defaultStyle(), 6);
    setCorners(poly, null, 8);
    poly.sides = 8;
    expect(shapePath(poly).filter((c) => c.op === 'C')).toHaveLength(8);
  });

  it('des côtés courbes élargissent le polygone', () => {
    const poly = createPolygon(box(0, 0, 100, 100), defaultStyle(), 3);
    const flat = exactBounds(shapePath(poly))!;
    poly.curve = 1;
    const bulged = exactBounds(shapePath(poly))!;
    expect(bulged.height).toBeGreaterThan(flat.height + 5);
  });
});

describe('conversion, export, enregistrement', () => {
  it('la conversion en courbes fige la forme et ses coins', () => {
    const tri = createShape('triangle', box(10, 20, 100, 100), defaultStyle());
    setCorners(tri, null, 12);
    tri.width = 300;
    const path = toPathNode(tri)!;
    expect(path.shape).toBeUndefined();
    expect(path.corners).toBeUndefined();
    expect(path.d).toMatch(/C/);
    // Même contour à l'écran avant et après.
    const before = exactBounds(shapePath(tri))!;
    const after = exactBounds(shapePath(path))!;
    expect(after.width).toBeCloseTo(before.width, 3);
    expect(path.x + after.x).toBeCloseTo(tri.x + before.x, 3);
  });

  it("modifier les nœuds à la main fait d'une forme un simple tracé", () => {
    const n: PathNode = createShape('arrow', box(0, 0, 100, 50), defaultStyle());
    setPathCommands(n, basePathCommands(n));
    expect(n.shape).toBeUndefined();
  });

  it('les coins suivent leurs nœuds quand on en ajoute ou en retire', () => {
    const tri: PathNode = createShape('triangle', box(0, 0, 100, 100), defaultStyle());
    setCorners(tri, ['0:2'], 10);
    // Un nœud ajouté sur le premier côté : le coin bas gauche devient le quatrième nœud.
    const sps = toSubpaths(basePathCommands(tri));
    insertAnchor(sps, 0, 0, 0.5);
    setPathCommands(tri, fromSubpaths(sps));
    expect(tri.corners).toEqual({ '0:3': { radius: 10 } });
    // Le nœud du coin retiré : le coin disparaît.
    setPathCommands(tri, fromSubpaths(deleteAnchors(toSubpaths(basePathCommands(tri)), ['0:3'])));
    expect(tri.corners).toBeUndefined();
  });

  it('les opérations booléennes et les exports voient le vrai contour', () => {
    const doc = createDocument({ width: 400, height: 400 });
    const r = createRect(box(0, 0, 100, 100));
    setCorners(r, null, 50);
    const heart = createShape('heart', box(200, 0, 100, 100), defaultStyle());
    setCorners(heart, ['0:3'], 10);
    doc.artboards[0].children.push(r, heart);
    const svg = artboardToSvg(doc, doc.artboards[0]);
    expect(svg).toContain(pathToSvg(shapePath(heart)));
    expect(svg).toContain(pathToSvg(shapePath(r)));
    const small = createRect(box(40, 40, 20, 20));
    doc.artboards[0].children.push(small);
    const ids = applyBoolean(doc, [r.id, small.id], 'unite', 'x');
    expect(ids).toBeTruthy();
    const out = doc.artboards[0].children.find((n) => n.id === ids![0]) as PathNode;
    // Le cercle obtenu ne touche pas les coins de sa boîte.
    expect(hitNode(out, { x: 2, y: 2 })).toBe(false);
  });

  it('les formes et les coins survivent à l’enregistrement', async () => {
    const doc = createDocument({ width: 400, height: 400 });
    const cog = createShape('cog', box(0, 0, 100, 100), defaultStyle(), { teeth: 7 });
    setCorners(cog, ['0:1'], 4, 'cutout');
    const r = createRect(box(0, 0, 100, 100));
    setCorners(r, ['0:2'], 9, 'concave');
    doc.artboards[0].children.push(cog, r);
    const back = await decodePoulpe(await encodePoulpe(doc));
    const [c2, r2] = back.artboards[0].children as [PathNode, typeof r];
    expect(c2.shape).toEqual(cog.shape);
    expect(c2.corners).toEqual(cog.corners);
    expect(r2.radii).toEqual([0, 0, 9, 0]);
    expect(r2.cornerType).toBe('concave');
  });
});
