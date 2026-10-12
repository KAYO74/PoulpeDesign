import { describe, expect, it } from 'vitest';
import { freeze, produce } from 'immer';
import {
  Editor,
  applyStyle,
  approximateMeasure,
  artboardToSvg,
  createArtboard,
  createDocument,
  createEllipse,
  createGroup,
  createRect,
  createText,
  defaultEffect,
  effectMargin,
  findNode,
  findNodes,
  isClosedShape,
  isVectorCrop,
  shapePath,
  pathNodeFromWorld,
  resizeArtboard,
  setVectorCrop,
  styleFromNode,
  styledChildren,
  toPathNode,
  topLevelIds,
  untouched,
  type GroupNode,
  type PoulpeDocument,
  type SceneNode,
  type TextFlow,
  type TextNode,
  type Transparency,
} from '../src';

/* Version 1.2 : corrections de la relecture d'ensemble (cœur). */

function docWith(...nodes: SceneNode[]): PoulpeDocument {
  const doc = createDocument({ width: 1000, height: 1000 });
  doc.artboards[0].children.push(...nodes);
  return doc;
}

const fade: Transparency = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, opacity: 1 },
    { offset: 1, opacity: 0 },
  ],
};

describe('aperçu passager de l’éditeur', () => {
  const setup = () => {
    const r = createRect({ x: 0, y: 0, width: 100, height: 100 });
    const ed = new Editor(docWith(r));
    const rotate = (d: PoulpeDocument) => {
      findNode(d, r.id)!.node.rotation = 30;
    };
    return { ed, r, rotate };
  };
  const node = (ed: Editor, id: string) => findNode(ed.doc, id)!.node;

  it('reste affiché quand une commande passe, sans entrer dans l’historique', () => {
    const { ed, r, rotate } = setup();
    ed.preview(rotate, { transient: true });
    ed.apply('history.opacity', (d) => {
      findNode(d, r.id)!.node.opacity = 0.5;
    });
    expect(node(ed, r.id).rotation).toBe(30);
    expect(node(ed, r.id).opacity).toBe(0.5);
    expect(ed.inGesture).toBe(true);
    expect(ed.getState().history.filter((l) => l === 'history.opacity')).toHaveLength(1);
    // Annuler retire d'abord l'aperçu, puis la commande.
    ed.undo();
    expect(node(ed, r.id).rotation).toBe(0);
    expect(node(ed, r.id).opacity).toBe(0.5);
    ed.undo();
    expect(node(ed, r.id).opacity).toBe(1);
  });

  it('revient après un autre geste, et s’enregistre seul à sa validation', () => {
    const { ed, r, rotate } = setup();
    ed.preview(rotate, { transient: true });
    ed.begin();
    ed.preview((d) => {
      findNode(d, r.id)!.node.x = 50;
    });
    expect(node(ed, r.id).rotation).toBe(0);
    ed.commit('history.move');
    expect(node(ed, r.id).x).toBe(50);
    expect(node(ed, r.id).rotation).toBe(30);
    ed.commit('history.crop');
    expect(ed.inGesture).toBe(false);
    ed.undo();
    expect(node(ed, r.id).rotation).toBe(0);
    expect(node(ed, r.id).x).toBe(50);
  });
});

describe('transparence et habillage gardés par les conversions et les styles', () => {
  it('en courbes, en tracé booléen et dans un style enregistré', () => {
    const e = createEllipse({ x: 0, y: 0, width: 100, height: 60 });
    e.transparency = fade;
    e.wrap = { type: 'square', distance: 8 };
    const path = toPathNode(e)!;
    expect(path.transparency?.stops[1].opacity).toBe(0);
    expect(path.wrap?.distance).toBe(8);
    const merged = pathNodeFromWorld(shapePath(e), e, 'fusion');
    expect(merged.transparency?.type).toBe('linear');
    expect(merged.wrap?.type).toBe('square');
    const style = styleFromNode(e, 'fondu');
    const target = createRect({ x: 0, y: 0, width: 10, height: 10 });
    expect(applyStyle(target, style)).toBe(true);
    expect(target.transparency?.stops).toEqual(fade.stops);
  });
});

describe('contour et effets', () => {
  it('la zone du filtre SVG couvre le décalage de l’outil Contour', () => {
    const r = createRect({ x: 100, y: 100, width: 100, height: 100 });
    r.contour = { radius: 30, join: 'round', miterLimit: 4 };
    r.effects = [defaultEffect('dropShadow')];
    const doc = docWith(r);
    const svg = artboardToSvg(doc, doc.artboards[0]);
    const m = svg.match(/<filter id="fx\d+" filterUnits="userSpaceOnUse" x="([-\d.]+)" y="([-\d.]+)"/)!;
    expect(Number(m[1])).toBeLessThanOrEqual(100 - 30 - effectMargin(r.effects));
    expect(Number(m[2])).toBeLessThanOrEqual(100 - 30 - effectMargin(r.effects));
  });
});

describe('mise à l’échelle d’une page', () => {
  it('fait suivre habillage, contour, marges et gouttière des textes', () => {
    const r = createRect({ x: 100, y: 100, width: 200, height: 200 });
    r.wrap = { type: 'square', distance: 10 };
    r.contour = { radius: 6, join: 'round', miterLimit: 4 };
    const t = createText({ x: 400, y: 400, width: 200, height: 100, text: 'abc', autoWidth: false });
    t.frame = true;
    t.insets = [4, 4, 4, 4];
    t.style = { ...t.style, columns: { count: 2, gap: 20 } };
    const doc = docWith(r, t);
    resizeArtboard(doc.artboards[0], 500, 500);
    expect(r.wrap.distance).toBeCloseTo(5);
    expect(r.contour.radius).toBeCloseTo(3);
    expect(t.insets).toEqual([2, 2, 2, 2]);
    expect(t.style.columns?.gap).toBeCloseTo(10);
  });
});

describe('recadrage vectoriel', () => {
  const names = { group: 'Recadrage', mask: 'Cadre' };

  it('ne prend que son rectangle invisible pour cadre', () => {
    const a = createRect({ x: 0, y: 0, width: 100, height: 100 });
    const b = createRect({ x: 50, y: 50, width: 100, height: 100 });
    const doc = docWith(a, b);
    const id = setVectorCrop(
      doc,
      [a.id, b.id],
      { x: 10, y: 10, width: 80, height: 80, rotation: 0 },
      'g1',
      names,
    )!;
    const g = findNode(doc, id)!.node as GroupNode;
    expect(isVectorCrop(g)).toBe(true);
    // Les commandes de style ne touchent pas le cadre.
    expect(styledChildren(g).map((n) => n.id)).toEqual([a.id, b.id]);
    // Cadre supprimé : le premier enfant restant n'est pas pris pour le cadre.
    g.children.shift();
    expect(isVectorCrop(g)).toBe(false);
    expect(styledChildren(g)).toHaveLength(2);
  });
});

describe('sélections nombreuses', () => {
  it('premiers niveaux et objets trouvés en un parcours, dans l’ordre de la sélection', () => {
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const b = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const c = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const g = createGroup([a, b], 'g');
    const doc = docWith(g, c);
    expect(topLevelIds(doc, [a.id, c.id, g.id, 'absent'])).toEqual([c.id, g.id]);
    expect(topLevelIds(doc, [b.id, a.id])).toEqual([b.id, a.id]);
    expect(findNodes(doc, [c.id, 'absent', a.id]).map((n) => n.id)).toEqual([c.id, a.id]);
  });

  it('une forme fermée le reste (réponse gardée pour un tracé figé)', () => {
    const p = toPathNode(createRect({ x: 0, y: 0, width: 10, height: 10 }))!;
    expect(isClosedShape(Object.freeze(p))).toBe(true);
    expect(isClosedShape(Object.freeze(p))).toBe(true);
  });

  it('repère ce que la recette n’a pas touché', () => {
    const a = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const b = createRect({ x: 0, y: 0, width: 10, height: 10 });
    // Les documents de l'éditeur sont figés en profondeur.
    const doc = freeze(docWith(a, b), true);
    const seen: (SceneNode | null)[] = [];
    produce(doc, (d) => {
      d.artboards[0].children[1].x = 5;
      seen.push(untouched(d.artboards[0].children[0]), untouched(d.artboards[0].children[1]));
    });
    expect(seen[0]).toBe(doc.artboards[0].children[0]);
    expect(seen[1]).toBeNull();
  });
});

describe('export des textes liés', () => {
  const build = (text: string) => {
    const doc = createDocument({ width: 400, height: 400 });
    doc.artboards.push(createArtboard({ x: 500, y: 0, width: 400, height: 400 }));
    const frame = (x: number) => {
      const t = createText({ x, y: 0, width: 120, height: 60, text: '', autoWidth: false });
      t.style = { ...t.style, fontSize: 20, lineHeight: 1 };
      t.frame = true;
      return t;
    };
    const a: TextNode = { ...frame(0), text };
    const b = frame(500);
    a.next = b.id;
    doc.artboards[0].children.push(a);
    doc.artboards[1].children.push(b);
    return doc;
  };
  const words = 'un deux trois quatre cinq six sept huit neuf dix onze douze treize';

  it('répartit chaque chaîne une seule fois pour toutes les pages', () => {
    const doc = build(words);
    const flows = new Map<string, TextFlow>();
    const pages = doc.artboards.map((ab) =>
      artboardToSvg(doc, ab, { measureText: approximateMeasure, flows }),
    );
    expect(flows.size).toBe(1);
    expect(pages).toEqual(
      doc.artboards.map((ab) => artboardToSvg(doc, ab, { measureText: approximateMeasure })),
    );
  });

  it('garde une répartition par page quand le texte a des champs', () => {
    const doc = build(`page {page} ${words}`);
    const flows = new Map<string, TextFlow>();
    const pages = doc.artboards.map((ab) =>
      artboardToSvg(doc, ab, { measureText: approximateMeasure, flows }),
    );
    expect(flows.size).toBe(2);
    expect(pages).toEqual(
      doc.artboards.map((ab) => artboardToSvg(doc, ab, { measureText: approximateMeasure })),
    );
  });
});
