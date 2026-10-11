import { describe, expect, it } from 'vitest';
import {
  Editor,
  NONE,
  applyAffine,
  applyPickedStyle,
  artboardToSvg,
  createDocument,
  createEllipse,
  createGroup,
  createLine,
  createRect,
  createText,
  decodePoulpe,
  dragBoxHandle,
  encodePoulpe,
  findNode,
  groupNodes,
  isVectorCrop,
  nodeBounds,
  nodesAt,
  objectBehind,
  pickStyle,
  powerDuplicate,
  removeVectorCrop,
  repeatTransform,
  rotateNode,
  setVectorCrop,
  transformBetween,
  translateNode,
  vectorCropFrame,
  type GroupNode,
  type PoulpeDocument,
  type SceneNode,
} from '../src';

/* Version 1.2 : outil Déplacer, Recadrage vectoriel et Pipette de style. */

function docWith(...nodes: SceneNode[]): PoulpeDocument {
  const doc = createDocument({ width: 1000, height: 1000 });
  doc.artboards[0].children.push(...nodes);
  return doc;
}

const names = { group: 'Recadrage', mask: 'Cadre' };

describe('sélection automatique et objet de dessous', () => {
  const build = () => {
    const back = createRect({ x: 0, y: 0, width: 400, height: 400, name: 'fond' });
    const a = createRect({ x: 100, y: 100, width: 100, height: 100, name: 'a' });
    const b = createEllipse({ x: 120, y: 120, width: 100, height: 100, name: 'b' });
    const inner = createGroup([a, b], 'inner');
    const outer = createGroup([inner], 'outer');
    const doc = docWith(back, outer);
    return { doc, back, a, b, inner, outer };
  };

  it('choisit l’objet du plan de travail, le groupe le plus proche ou l’objet lui-même', () => {
    const { doc, back, b, inner, outer } = build();
    const p = { x: 150, y: 150 };
    expect(nodesAt(doc, p, 0, 'layer').map((n) => n.id)).toEqual([outer.id, back.id]);
    expect(nodesAt(doc, p, 0, 'group').map((n) => n.id)).toEqual([inner.id, back.id]);
    expect(nodesAt(doc, p, 0, 'object').map((n) => n.name)).toEqual(['b', 'a', 'fond']);
    expect(nodesAt(doc, { x: 2000, y: 2000 }, 0, 'object')).toEqual([]);
    void b;
  });

  it('un objet recadré se choisit d’un bloc', () => {
    const { doc, a } = build();
    setVectorCrop(doc, [a.id], { x: 100, y: 100, width: 50, height: 50, rotation: 0 }, 'crop1', names);
    const hits = nodesAt(doc, { x: 120, y: 120 }, 0, 'object').map((n) => n.id);
    expect(hits[0]).toBe('crop1');
  });

  it('Alt + clic descend d’un objet à chaque clic, puis revient au premier', () => {
    const { doc } = build();
    const stack = nodesAt(doc, { x: 150, y: 150 }, 0, 'object');
    const [b, a, back] = stack;
    expect(objectBehind(stack, [])?.id).toBe(a.id);
    expect(objectBehind(stack, [b.id])?.id).toBe(a.id);
    expect(objectBehind(stack, [a.id])?.id).toBe(back.id);
    expect(objectBehind(stack, [back.id])?.id).toBe(b.id);
    expect(objectBehind([b], [])?.id).toBe(b.id);
    expect(objectBehind([], [])).toBeNull();
  });
});

describe('duplication intelligente', () => {
  it('répète un déplacement', () => {
    const src = createRect({ x: 0, y: 0, width: 50, height: 20 });
    const copy = structuredClone(src);
    translateNode(copy, 100, 10);
    const t = transformBetween(src, copy)!;
    const next = repeatTransform(src, copy, t);
    expect(next.id).not.toBe(copy.id);
    expect(next.x).toBeCloseTo(200);
    expect(next.y).toBeCloseTo(20);
    expect(next.width).toBeCloseTo(50);
  });

  it('répète une rotation autour d’un point : les copies tournent en cercle', () => {
    const src = createRect({ x: 90, y: 0, width: 20, height: 20 });
    const copy = structuredClone(src);
    rotateNode(copy, 90, { x: 100, y: 100 });
    const t = transformBetween(src, copy)!;
    const next = repeatTransform(src, copy, t);
    const c = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
    // Centre de départ (100, 10) → (190, 100) → (100, 190).
    expect(c.x).toBeCloseTo(100);
    expect(c.y).toBeCloseTo(190);
    expect(Math.abs(next.rotation)).toBeCloseTo(180);
  });

  it('répète une mise à l’échelle et le changement de taille des textes', () => {
    const src = createText({ x: 0, y: 0, width: 100, height: 40, name: 't', autoWidth: true });
    const copy = structuredClone(src);
    copy.width = 200;
    copy.height = 80;
    copy.x = 0;
    copy.style = { ...copy.style, fontSize: copy.style.fontSize * 2 };
    const t = transformBetween(src, copy)!;
    const next = repeatTransform(src, copy, t);
    expect(next.width).toBeCloseTo(400);
    expect(next.height).toBeCloseTo(160);
    expect(next.type === 'text' && next.style.fontSize).toBeCloseTo(src.style.fontSize * 4);
  });

  it('une ligne horizontale (hauteur nulle) se répète', () => {
    const src = createLine({ x: 0, y: 0, width: 100, height: 0, direction: 1 });
    const copy = structuredClone(src);
    translateNode(copy, 0, 30);
    const next = repeatTransform(src, copy, transformBetween(src, copy)!);
    expect(next.y).toBeCloseTo(60);
    expect(next.height).toBe(0);
    expect(next.width).toBeCloseTo(100);
  });

  it('dans le document, chaque copie va juste au-dessus de son modèle', () => {
    const a = createRect({ x: 0, y: 0, width: 10, height: 10, name: 'a' });
    const b = createRect({ x: 0, y: 0, width: 10, height: 10, name: 'b' });
    const ca = structuredClone(a);
    ca.id = 'ca';
    translateNode(ca, 30, 0);
    const doc = docWith(a, ca, b);
    const editor = new Editor(doc);
    const copies = ['ca'];
    const out: { ids: string[] | null } = { ids: null };
    editor.apply('history.duplicate', (d) => {
      out.ids = powerDuplicate(d, [a.id], copies);
      return out.ids ?? undefined;
    });
    expect(out.ids).toHaveLength(1);
    const kids = editor.doc.artboards[0].children;
    expect(kids.map((n) => n.name)).toEqual(['a', 'a', 'a', 'b']);
    expect(kids[2].x).toBeCloseTo(60);
    expect(powerDuplicate(editor.doc, ['nope'], copies)).toBeNull();
  });

  it('applique une transformation à un groupe, objet par objet', () => {
    const g = createGroup([
      createRect({ x: 0, y: 0, width: 10, height: 10 }),
      createRect({ x: 20, y: 0, width: 10, height: 10 }),
    ]);
    applyAffine(g, { a: 1, b: 0, c: 0, d: 1, e: 5, f: 7 });
    expect(g.children[1].x).toBeCloseTo(25);
    expect(g.children[1].y).toBeCloseTo(7);
  });
});

describe('poignées d’une boîte (plan de travail)', () => {
  const b = { x: 0, y: 0, width: 200, height: 100 };
  it('coin, bord, proportions et centre', () => {
    expect(dragBoxHandle(b, 1, 1, { x: 300, y: 150 }, false, false)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 150,
    });
    // Bord gauche : seule la largeur change, le bord droit reste en place.
    expect(dragBoxHandle(b, 0, 0.5, { x: -50, y: 999 }, false, false)).toEqual({
      x: -50,
      y: 0,
      width: 250,
      height: 100,
    });
    // Maj : proportions gardées (la plus grande échelle l'emporte).
    expect(dragBoxHandle(b, 1, 1, { x: 400, y: 110 }, true, false)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
    // Ctrl : depuis le centre.
    expect(dragBoxHandle(b, 1, 0.5, { x: 150, y: 0 }, false, true)).toEqual({
      x: 50,
      y: 0,
      width: 100,
      height: 100,
    });
    // On peut passer de l'autre côté du bord fixe ; taille minimale de 1.
    expect(dragBoxHandle(b, 1, 0.5, { x: -20, y: 0 }, false, false).x).toBe(-20);
    expect(dragBoxHandle(b, 1, 0.5, { x: 0, y: 0 }, false, false).width).toBe(1);
  });
});

describe('recadrage vectoriel', () => {
  it('découpe un objet sans le modifier, s’exporte et se retire', () => {
    const e = createEllipse({ x: 100, y: 100, width: 200, height: 200, name: 'rond' });
    const doc = docWith(e);
    expect(vectorCropFrame(doc, [e.id])).toEqual({ x: 100, y: 100, width: 200, height: 200, rotation: 0 });
    const editor = new Editor(doc);
    editor.apply('history.vectorCrop', (d) => {
      const id = setVectorCrop(
        d,
        [e.id],
        { x: 100, y: 100, width: 100, height: 200, rotation: 0 },
        'vc',
        names,
      );
      return id ? [id] : undefined;
    });
    let g = editor.doc.artboards[0].children[0] as GroupNode;
    expect(isVectorCrop(g)).toBe(true);
    expect(g.id).toBe('vc');
    expect(g.children[1]).toMatchObject({ id: e.id, width: 200 });
    expect(g.children[0]).toMatchObject({ width: 100, height: 200, fill: NONE });
    // La boîte du groupe est celle du cadre : on ne voit (et ne touche) que la partie gardée.
    expect(nodeBounds(g)).toEqual({ x: 100, y: 100, width: 100, height: 200 });
    expect(vectorCropFrame(editor.doc, ['vc'])).toMatchObject({ width: 100, height: 200 });

    // Un deuxième réglage change seulement le cadre.
    editor.apply('history.vectorCrop', (d) => {
      setVectorCrop(d, ['vc'], { x: 120, y: 100, width: 80, height: 150, rotation: 0 }, 'other', names);
    });
    g = editor.doc.artboards[0].children[0] as GroupNode;
    expect(g.id).toBe('vc');
    expect(g.children).toHaveLength(2);
    expect(g.children[0]).toMatchObject({ x: 120, width: 80, height: 150 });

    // Export SVG (et donc PDF) : un chemin de découpe autour du contenu.
    const svg = artboardToSvg(editor.doc, editor.doc.artboards[0]);
    expect(svg).toContain('<clipPath');
    expect(svg).toMatch(/clip-path="url\(#/);

    // Enregistrement et relecture.
    const back = decodePoulpe(encodePoulpe(editor.doc));
    expect(isVectorCrop(back.artboards[0].children[0])).toBe(true);

    // Réinitialiser : l'objet retrouve sa place, entier.
    let ids: string[] = [];
    editor.apply('history.vectorCrop', (d) => (ids = removeVectorCrop(d, 'vc')));
    expect(ids).toEqual([e.id]);
    expect(editor.doc.artboards[0].children).toHaveLength(1);
    expect(editor.doc.artboards[0].children[0]).toMatchObject({ id: e.id, x: 100, width: 200 });
  });

  it('recadre plusieurs objets ensemble, et un objet dans un groupe', () => {
    const a = createRect({ x: 0, y: 0, width: 50, height: 50 });
    const b = createRect({ x: 100, y: 0, width: 50, height: 50 });
    const doc = docWith(a, b);
    expect(vectorCropFrame(doc, [a.id, b.id])).toEqual({ x: 0, y: 0, width: 150, height: 50, rotation: 0 });
    setVectorCrop(doc, [a.id, b.id], { x: 0, y: 0, width: 120, height: 50, rotation: 0 }, 'vc', names);
    const g = doc.artboards[0].children[0] as GroupNode;
    expect(g.children.map((n) => n.id)).toEqual([g.children[0].id, a.id, b.id]);

    const c = createRect({ x: 0, y: 0, width: 50, height: 50 });
    const d = createRect({ x: 60, y: 0, width: 50, height: 50 });
    const doc2 = docWith(c, d);
    groupNodes(doc2, [c.id, d.id], createGroup([], 'G'));
    setVectorCrop(doc2, [d.id], { x: 60, y: 0, width: 20, height: 50, rotation: 0 }, 'vc2', names);
    expect(findNode(doc2, 'vc2')?.parent).toMatchObject({ type: 'group', name: 'G' });
  });

  it('suit la rotation d’un objet tourné', () => {
    const r = createRect({ x: 0, y: 0, width: 100, height: 50 });
    r.rotation = 30;
    const doc = docWith(r);
    expect(vectorCropFrame(doc, [r.id])?.rotation).toBe(30);
  });
});

describe('pipette de style', () => {
  it('prend le style d’un objet et en applique les parties choisies', () => {
    const src = createRect({ x: 0, y: 0, width: 10, height: 10 });
    src.fill = { type: 'solid', color: '#ff0000' };
    src.stroke = { paint: { type: 'solid', color: '#0000ff' }, width: 6 };
    src.opacity = 0.5;
    src.effects = [{ type: 'blur', enabled: true, radius: 3 }];
    const style = pickStyle(src);

    const target = createEllipse({ x: 0, y: 0, width: 10, height: 10 });
    target.effects = [{ type: 'outerGlow', enabled: true, color: '#fff', blur: 2 }];
    applyPickedStyle(target, style, { fill: true, stroke: false, effects: false, text: true });
    expect(target.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(target.stroke.width).not.toBe(6);
    expect(target.opacity).toBe(1);
    expect(target.effects?.[0].type).toBe('outerGlow');

    applyPickedStyle(target, style, { fill: false, stroke: true, effects: true, text: false });
    expect(target.stroke.width).toBe(6);
    expect(target.opacity).toBe(0.5);
    expect(target.effects).toEqual([{ type: 'blur', enabled: true, radius: 3 }]);

    // Un modèle sans effets retire ceux de l'objet.
    const plain = pickStyle(createRect({ x: 0, y: 0, width: 1, height: 1 }));
    applyPickedStyle(target, plain, { fill: false, stroke: false, effects: true, text: false });
    expect(target.effects).toBeUndefined();
  });

  it('copie les réglages de texte d’un texte à l’autre', () => {
    const a = createText({ x: 0, y: 0, width: 100, height: 20, autoWidth: true });
    a.style = { ...a.style, fontFamily: 'Lora', fontSize: 40, italic: true };
    const b = createText({ x: 0, y: 0, width: 100, height: 20, autoWidth: true });
    b.runs = [{ start: 0, end: 1, style: { fontWeight: 700 } }];
    applyPickedStyle(b, pickStyle(a), { fill: false, stroke: false, effects: false, text: true });
    expect(b.style).toMatchObject({ fontFamily: 'Lora', fontSize: 40, italic: true });
    expect(b.runs).toEqual([]);
    // Sans la partie Texte, le texte garde ses réglages.
    const c = createText({ x: 0, y: 0, width: 100, height: 20, autoWidth: true });
    applyPickedStyle(c, pickStyle(a), { fill: true, stroke: true, effects: true, text: false });
    expect(c.style.fontFamily).not.toBe('Lora');
  });
});
