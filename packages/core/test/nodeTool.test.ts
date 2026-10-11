import { describe, expect, it } from 'vitest';
import {
  breakAtAnchors,
  cubicPoint,
  deleteSegment,
  fitDeleteAnchors,
  insertAnchor,
  joinEnds,
  markSmart,
  refreshSmart,
  reverseSubpaths,
  segmentCubic,
  setAnchorKind,
  smoothSubpaths,
  smartMarks,
  splitAfterAnchors,
  straightenSegment,
  type SubPath,
} from '../src';

/* Actions de l'outil Nœud, comme dans Affinity. */

const open = (): SubPath[] => [
  {
    closed: false,
    anchors: [
      { x: 0, y: 0, in: null, out: null },
      { x: 100, y: 0, in: null, out: null },
      { x: 100, y: 100, in: null, out: null },
    ],
  },
];
const square = (): SubPath[] => [
  {
    closed: true,
    anchors: [
      { x: 0, y: 0, in: null, out: null },
      { x: 100, y: 0, in: null, out: null },
      { x: 100, y: 100, in: null, out: null },
      { x: 0, y: 100, in: null, out: null },
    ],
  },
];

describe('outil Nœud', () => {
  it('casse un tracé ouvert en deux et le rejoint', () => {
    const parts = breakAtAnchors(open(), ['0:1']);
    expect(parts).toHaveLength(2);
    expect(parts[0].anchors.at(-1)).toMatchObject({ x: 100, y: 0 });
    expect(parts[1].anchors[0]).toMatchObject({ x: 100, y: 0 });
    const joined = joinEnds(parts, '0:1', '1:0')!;
    expect(joined).toHaveLength(1);
    expect(joined[0].anchors).toHaveLength(3);
  });

  it('ouvre un tracé fermé au nœud cassé', () => {
    const [sp] = breakAtAnchors(square(), ['0:2']);
    expect(sp.closed).toBe(false);
    expect(sp.anchors).toHaveLength(5);
    expect(sp.anchors[0]).toMatchObject({ x: 100, y: 100 });
    expect(sp.anchors[4]).toMatchObject({ x: 100, y: 100 });
  });

  it('supprime un segment et en redresse un autre', () => {
    const [sp] = deleteSegment(square(), 0, 3);
    expect(sp.closed).toBe(false);
    expect(sp.anchors.map((a) => a.x)).toEqual([0, 100, 100, 0]);
    expect(deleteSegment(open(), 0, 0)).toHaveLength(1);
    const curved = open();
    curved[0].anchors[0].out = { x: 30, y: -30 };
    straightenSegment(curved, 0, 0);
    expect(curved[0].anchors[0].out).toBeNull();
  });

  it('scinde le segment après le nœud et inverse le tracé', () => {
    const sps = open();
    const added = splitAfterAnchors(sps, ['0:0']);
    expect(sps[0].anchors[1]).toMatchObject({ x: 50, y: 0 });
    expect(added.has(sps[0].anchors[1])).toBe(true);
    reverseSubpaths(sps, [0]);
    expect(sps[0].anchors[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('garde la forme en supprimant un nœud', () => {
    // Un quart de cercle coupé en deux : supprimer le nœud du milieu garde presque la même courbe.
    const k = 0.5523 * 100;
    const sps: SubPath[] = [
      {
        closed: false,
        anchors: [
          { x: 100, y: 0, in: null, out: { x: 100, y: k } },
          { x: 0, y: 100, in: { x: k, y: 100 }, out: null },
        ],
      },
    ];
    const mid = insertAnchor(sps, 0, 0, 0.5);
    const [sp] = fitDeleteAnchors(sps, [mid]);
    expect(sp.anchors).toHaveLength(2);
    const p = cubicPoint(segmentCubic(sp, 0), 0.5);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 0);
  });

  it('les nœuds intelligents suivent leurs voisins et restent dans le document', () => {
    const sps = open();
    setAnchorKind(sps, ['0:1'], 'smart');
    const before = { ...sps[0].anchors[1].out! };
    sps[0].anchors[2].x = 200;
    refreshSmart(sps);
    expect(sps[0].anchors[1].out).not.toEqual(before);
    const marks = smartMarks(sps);
    expect(marks).toEqual([{ x: 100, y: 0 }]);
    const again = markSmart(open(), marks);
    expect(again[0].anchors[1].smart).toBe(true);
  });

  it('lisse une courbe : elle devient arrondie', () => {
    const [sp] = smoothSubpaths(square(), [0], 2);
    expect(sp.closed).toBe(true);
    expect(sp.anchors.some((a) => a.in || a.out)).toBe(true);
  });

  it('garde la forme d’un cercle quand on supprime son dernier nœud', () => {
    const k = 0.5523 * 100;
    const circle: SubPath[] = [
      {
        closed: true,
        anchors: [
          { x: 100, y: 0, in: { x: 100, y: -k }, out: { x: 100, y: k } },
          { x: 0, y: 100, in: { x: k, y: 100 }, out: { x: -k, y: 100 } },
          { x: -100, y: 0, in: { x: -100, y: k }, out: { x: -100, y: -k } },
          { x: 0, y: -100, in: { x: -k, y: -100 }, out: { x: k, y: -100 } },
        ],
      },
    ];
    const [sp] = fitDeleteAnchors(circle, ['0:3']);
    expect(sp.anchors).toHaveLength(3);
    const p = cubicPoint(segmentCubic(sp, 2), 0.5);
    expect(p.y).toBeLessThan(-60);
  });
});
