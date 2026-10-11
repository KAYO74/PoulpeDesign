import { describe, expect, it } from 'vitest';
import {
  artboardToSvg,
  convertGradient,
  createDocument,
  createLine,
  createPath,
  createRect,
  ellipseRatio,
  exactBounds,
  gradientHandles,
  gradientKind,
  hitNode,
  linearGradientPoints,
  linearPoints,
  profilePositions,
  reverseStops,
  rotateGradient,
  sampleOpacity,
  shapePath,
  strokeWidthAt,
  toPathNode,
  transparencyPaint,
  widthProfileOutline,
  withHandles,
  type GradientPaint,
  type Paint,
  type Stroke,
  type Transparency,
} from '../src';

const STOPS = [
  { offset: 0, color: '#ff0000' },
  { offset: 1, color: '#0000ff' },
];

describe('géométrie des dégradés (outil Remplissage)', () => {
  it('un ancien dégradé linéaire garde son rendu (angle seul)', () => {
    const p: Paint = { type: 'linear', stops: STOPS, angle: 30 };
    expect(linearPoints(p, 200, 100)).toEqual(linearGradientPoints(30, 200, 100));
  });

  it('début et fin exacts, en fractions de la boîte', () => {
    const p = withHandles(
      { type: 'linear', stops: STOPS, angle: 0 } as GradientPaint,
      200,
      100,
      { x: 20, y: 10 },
      {
        x: 120,
        y: 90,
      },
    );
    expect(p).toMatchObject({ x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.9 });
    const [a, b] = linearPoints(p as Extract<Paint, { type: 'linear' }>, 200, 100);
    expect(a).toEqual({ x: 20, y: 10 });
    expect(b).toEqual({ x: 120, y: 90 });
    // L'angle suit, pour ce qui ne lit que l'angle.
    expect((p as { angle: number }).angle).toBeCloseTo(38.66, 1);
  });

  it('radial, elliptique et conique : poignées et retour', () => {
    const r = { type: 'radial', stops: STOPS, cx: 0.5, cy: 0.5, r: 0.25 } as GradientPaint;
    const h = gradientHandles(r, 200, 100);
    expect(h.a).toEqual({ x: 100, y: 50 });
    expect(h.b.x).toBeCloseTo(150);
    expect(h.c).toBeUndefined();
    const moved = withHandles(r, 200, 100, { x: 50, y: 50 }, { x: 50, y: 90 });
    expect(moved).toMatchObject({ cx: 0.25, cy: 0.5, r: 0.2, angle: 90 });
    const el = convertGradient(r, 'elliptical', 200, 100);
    expect(gradientKind(el)).toBe('elliptical');
    const eh = gradientHandles(el, 200, 100);
    expect(eh.c).toBeDefined();
    expect(
      ellipseRatio(el as { cx: number; cy: number; r: number }, 200, 100, { x: 100, y: 75 }),
    ).toBeCloseTo(0.5);
    const lin = convertGradient(el, 'linear', 200, 100);
    // Le tracé du dégradé reste : du centre au bout du rayon.
    expect(linearPoints(lin as Extract<Paint, { type: 'linear' }>, 200, 100)[0]).toEqual({ x: 100, y: 50 });
    const conic = convertGradient(r, 'conic', 200, 100);
    expect(conic.type).toBe('conic');
    expect(gradientHandles(conic, 200, 100).b.x).toBeCloseTo(150);
  });

  it('tourne d’un quart de tour et inverse les arrêts', () => {
    const p = { type: 'linear', stops: STOPS, angle: 0, x1: 0, y1: 0.5, x2: 1, y2: 0.5 } as GradientPaint;
    const q = rotateGradient(p, 100, 100) as Extract<Paint, { type: 'linear' }>;
    expect(q.x1).toBeCloseTo(0.5);
    expect(q.y1).toBeCloseTo(0);
    expect(q.y2).toBeCloseTo(1);
    expect(q.angle).toBe(90);
    expect(
      rotateGradient({ type: 'conic', stops: STOPS, angle: 170, cx: 0.5, cy: 0.5 } as GradientPaint, 10, 10),
    ).toMatchObject({
      angle: -100,
    });
    const rev = reverseStops({
      type: 'linear',
      stops: [...STOPS, { offset: 0.2, color: '#00ff00' }],
      angle: 0,
    });
    expect(rev.stops.map((s) => s.offset)).toEqual([0.8, 0, 1]);
  });

  it('exporte en SVG le début et la fin exacts et l’ellipse', () => {
    const doc = createDocument({ width: 400, height: 400 });
    const a = createRect({ x: 0, y: 0, width: 200, height: 100 });
    a.fill = { type: 'linear', stops: STOPS, angle: 0, x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.9 };
    const b = createRect({ x: 0, y: 200, width: 200, height: 100 });
    b.fill = { type: 'radial', stops: STOPS, cx: 0.5, cy: 0.5, r: 0.5, ratio: 0.5, angle: 30 };
    doc.artboards[0].children.push(a, b);
    const svg = artboardToSvg(doc, doc.artboards[0]);
    expect(svg).toContain('x1="20" y1="10" x2="120" y2="90"');
    expect(svg).toContain('gradientTransform="translate(100 50) rotate(30) scale(1 0.5)"');
  });
});

describe('outil Transparence', () => {
  const t: Transparency = {
    type: 'linear',
    angle: 0,
    stops: [
      { offset: 0, opacity: 1 },
      { offset: 1, opacity: 0 },
    ],
  };

  it('devient un masque blanc plus ou moins opaque', () => {
    const p = transparencyPaint(t);
    expect(p.stops.map((s) => s.color)).toEqual(['#ffffff', '#ffffff00']);
    expect(sampleOpacity(t.stops, 0.25)).toBeCloseTo(0.75);
  });

  it('se sauve à part du remplissage et s’exporte en masque SVG', () => {
    const doc = createDocument({ width: 400, height: 400 });
    const r = createRect({ x: 10, y: 10, width: 100, height: 50 });
    r.fill = { type: 'linear', stops: STOPS, angle: 45 };
    r.transparency = t;
    doc.artboards[0].children.push(r);
    const back = JSON.parse(JSON.stringify(doc));
    expect(back.artboards[0].children[0].fill.type).toBe('linear');
    expect(back.artboards[0].children[0].transparency.stops[1].opacity).toBe(0);
    const svg = artboardToSvg(doc, doc.artboards[0]);
    expect(svg).toMatch(/<mask id="tm\d+" maskUnits="userSpaceOnUse"/);
    expect(svg).toMatch(/<g mask="url\(#tm\d+\)">/);
    expect(svg).toContain('stop-color="#ffffff" stop-opacity="0"');
  });
});

describe('outil Contour', () => {
  it('décale le tracé sans toucher à la forme, et se retire', () => {
    const r = createRect({ x: 0, y: 0, width: 100, height: 50 });
    r.contour = { radius: 10, join: 'miter', miterLimit: 4 };
    const b = exactBounds(shapePath(r))!;
    expect(b.x).toBeCloseTo(-10, 0);
    expect(b.width).toBeCloseTo(120, 0);
    expect(r.width).toBe(100);
    // Le contour se touche au-delà de la boîte.
    expect(hitNode(r, { x: -5, y: 25 })).toBe(true);
    r.contour = { radius: -10, join: 'round', miterLimit: 4 };
    expect(exactBounds(shapePath(r))!.width).toBeCloseTo(80, 0);
    delete r.contour;
    expect(exactBounds(shapePath(r))!.width).toBeCloseTo(100, 0);
  });

  it('une forme trop rétrécie disparaît ; un tracé ouvert reste tel quel', () => {
    const r = createRect({ x: 0, y: 0, width: 40, height: 40 });
    r.contour = { radius: -30, join: 'round', miterLimit: 4 };
    expect(shapePath(r)).toEqual([]);
    const open = createPath({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      d: 'M0 0L100 100',
      viewBox: { x: 0, y: 0, width: 100, height: 100 },
    });
    open.contour = { radius: 10, join: 'round', miterLimit: 4 };
    expect(exactBounds(shapePath(open))!.width).toBeCloseTo(100, 0);
  });

  it('« Convertir en courbes » l’applique pour de bon', () => {
    const r = createRect({ x: 0, y: 0, width: 100, height: 50 });
    r.contour = { radius: 5, join: 'round', miterLimit: 4 };
    const p = toPathNode(r)!;
    expect(p.contour).toBeUndefined();
    expect(p.width).toBeCloseTo(110, 0);
    const q = toPathNode({ ...p, contour: { radius: 5, join: 'round', miterLimit: 4 } })!;
    expect(q.contour).toBeUndefined();
    expect(q.width).toBeCloseTo(120, 0);
  });
});

describe('outil Largeur de trait', () => {
  it('lit les anciens profils réguliers', () => {
    const s: Stroke = { paint: { type: 'solid', color: '#000' }, width: 4, profile: [1, 3, 1] };
    expect(profilePositions(s)).toEqual([0, 0.5, 1]);
    expect(strokeWidthAt(s, 0.5)).toBeCloseTo(3);
  });

  it('place les points de largeur où on veut', () => {
    const s: Stroke = {
      paint: { type: 'solid', color: '#000' },
      width: 10,
      profile: [1, 4, 1],
      profilePos: [0, 0.2, 1],
    };
    expect(strokeWidthAt(s, 0.2)).toBeCloseTo(4);
    expect(strokeWidthAt(s, 0.5)).toBeLessThan(4);
    expect(strokeWidthAt(s, 0.5)).toBeGreaterThan(1);
    // Positions qui ne vont pas avec le profil (profil prédéfini posé ensuite) : réparties.
    expect(strokeWidthAt({ ...s, profilePos: [0, 1] }, 0.5)).toBeCloseTo(4);
    // Le trait le plus épais se trouve au premier cinquième de la ligne.
    const line = createLine({ x: 0, y: 0, width: 100, height: 0 });
    const outline = widthProfileOutline(shapePath(line), s);
    const ys = outline.filter((c) => c.op !== 'Z') as { x: number; y: number }[];
    const top = ys.reduce((m, p) => (p.y < m.y ? p : m));
    expect(top.x).toBeCloseTo(20, 0);
    expect(top.y).toBeCloseTo(-20, 0);
  });
});
