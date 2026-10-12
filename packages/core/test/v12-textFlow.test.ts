import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  approximateMeasure,
  artboardToSvg,
  autoFlowText,
  createDocument,
  createEllipse,
  createGroup,
  createPolygon,
  createRect,
  createText,
  decodePoulpe,
  documentPages,
  encodePoulpe,
  flowDependencies,
  flowText,
  frameRegion,
  insertPage,
  isClosedShape,
  layoutInRegion,
  shapeToTextFrame,
  textChain,
  wrapSources,
  type PoulpeDocument,
  type SceneNode,
  type TextLine,
  type TextNode,
} from '../src';

/*
 * Version 1.2, coulée du texte : habillage (carré, ajusté, sauter, au travers ; côtés, distance),
 * marges intérieures, cadres de forme, coulée automatique et cache des répartitions.
 */

const LOREM = Array.from({ length: 120 }, (_, i) => `mot${i % 10}`).join(' ');

function frame(text: string, x = 0, y = 0, width = 300, height = 300): TextNode {
  const t = createText({ x, y, width, height, text, autoWidth: false });
  t.style = { ...t.style, fontSize: 10, lineHeight: 1 };
  t.frame = true;
  return t;
}

/** Rectangle sans contour (sa boîte est exactement celle de l'objet). */
function rect(x: number, y: number, w: number, h: number): SceneNode {
  const r = createRect({ x, y, width: w, height: h });
  r.stroke = { ...r.stroke, paint: { type: 'none' } };
  return r;
}

function setup(...nodes: SceneNode[]): PoulpeDocument {
  const doc = createDocument({ width: 1000, height: 1000 });
  const ab = doc.artboards[0];
  for (const n of nodes) {
    n.x += ab.x;
    n.y += ab.y;
    ab.children.push(n);
  }
  return doc;
}

function lines(doc: PoulpeDocument, t: TextNode): TextLine[] {
  return flowText(doc, t.id, approximateMeasure, null).parts.find((p) => p.node.id === t.id)!.layout.lines;
}

/** Bord gauche et bord droit du texte d'une ligne, dans le repère du cadre. */
const extent = (l: TextLine) => [l.offset, l.offset + l.width];

describe('habillage du texte', () => {
  it('carré : le texte passe des deux côtés de la boîte, à la distance voulue', () => {
    const t = frame(LOREM);
    const r = rect(100, 50, 100, 60);
    r.wrap = { type: 'square', distance: 10 };
    const doc = setup(t, r);
    const ls = lines(doc, t);
    // Les lignes à hauteur de l'objet sont coupées en deux places, hors de [90, 210].
    const beside = ls.filter((l) => l.top + l.height > 40 && l.top < 120);
    expect(beside.length).toBeGreaterThan(4);
    for (const l of beside) {
      const [a, b] = extent(l);
      expect(b <= 90 + 1e-6 || a >= 210 - 1e-6).toBe(true);
    }
    expect(beside.some((l) => l.offset >= 210)).toBe(true);
    // Deux lignes à la même hauteur, à gauche puis à droite (ordre du texte).
    const row = beside.filter((l) => l.top === beside[0].top);
    expect(row).toHaveLength(2);
    expect(row[0].start).toBeLessThan(row[1].start);
    // Au-dessus et au-dessous, toute la largeur.
    expect(ls[0].slot).toEqual([0, 300]);
    expect(ls.find((l) => l.top >= 120)!.slot).toEqual([0, 300]);
  });

  it('ne repousse que les cadres placés dessous, sauf s’ils ignorent l’habillage', () => {
    const t = frame(LOREM);
    const r = rect(100, 50, 100, 60);
    r.wrap = { type: 'square' };
    const below = setup(r, t);
    expect(wrapSources(below, below.artboards[0].children[1] as TextNode)).toHaveLength(0);
    expect(lines(below, t).every((l) => l.slot![0] === 0 && l.slot![1] === 300)).toBe(true);
    const above = setup(t, r);
    expect(wrapSources(above, t)).toHaveLength(1);
    t.ignoreWrap = true;
    expect(wrapSources(above, t)).toHaveLength(0);
    // « Au travers » : l'objet ne repousse rien.
    t.ignoreWrap = false;
    r.wrap = { type: 'through' };
    expect(wrapSources(above, t)).toHaveLength(0);
  });

  it('sauter : aucun texte à gauche ni à droite de l’objet', () => {
    const t = frame(LOREM);
    const r = rect(100, 50, 100, 60);
    r.wrap = { type: 'jump', distance: 5 };
    const doc = setup(t, r);
    const ls = lines(doc, t);
    expect(ls.some((l) => l.top + l.height > 45 && l.top < 115)).toBe(false);
    expect(ls.some((l) => l.top >= 115)).toBe(true);
  });

  it('sauter : seulement les cadres et les colonnes que l’objet touche', () => {
    const left = frame(LOREM, 0, 0, 300, 300);
    const right = frame(LOREM, 400, 0, 300, 300);
    const r = rect(50, 100, 200, 100);
    r.wrap = { type: 'jump' };
    const doc = setup(left, right, r);
    expect(wrapSources(doc, left)).toHaveLength(1);
    expect(wrapSources(doc, right)).toHaveLength(0);
    const tops = lines(doc, right).map((l) => l.top);
    expect(tops.length).toBeGreaterThan(10);
    expect(tops).toEqual(tops.map((_, i) => i * 10));
    // Deux colonnes : l'objet au-dessus de la première ne vide pas la seconde.
    const t = frame(`${LOREM} ${LOREM} ${LOREM}`);
    t.style = { ...t.style, columns: { count: 2, gap: 20 } };
    const j = rect(0, 100, 100, 50);
    j.wrap = { type: 'jump' };
    const ls = lines(setup(t, j), t);
    const beside = (c: number) =>
      ls.filter((l) => (l.column ?? 0) === c && l.top + l.height > 100 && l.top < 150);
    expect(beside(0)).toHaveLength(0);
    expect(beside(1).length).toBeGreaterThan(3);
  });

  it('côtés : à gauche, à droite ou du plus grand côté seulement', () => {
    const t = frame(LOREM);
    const r = rect(60, 50, 100, 60);
    const doc = setup(t, r);
    const beside = () => lines(doc, t).filter((l) => l.top + l.height > 50 && l.top < 110);
    r.wrap = { type: 'square', side: 'left' };
    expect(beside().every((l) => l.slot![1] <= 60)).toBe(true);
    r.wrap = { type: 'square', side: 'right' };
    expect(beside().every((l) => l.slot![0] >= 160)).toBe(true);
    // Plus de place à droite (140 px) qu'à gauche (60 px).
    r.wrap = { type: 'square', side: 'largest' };
    expect(beside().every((l) => l.slot![0] >= 160)).toBe(true);
  });

  it('ajusté : suit le contour d’une ellipse au lieu de sa boîte', () => {
    const t = frame(LOREM);
    const e = createEllipse({ x: 0, y: 0, width: 200, height: 200 });
    e.stroke = { ...e.stroke, paint: { type: 'none' } };
    e.wrap = { type: 'square' };
    const doc = setup(t, e);
    const square = lines(doc, t).filter((l) => l.top < 200);
    e.wrap = { type: 'tight' };
    const tight = lines(doc, t).filter((l) => l.top < 200);
    // Près du haut de l'ellipse, la place libre commence bien avant 200.
    expect(square.every((l) => l.slot![0] >= 200)).toBe(true);
    expect(tight[0].slot![0]).toBeLessThan(150);
    // Au milieu, l'ellipse est large : la place commence près de 200.
    const mid = tight.find((l) => l.top <= 100 && l.top + l.height >= 100)!;
    expect(mid.slot![0]).toBeGreaterThan(190);
  });

  it('agit aussi à travers un cadre tourné et depuis un groupe', () => {
    const t = frame(`${LOREM} ${LOREM} ${LOREM}`);
    t.rotation = 90;
    const r = rect(130, 130, 40, 40);
    r.wrap = { type: 'square' };
    const doc = setup(t, createGroup([r]));
    // Au centre du cadre (tourné autour de son centre), l'objet reste au centre.
    const mid = lines(doc, t).filter((l) => l.top < 170 && l.top + l.height > 130);
    expect(mid.length).toBeGreaterThan(0);
    for (const l of mid) {
      const [a, b] = extent(l);
      expect(b <= 130 + 1e-6 || a >= 170 - 1e-6).toBe(true);
    }
  });
});

describe('cadres de texte', () => {
  it('gardent leurs marges intérieures', () => {
    const t = frame(LOREM, 0, 0, 300, 100);
    t.insets = [10, 20, 30, 40];
    const doc = setup(t);
    const ls = lines(doc, t);
    expect(ls[0].top).toBe(10);
    expect(ls[0].slot).toEqual([40, 280]);
    expect(Math.max(...ls.map((l) => l.top + l.height))).toBeLessThanOrEqual(70.5);
    // Le texte qui ne tient pas déborde.
    expect(flowText(doc, t.id, approximateMeasure, null).overflow).toBe(true);
  });

  it('posent leurs lignes dans leur forme', () => {
    const e = createEllipse({ x: 0, y: 0, width: 300, height: 200 });
    expect(isClosedShape(e)).toBe(true);
    const t = shapeToTextFrame(e, 'Cadre');
    t.style = { ...t.style, fontSize: 10, lineHeight: 1 };
    t.text = LOREM;
    expect(t.frameShape?.fill).toEqual(e.fill);
    const doc = setup(t);
    const ls = lines(doc, t);
    expect(ls.length).toBeGreaterThan(5);
    // Chaque ligne est dans l'ellipse, en haut comme en bas de sa bande.
    for (const l of ls) {
      const [a, b] = l.slot!;
      for (const y of [l.top, l.top + l.height]) {
        const dy = (y - 100) / 100;
        const half = 150 * Math.sqrt(Math.max(0, 1 - dy * dy));
        expect(a).toBeGreaterThanOrEqual(150 - half - 1);
        expect(b).toBeLessThanOrEqual(150 + half + 1);
      }
    }
    // Les lignes du milieu sont plus larges que celles du haut.
    const widths = ls.map((l) => l.slot![1] - l.slot![0]);
    expect(Math.max(...widths)).toBeGreaterThan(widths[0] + 50);
    // L'export SVG montre la forme sous le texte.
    const svg = artboardToSvg(doc, doc.artboards[0], { measureText: approximateMeasure });
    expect(svg).toMatch(/<path d="M[^"]+C[^"]+"[^>]*fill=/);
  });

  it('centrent leur texte dans une forme sans perdre de texte', () => {
    const e = createEllipse({ x: 0, y: 0, width: 300, height: 300 });
    const t = shapeToTextFrame(e, 'Cadre');
    t.style = { ...t.style, fontSize: 10, lineHeight: 1, verticalAlign: 'center' };
    t.text = 'un deux trois quatre cinq six';
    const doc = setup(t);
    const ls = lines(doc, t);
    expect(ls[0].top).toBeGreaterThan(100);
    expect(ls.map((l) => l.text).join(' ')).toBe(t.text);
  });

  it('ignorent les petites places où un mot ne tient pas', () => {
    const t = frame('aaaaaaaaaa bbbbbbbbbb cccccccccc', 0, 0, 200, 100);
    const r = rect(30, 0, 150, 40);
    r.wrap = { type: 'square' };
    const doc = setup(t, r);
    // À gauche, 30 px : trop étroit pour un mot de 55 px ; à droite, 20 px : idem.
    const ls = lines(doc, t);
    expect(ls[0].top).toBeGreaterThanOrEqual(40);
    expect(ls.map((l) => l.text).join(' ')).toBe(t.text);
  });

  it('coupent un long mot quand aucune place plus large ne vient', () => {
    const text = 'un deux trois quatre cinq six sept huit neuf internationalisation dix onze douze treize';
    // Une bande de 100 px à gauche d'une image sur toute la hauteur : comme un cadre de 100 px.
    const t = frame(text);
    const r = rect(100, 0, 200, 300);
    r.wrap = { type: 'square' };
    const doc = setup(t, r);
    const flow = flowText(doc, t.id, approximateMeasure, null);
    expect(flow.overflow).toBe(false);
    const letters = (ls: TextLine[]) => ls.map((l) => l.text.replace(/ /g, '')).join('');
    expect(letters(lines(doc, t))).toBe(text.replace(/ /g, ''));
    // Triangle : un titre plus large que toutes ses bandes de 48 px est coupé, pas perdu.
    const tri = shapeToTextFrame(
      createPolygon({ x: 0, y: 0, width: 300, height: 300 }, undefined, 3),
      'Cadre',
    );
    tri.style = { ...tri.style, fontSize: 48, lineHeight: 1 };
    tri.text = 'Bienvenue';
    const d2 = setup(tri);
    expect(flowText(d2, tri.id, approximateMeasure, null).overflow).toBe(false);
    expect(letters(lines(d2, tri))).toBe('Bienvenue');
  });

  it('descendent en bas ou au milieu malgré l’habillage, colonne par colonne', () => {
    const text = Array.from({ length: 30 }, (_, i) => `mot${i % 10}`).join(' ');
    const bottomOf = (ls: TextLine[]) => Math.max(...ls.map((l) => l.top + l.height));
    // Logo en bas à gauche : le texte descend à côté de lui, jusqu'en bas du cadre.
    const t = frame(text);
    t.style = { ...t.style, verticalAlign: 'bottom' };
    const logo = rect(0, 240, 80, 60);
    logo.wrap = { type: 'square', distance: 5 };
    const ls = lines(setup(t, logo), t);
    expect(ls.map((l) => l.text).join(' ')).toBe(text);
    expect(bottomOf(ls)).toBeGreaterThan(299);
    expect(bottomOf(ls)).toBeLessThanOrEqual(300);
    // Objet sauté en bas : le texte finit juste au-dessus.
    const j = rect(0, 260, 300, 40);
    j.wrap = { type: 'jump' };
    const lj = lines(setup(t, j), t);
    expect(bottomOf(lj)).toBeGreaterThan(259);
    expect(bottomOf(lj)).toBeLessThanOrEqual(260);
    // Au milieu : autant de place au-dessus qu'au-dessous (l'objet ne touche pas le texte).
    t.style = { ...t.style, verticalAlign: 'center' };
    const lc = lines(setup(t, j), t);
    expect(Math.abs(lc[0].top - (300 - bottomOf(lc)))).toBeLessThan(1);
    // Deux colonnes et un objet qui habille : l'alignement reste.
    const c = frame(text);
    c.style = { ...c.style, verticalAlign: 'bottom', columns: { count: 2, gap: 20 } };
    const dot = rect(250, 0, 10, 10);
    dot.wrap = { type: 'square' };
    const lcol = lines(setup(c, dot), c);
    expect(bottomOf(lcol)).toBeGreaterThan(299);
    expect(lcol.map((l) => l.text).join(' ')).toBe(text);
  });

  it('se mettent en page comme avant sans habillage ni marges', () => {
    const t = frame(LOREM, 0, 0, 170, 1000);
    const region = frameRegion(t, t.style);
    const lay = layoutInRegion(t, approximateMeasure, region);
    expect(lay.end).toBe(t.text.length);
    expect(lay.lines.every((l) => l.width <= 170)).toBe(true);
  });

  it('gardent leurs réglages dans le fichier', async () => {
    const t = frame('texte');
    t.insets = [1, 2, 3, 4];
    t.ignoreWrap = true;
    t.hideOverflow = true;
    const r = rect(0, 0, 10, 10);
    r.wrap = { type: 'tight', side: 'largest', distance: 7 };
    const doc = setup(t, r);
    const back = await decodePoulpe(await encodePoulpe(doc));
    const [bt, br] = back.artboards[0].children as [TextNode, SceneNode];
    expect(bt.insets).toEqual([1, 2, 3, 4]);
    expect(bt.ignoreWrap).toBe(true);
    expect(bt.hideOverflow).toBe(true);
    expect(br.wrap).toEqual({ type: 'tight', side: 'largest', distance: 7 });
  });
});

describe('coulée automatique', () => {
  it('ajoute des pages avec la même page maître jusqu’à ce que tout le texte tienne', () => {
    const doc = createDocument({ width: 400, height: 400 });
    const master = insertPage(doc, { name: 'A-Maître' });
    master.master = true;
    const page = doc.artboards[0];
    page.masterId = master.id;
    const long = Array.from({ length: 900 }, (_, i) => `mot${i}`).join(' ');
    const t = frame(long, page.x + 50, page.y + 60, 200, 100);
    page.children.push(t);
    expect(flowText(doc, t.id, approximateMeasure, null).overflow).toBe(true);
    const made = autoFlowText(doc, t.id, approximateMeasure, { pageName: (n) => `Page ${n}`, arrange: true });
    expect(made.length).toBeGreaterThan(2);
    const flow = flowText(doc, t.id, approximateMeasure, null);
    expect(flow.overflow).toBe(false);
    expect(textChain(doc, t.id)).toHaveLength(made.length + 1);
    const pages = documentPages(doc);
    expect(pages).toHaveLength(made.length + 1);
    for (const p of pages.slice(1)) {
      expect(p.masterId).toBe(master.id);
      const f = p.children[0] as TextNode;
      // Même taille, même place sur la page.
      expect([f.x - p.x, f.y - p.y, f.width, f.height]).toEqual([50, 60, 200, 100]);
    }
    // Plus rien à faire ensuite.
    expect(autoFlowText(doc, t.id, approximateMeasure, { pageName: (n) => `${n}` })).toEqual([]);
  });

  it('marche dans une étape d’annulation (brouillon du document)', () => {
    const base = createDocument({ width: 400, height: 400 });
    const page = base.artboards[0];
    const t = frame(
      Array.from({ length: 300 }, (_, i) => `mot${i}`).join(' '),
      page.x + 50,
      page.y + 60,
      200,
      100,
    );
    page.children.push(t);
    let made: string[] = [];
    const doc = produce(base, (d) => {
      made = autoFlowText(d, t.id, approximateMeasure, { pageName: (n) => `Page ${n}` });
    });
    expect(made.length).toBeGreaterThan(0);
    expect(textChain(doc, t.id)).toHaveLength(made.length + 1);
    expect(flowText(doc, t.id, approximateMeasure, null).overflow).toBe(false);
  });
});

describe('cache des répartitions', () => {
  it('dépend des cadres et des objets qui les habillent, pas du reste', () => {
    const t = frame(LOREM);
    const r = rect(100, 50, 100, 60);
    r.wrap = { type: 'square' };
    const other = rect(600, 600, 10, 10);
    const doc = setup(t, r, other);
    const deps = flowDependencies(doc, t.id);
    expect(deps).toEqual([t, r]);
    // Un objet sans habillage loin du cadre n'y entre pas.
    expect(deps).not.toContain(other);
  });
});
