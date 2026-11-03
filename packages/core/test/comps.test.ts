import { describe, expect, it } from 'vitest';
import { addComp, applyComp, createDocument, createRect, removeComp, updateComp } from '../src';

describe('variantes de calques', () => {
  it('rappelle visibilité, opacité et position', () => {
    const doc = createDocument();
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const b = createRect({ x: 5, y: 5, width: 10, height: 10 });
    doc.artboards[0].children = [a, b];
    const one = addComp(doc, 'A');
    a.visible = false;
    b.x = 50;
    b.opacity = 0.3;
    const two = addComp(doc, 'B');
    applyComp(doc, one);
    expect([a.visible, b.x, b.opacity]).toEqual([true, 5, 1]);
    applyComp(doc, two);
    expect([a.visible, b.x, b.opacity]).toEqual([false, 50, 0.3]);
    b.x = 70;
    updateComp(doc, two);
    applyComp(doc, one);
    applyComp(doc, two);
    expect(b.x).toBe(70);
    removeComp(doc, one);
    expect(doc.comps).toHaveLength(1);
  });
  it('ne touche pas aux objets ajoutés depuis', () => {
    const doc = createDocument();
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 });
    doc.artboards[0].children = [a];
    const id = addComp(doc, 'A');
    const c = createRect({ x: 1, y: 1, width: 4, height: 4 });
    doc.artboards[0].children.push(c);
    c.visible = false;
    applyComp(doc, id);
    expect(c.visible).toBe(false);
  });
});
