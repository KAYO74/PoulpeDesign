import { describe, expect, it } from 'vitest';
import {
  applyBlend,
  blendOutlines,
  canBlend,
  createDocument,
  createEllipse,
  createRect,
  createText,
  findNode,
  roundRectPath,
  type GroupNode,
  type PathNode,
} from '../src';

describe('dégradé de formes', () => {
  it('fait glisser les nœuds quand les contours se ressemblent', () => {
    const a = roundRectPath(0, 0, 100, 100, 0);
    const b = roundRectPath(200, 0, 100, 100, 0);
    const [mid] = blendOutlines(a, b, 1);
    expect(mid[0]).toEqual({ op: 'M', x: 100, y: 0 });
  });

  it('redécoupe les contours différents en points correspondants', () => {
    const square = roundRectPath(0, 0, 100, 100, 0);
    const round = roundRectPath(300, 0, 100, 100, 50);
    const steps = blendOutlines(square, round, 3);
    expect(steps).toHaveLength(3);
    expect(steps[1].at(-1)).toEqual({ op: 'Z' });
    // À mi-chemin, la forme est entre les deux.
    const xs = steps[1].flatMap((c) => ('x' in c ? [c.x] : []));
    expect(Math.min(...xs)).toBeGreaterThan(100);
    expect(Math.max(...xs)).toBeLessThan(400);
  });

  it('regroupe les deux formes et les intermédiaires, couleurs en dégradé', () => {
    const doc = createDocument();
    const a = createRect({ x: 0, y: 0, width: 100, height: 100 });
    a.fill = { type: 'solid', color: '#000000' };
    const b = createEllipse({ x: 400, y: 0, width: 50, height: 50 });
    b.fill = { type: 'solid', color: '#ffffff' };
    doc.artboards[0].children.push(a, b);
    expect(canBlend(doc, [a.id])).toBe(false);
    expect(canBlend(doc, [a.id, b.id])).toBe(true);
    const id = applyBlend(doc, [a.id, b.id], 3, 'Dégradé de formes');
    const group = findNode(doc, id!)!.node as GroupNode;
    expect(group.children).toHaveLength(5);
    expect(group.children[0].id).toBe(a.id);
    expect(group.children[4].id).toBe(b.id);
    const mid = group.children[2] as PathNode;
    expect(mid.fill).toEqual({ type: 'solid', color: '#808080' });
    expect(mid.x).toBeGreaterThan(100);
  });

  it('refuse le texte', () => {
    const doc = createDocument();
    const a = createRect({ x: 0, y: 0, width: 100, height: 100 });
    const t = createText({ x: 0, y: 200, width: 100, height: 20, text: 'A' } as never);
    doc.artboards[0].children.push(a, t);
    expect(canBlend(doc, [a.id, t.id])).toBe(false);
  });
});
