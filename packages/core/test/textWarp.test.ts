import { describe, expect, it } from 'vitest';
import { parseSvgPath, warpPath } from '../src';

describe('déformation du texte', () => {
  it('un arc vers le haut monte au milieu, vers le bas descend', () => {
    const up = warpPath({ kind: 'arc', bend: 1 }, 200);
    const down = warpPath({ kind: 'arc', bend: -1 }, 200);
    expect(up.height).toBe(100);
    expect(up.d).toBe('M0 100 Q100 -100 200 100');
    expect(down.d).toBe('M0 0 Q100 200 200 0');
    expect(parseSvgPath(up.d).length).toBe(2);
  });

  it('sans courbure, la courbe reste plate et la boîte garde une hauteur', () => {
    const flat = warpPath({ kind: 'arc', bend: 0 }, 200);
    expect(flat.height).toBe(1);
    expect(warpPath({ kind: 'wave', bend: 0 }, 200).height).toBe(1);
  });

  it('une vague a deux demi-ondes de sens contraire', () => {
    const w = warpPath({ kind: 'wave', bend: 1 }, 400);
    expect(w.d.match(/Q/g)?.length).toBe(2);
    expect(parseSvgPath(w.d).length).toBe(3);
    expect(w.height).toBeCloseTo(96);
  });

  it('cercle : le tour fait un peu plus que le texte ; montée : une droite', async () => {
    const { measurePath } = await import('../src');
    const c = warpPath({ kind: 'circle', bend: 1 }, 314.16);
    expect(c.height).toBeCloseTo(110, 0);
    expect(measurePath(parseSvgPath(c.d)).length).toBeCloseTo(345.6, -1);
    expect(warpPath({ kind: 'circle', bend: 0.5 }, 314.16).height).toBeCloseTo(220, 0);
    const r = warpPath({ kind: 'rise', bend: 1 }, 200);
    expect(r.d).toBe('M0 100 L200 0');
  });
});
