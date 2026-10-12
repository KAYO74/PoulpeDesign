import { describe, expect, it } from 'vitest';
import {
  RegionFinder,
  applyKnifePath,
  applyShapeBuilder,
  applyVectorFill,
  booleanCommands,
  createDocument,
  createEllipse,
  createLine,
  createRect,
  curvePart,
  exactBounds,
  fillArea,
  findNode,
  fromSubpaths,
  parseSvgPath,
  pointOnSubpath,
  pressureProfile,
  ropeFollow,
  sculptSubpath,
  splitPieces,
  taperProfile,
  toSubpaths,
  worldOutline,
  type PathCommand,
  type PathNode,
  type SubPath,
} from '../src';

/* Outils de tracé de la version 1.2 : zones du constructeur de formes, remplissage de zone,
   cutter à main levée, profils de largeur (pression, effilement) et crayon en mode Sculpter. */

function square(x: number, y: number, s: number): PathCommand[] {
  return [
    { op: 'M', x, y },
    { op: 'L', x: x + s, y },
    { op: 'L', x: x + s, y: y + s },
    { op: 'L', x, y: y + s },
    { op: 'Z' },
  ];
}

function line(a: [number, number], b: [number, number]): PathCommand[] {
  return [
    { op: 'M', x: a[0], y: a[1] },
    { op: 'L', x: b[0], y: b[1] },
  ];
}

const area = (cmds: PathCommand[]) => {
  const b = exactBounds(cmds)!;
  return b.width * b.height;
};

/** Aire nette d'un contour fait de segments droits (les trous sont orientés à l'inverse). */
function polyArea(cmds: PathCommand[]): number {
  let sum = 0;
  for (const sp of toSubpaths(cmds)) {
    const a = sp.anchors;
    for (let i = 0; i < a.length; i++) {
      const p = a[i],
        q = a[(i + 1) % a.length];
      sum += p.x * q.y - q.x * p.y;
    }
  }
  return Math.abs(sum / 2);
}

describe('zones formées par des formes qui se chevauchent', () => {
  // Deux carrés de 100 qui se chevauchent sur 50 × 100.
  const shapes = [{ cmds: square(0, 0, 100) }, { cmds: square(50, 0, 100) }];

  it('la zone sous un point : intersection des formes qui le contiennent, moins les autres', () => {
    const f = new RegionFinder(shapes);
    const left = f.at({ x: 25, y: 50 })!;
    const mid = f.at({ x: 75, y: 50 })!;
    const right = f.at({ x: 125, y: 50 })!;
    expect(left.shapes).toEqual([0]);
    expect(mid.shapes).toEqual([0, 1]);
    expect(right.shapes).toEqual([1]);
    expect(exactBounds(left.cmds)).toMatchObject({ x: 0, width: 50 });
    expect(exactBounds(mid.cmds)).toMatchObject({ x: 50, width: 50 });
    expect(exactBounds(right.cmds)).toMatchObject({ x: 100, width: 50 });
    expect(f.at({ x: 300, y: 50 })).toBeNull();
    // Même zone, même identifiant (le survol ne recalcule rien).
    expect(f.at({ x: 70, y: 20 })!.id).toBe(mid.id);
  });

  it('une zone en deux morceaux : seul celui sous le point compte', () => {
    // Une barre verticale coupe le carré en deux : la zone « carré seul » a deux morceaux séparés.
    const tall: PathCommand[] = [
      { op: 'M', x: 40, y: -10 },
      { op: 'L', x: 50, y: -10 },
      { op: 'L', x: 50, y: 100 },
      { op: 'L', x: 40, y: 100 },
      { op: 'Z' },
    ];
    const g = new RegionFinder([{ cmds: square(0, 0, 90) }, { cmds: tall }]);
    const leftPart = g.at({ x: 10, y: 10 })!;
    expect(leftPart.shapes).toEqual([0]);
    const rightPart = g.at({ x: 80, y: 10 })!;
    expect(leftPart.id).not.toBe(rightPart.id);
    expect(exactBounds(leftPart.cmds)!.width).toBeCloseTo(40);
    expect(exactBounds(rightPart.cmds)!.width).toBeCloseTo(40);
  });

  it('sépare un contour en morceaux d’un seul tenant (un trou reste avec sa forme)', () => {
    const ring = [...square(0, 0, 100), ...square(25, 25, 50)];
    expect(splitPieces(ring, 'evenodd')).toHaveLength(1);
    const two = [...square(0, 0, 10), ...square(50, 0, 10)];
    expect(splitPieces(two)).toHaveLength(2);
  });
});

describe('constructeur de formes', () => {
  function twoRects() {
    const doc = createDocument();
    const a = createRect({ x: 0, y: 0, width: 100, height: 100 });
    const b = createRect({ x: 50, y: 0, width: 100, height: 100 });
    a.fill = { type: 'solid', color: '#ff0000' };
    b.fill = { type: 'solid', color: '#0000ff' };
    doc.artboards[0].children.push(a, b);
    return { doc, a, b };
  }

  it('Ajouter : les zones traversées deviennent une seule forme', () => {
    const { doc, a, b } = twoRects();
    const ids = applyShapeBuilder(
      doc,
      [a.id, b.id],
      [
        { x: 25, y: 50 },
        { x: 75, y: 50 },
        { x: 125, y: 50 },
      ],
      'add',
      'Courbe',
    )!;
    const kids = doc.artboards[0].children;
    expect(kids).toHaveLength(1);
    expect(ids).toEqual([kids[0].id]);
    expect(exactBounds(parseSvgPath((kids[0] as PathNode).d))).toMatchObject({ x: 0, width: 150 });
    // Le style vient de la forme du dessus dans la première zone touchée (ici, le rouge seul).
    expect((kids[0] as PathNode).fill).toEqual({ type: 'solid', color: '#ff0000' });
  });

  it('Ajouter une seule zone : elle devient une forme à part, retirée des originaux', () => {
    const { doc, a, b } = twoRects();
    const ids = applyShapeBuilder(doc, [a.id, b.id], [{ x: 75, y: 50 }], 'add', 'Courbe')!;
    const kids = doc.artboards[0].children;
    expect(kids).toHaveLength(3);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    const width = (id: string) => (findNode(doc, id)!.node as PathNode).width;
    expect(width(a.id)).toBeCloseTo(50);
    expect(width(b.id)).toBeCloseTo(50);
    // La nouvelle forme (l'intersection) est au-dessus, avec le style de la forme du dessus (le bleu).
    const created = kids[2] as PathNode;
    expect(created.width).toBeCloseTo(50);
    expect(created.fill).toEqual({ type: 'solid', color: '#0000ff' });
  });

  it('Soustraire : la zone disparaît des formes', () => {
    const { doc, a, b } = twoRects();
    applyShapeBuilder(doc, [a.id, b.id], [{ x: 75, y: 50 }], 'subtract', 'Courbe');
    const kids = doc.artboards[0].children as PathNode[];
    expect(kids).toHaveLength(2);
    expect(kids.map((k) => Math.round(k.width))).toEqual([50, 50]);
    expect(kids[0].x).toBeCloseTo(0);
    expect(kids[1].x).toBeCloseTo(100);
  });

  it('Soustraire toute une forme la supprime', () => {
    const { doc, a, b } = twoRects();
    const ids = applyShapeBuilder(
      doc,
      [a.id, b.id],
      [
        { x: 25, y: 50 },
        { x: 75, y: 50 },
      ],
      'subtract',
      'Courbe',
    )!;
    expect(ids).toEqual([b.id]);
    expect(doc.artboards[0].children).toHaveLength(1);
  });

  it('Créer : la zone devient une nouvelle forme, les originaux restent', () => {
    const { doc, a, b } = twoRects();
    const ids = applyShapeBuilder(doc, [a.id, b.id], [{ x: 125, y: 50 }], 'create', 'Courbe')!;
    const kids = doc.artboards[0].children;
    expect(kids).toHaveLength(3);
    expect(kids[0]).toBe(a);
    expect(kids[1]).toBe(b);
    expect((kids[2] as PathNode).x).toBeCloseTo(100);
    expect(ids).toEqual([a.id, b.id, kids[2].id]);
  });

  it('hors des formes : rien ne change', () => {
    const { doc, a, b } = twoRects();
    expect(applyShapeBuilder(doc, [a.id, b.id], [{ x: 500, y: 500 }], 'add', 'Courbe')).toBeNull();
    expect(doc.artboards[0].children).toHaveLength(2);
  });
});

describe('remplissage de zone vectoriel', () => {
  it('une zone fermée par quatre traits qui se croisent', () => {
    // Un dièse : deux traits verticaux, deux horizontaux.
    const lines = [
      line([30, 0], [30, 100]),
      line([70, 0], [70, 100]),
      line([0, 30], [100, 30]),
      line([0, 70], [100, 70]),
    ].map((open) => ({ closed: null, open }));
    const cmds = fillArea(lines, { x: 50, y: 50 })!;
    const b = exactBounds(cmds)!;
    expect(b.x).toBeCloseTo(30, 1);
    expect(b.y).toBeCloseTo(30, 1);
    expect(b.width).toBeCloseTo(40, 1);
    expect(b.height).toBeCloseTo(40, 1);
    // Entre deux traits seulement : la zone est ouverte.
    expect(fillArea(lines, { x: 50, y: 10 })).toBeNull();
  });

  it('une zone formée par des formes qui se chevauchent et un trait', () => {
    const obstacles = [
      { closed: { cmds: square(0, 0, 100) }, open: null },
      { closed: { cmds: square(50, 0, 100) }, open: null },
      { closed: null, open: line([60, -10], [60, 110]) },
    ];
    const cmds = fillArea(obstacles, { x: 80, y: 50 })!;
    const b = exactBounds(cmds)!;
    expect(b.x).toBeCloseTo(60, 1);
    expect(b.width).toBeCloseTo(40, 1);
    // Dehors : rien.
    expect(fillArea(obstacles, { x: 300, y: 50 })).toBeNull();
  });

  it('crée une forme remplie sous les traits qui la bordent', () => {
    const doc = createDocument();
    const ab = doc.artboards[0];
    for (const [a, b] of [
      [
        [100, 50],
        [100, 350],
      ],
      [
        [300, 50],
        [300, 350],
      ],
      [
        [50, 100],
        [350, 100],
      ],
      [
        [50, 300],
        [350, 300],
      ],
    ] as [number, number][][]) {
      const l = createLine({ x: a[0], y: a[1], width: b[0] - a[0], height: b[1] - a[1] });
      ab.children.push(l);
    }
    const id = applyVectorFill(doc, ab.id, { x: 200, y: 200 }, { type: 'solid', color: '#00ff00' }, 'Zone')!;
    expect(id).toBeTruthy();
    const n = ab.children[0] as PathNode;
    expect(n.id).toBe(id);
    expect(n.fill).toEqual({ type: 'solid', color: '#00ff00' });
    expect(n.stroke.paint.type).toBe('none');
    expect(n.width).toBeCloseTo(200, 0);
    expect(n.height).toBeCloseTo(200, 0);
    expect(
      applyVectorFill(doc, ab.id, { x: 600, y: 600 }, { type: 'solid', color: '#00ff00' }, 'Zone'),
    ).toBeNull();
  });

  it('des formes qui se chevauchent, de sens opposés, sont retirées comme une seule', () => {
    const reversed = (cmds: PathCommand[]) =>
      fromSubpaths([{ ...toSubpaths(cmds)[0], anchors: toSubpaths(cmds)[0].anchors.reverse() }]);
    const obstacles = [
      { closed: { cmds: square(0, 0, 400) }, open: null },
      { closed: { cmds: square(100, 100, 100) }, open: null },
      { closed: { cmds: reversed(square(150, 150, 100)) }, open: null },
    ];
    const cmds = fillArea(obstacles, { x: 350, y: 350 })!;
    expect(polyArea(cmds)).toBeCloseTo(400 * 400 - (100 * 100 * 2 - 50 * 50), -1);
  });

  it('le trou d’une forme pair-impair est une zone fermée', () => {
    const donut = { cmds: [...square(0, 0, 300), ...square(100, 100, 100)], fillRule: 'evenodd' as const };
    const cmds = fillArea([{ closed: donut, open: null }], { x: 150, y: 150 })!;
    const b = exactBounds(cmds)!;
    expect(b.x).toBeCloseTo(100, 1);
    expect(b.width).toBeCloseTo(100, 1);
  });

  it('reste rapide avec des centaines d’objets', () => {
    const doc = createDocument({ width: 2000, height: 2000 });
    const ab = doc.artboards[0];
    ab.children.push(createRect({ x: 0, y: 0, width: 2000, height: 2000 }));
    for (let i = 0; i < 300; i++)
      ab.children.push(
        createEllipse({ x: (i % 18) * 110 + 10, y: Math.floor(i / 18) * 110 + 10, width: 80, height: 80 }),
      );
    const t0 = performance.now();
    const id = applyVectorFill(doc, ab.id, { x: 105, y: 105 }, { type: 'solid', color: '#00ff00' }, 'Zone')!;
    // Une soustraction par objet prenait plusieurs secondes.
    expect(performance.now() - t0).toBeLessThan(3000);
    const n = findNode(doc, id)!.node as PathNode;
    expect(toSubpaths(parseSvgPath(n.d))).toHaveLength(301);
  });

  it('dans une forme pleine : la nouvelle forme se place au-dessus d’elle', () => {
    const doc = createDocument();
    const ab = doc.artboards[0];
    const e = createEllipse({ x: 0, y: 0, width: 200, height: 200 });
    const r = createRect({ x: 500, y: 500, width: 10, height: 10 });
    ab.children.push(e, r);
    const id = applyVectorFill(doc, ab.id, { x: 100, y: 100 }, { type: 'solid', color: '#00ff00' }, 'Zone')!;
    expect(ab.children.map((n) => n.id)).toEqual([e.id, id, r.id]);
    expect(area(parseSvgPath((ab.children[1] as PathNode).d))).toBeCloseTo(200 * 200, -2);
  });
});

describe('cutter à main levée', () => {
  it('une ligne brisée coupe un carré en deux morceaux', () => {
    const doc = createDocument();
    const r = createRect({ x: 0, y: 0, width: 100, height: 100 });
    doc.artboards[0].children.push(r);
    const ids = applyKnifePath(
      doc,
      [r.id],
      [
        { x: -10, y: 30 },
        { x: 50, y: 70 },
        { x: 110, y: 30 },
      ],
      'Courbe',
    )!;
    expect(ids).toHaveLength(2);
    const kids = doc.artboards[0].children as PathNode[];
    expect(kids).toHaveLength(2);
    const total = kids.reduce((s, k) => s + k.width * k.height, 0);
    expect(total).toBeGreaterThan(100 * 100);
  });

  it('les morceaux se touchent exactement et se réunissent en une forme', () => {
    for (const pts of [
      [
        { x: 600, y: -10 },
        { x: 600, y: 1210 },
      ],
      [
        { x: 600, y: -10 },
        { x: 650, y: 300 },
        { x: 560, y: 700 },
        { x: 640, y: 1210 },
      ],
    ]) {
      const doc = createDocument();
      const r = createRect({ x: 100, y: 100, width: 1000, height: 1000 });
      doc.artboards[0].children.push(r);
      expect(applyKnifePath(doc, [r.id], pts, 'Courbe')).toHaveLength(2);
      const kids = doc.artboards[0].children as PathNode[];
      if (pts.length === 2) {
        expect(kids[0].x + kids[0].width).toBeCloseTo(600, 4);
        expect(kids[1].x).toBeCloseTo(600, 4);
      }
      const united = booleanCommands(
        kids.map((k) => ({ cmds: worldOutline(k)! })),
        'unite',
      );
      expect(united).toHaveLength(1);
      expect(toSubpaths(united[0].cmds)).toHaveLength(1);
      expect(polyArea(united[0].cmds)).toBeCloseTo(1000 * 1000, -1);
    }
  });

  it('un zigzag qui traverse trois fois donne trois morceaux', () => {
    const doc = createDocument();
    const r = createRect({ x: 0, y: 0, width: 100, height: 100 });
    doc.artboards[0].children.push(r);
    // Entre par le haut, ressort en bas, rentre par le bas, ressort en haut.
    const ids = applyKnifePath(
      doc,
      [r.id],
      [
        { x: 30, y: -10 },
        { x: 30, y: 110 },
        { x: 70, y: 110 },
        { x: 70, y: -10 },
      ],
      'Courbe',
    )!;
    expect(ids).toHaveLength(3);
  });

  it('une coupe qui s’arrête dans la forme ne la coupe pas', () => {
    const doc = createDocument();
    const r = createRect({ x: 0, y: 0, width: 100, height: 100 });
    doc.artboards[0].children.push(r);
    expect(
      applyKnifePath(
        doc,
        [r.id],
        [
          { x: -10, y: 50 },
          { x: 50, y: 50 },
        ],
        'Courbe',
      ),
    ).toBeNull();
    expect(doc.artboards[0].children[0]).toBe(r);
  });

  it('un tracé ouvert est séparé à chaque croisement', () => {
    const doc = createDocument();
    const l = createLine({ x: 0, y: 50, width: 200, height: 0 });
    doc.artboards[0].children.push(l);
    const ids = applyKnifePath(
      doc,
      [l.id],
      [
        { x: 50, y: 0 },
        { x: 100, y: 100 },
        { x: 150, y: 0 },
      ],
      'Courbe',
    )!;
    expect(ids).toHaveLength(1);
    const p = findNode(doc, ids[0])!.node as PathNode;
    expect(toSubpaths(parseSvgPath(p.d))).toHaveLength(3);
  });
});

describe('profils de largeur du crayon et du pinceau vectoriel', () => {
  it('la pression devient un profil réparti sur la longueur', () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }));
    const pressures = pts.map((_, i) => i / 10);
    const prof = pressureProfile(pts, pressures, 11)!;
    expect(prof).toHaveLength(11);
    expect(prof[0]).toBeLessThan(0.15);
    expect(prof[10]).toBeGreaterThan(0.9);
    expect(prof[5]).toBeCloseTo(0.5, 1);
    // Pleine pression partout : épaisseur constante.
    expect(
      pressureProfile(
        pts,
        pts.map(() => 1),
      ),
    ).toBeNull();
  });

  it('effilement au début et à la fin', () => {
    const p = taperProfile(0.2, 0.2, 11)!;
    expect(p[0]).toBeCloseTo(0.05);
    expect(p[5]).toBe(1);
    expect(p[10]).toBeCloseTo(0.05);
    expect(taperProfile(0, 0)).toBeNull();
  });

  it('le stabilisateur à corde ne suit qu’au-delà de la longueur de corde', () => {
    expect(ropeFollow({ x: 0, y: 0 }, { x: 5, y: 0 }, 10)).toBeNull();
    expect(ropeFollow({ x: 0, y: 0 }, { x: 25, y: 0 }, 10)).toEqual({ x: 15, y: 0 });
  });
});

describe('crayon en mode Sculpter', () => {
  const open: SubPath = {
    closed: false,
    anchors: [
      { x: 0, y: 0, in: null, out: null },
      { x: 100, y: 0, in: null, out: null },
      { x: 200, y: 0, in: null, out: null },
    ],
  };
  const drawn = (pts: [number, number][]) => pts.map(([x, y]) => ({ x, y, in: null, out: null }));

  it('un morceau de courbe entre deux positions', () => {
    const part = curvePart(open, 0.5, 1.5);
    expect(part.map((a) => [a.x, a.y])).toEqual([
      [50, 0],
      [100, 0],
      [150, 0],
    ]);
    expect(pointOnSubpath(open, 2)).toEqual({ x: 200, y: 0 });
  });

  it('parti de l’extrémité : le trait prolonge le tracé', () => {
    const r = sculptSubpath(
      open,
      2,
      null,
      drawn([
        [201, 1],
        [250, 50],
      ]),
    )!;
    expect(r.closed).toBe(false);
    expect(r.anchors.map((a) => [a.x, a.y])).toEqual([
      [0, 0],
      [100, 0],
      [200, 0],
      [250, 50],
    ]);
  });

  it('prolongé jusqu’à l’autre extrémité : le tracé se ferme', () => {
    const r = sculptSubpath(
      open,
      2,
      0,
      drawn([
        [200, 0],
        [100, 80],
        [1, 1],
      ]),
    )!;
    expect(r.closed).toBe(true);
    expect(r.anchors).toHaveLength(4);
  });

  it('parti de la courbe et revenu dessus : le morceau entre les deux est remplacé', () => {
    const r = sculptSubpath(
      open,
      0.5,
      1.5,
      drawn([
        [50, 0],
        [100, -60],
        [150, 0],
      ]),
    )!;
    expect(r.anchors.map((a) => [a.x, a.y])).toEqual([
      [0, 0],
      [50, 0],
      [100, -60],
      [150, 0],
      [200, 0],
    ]);
    // Dessiné dans l'autre sens : même résultat.
    const back = sculptSubpath(
      open,
      1.5,
      0.5,
      drawn([
        [150, 0],
        [100, -60],
        [50, 0],
      ]),
    )!;
    expect(back.anchors.map((a) => [a.x, a.y])).toEqual(r.anchors.map((a) => [a.x, a.y]));
  });

  it('sur un tracé fermé, le plus court des deux arcs est remplacé', () => {
    const sq: SubPath = toSubpaths(square(0, 0, 100))[0];
    const r = sculptSubpath(
      sq,
      0.5,
      1.5,
      drawn([
        [50, 0],
        [150, -50],
        [100, 50],
      ]),
    )!;
    expect(r.closed).toBe(true);
    const b = exactBounds(fromSubpaths([r]))!;
    expect(b.y).toBe(-50);
    expect(b.width).toBe(150);
    // Le coin (100, 0) a disparu, les trois autres restent.
    const pts = r.anchors.map((a) => `${a.x},${a.y}`);
    expect(pts).not.toContain('100,0');
    expect(pts).toContain('100,100');
    expect(pts).toContain('0,100');
    expect(pts).toContain('0,0');
    // Quitté sans y revenir : pas de sculpture.
    expect(
      sculptSubpath(
        sq,
        0.5,
        null,
        drawn([
          [50, 0],
          [50, -50],
        ]),
      ),
    ).toBeNull();
  });
});
