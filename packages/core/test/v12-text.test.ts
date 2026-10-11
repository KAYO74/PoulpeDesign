import { describe, expect, it } from 'vitest';
import {
  alignVertically,
  approximateMeasure,
  artboardToSvg,
  createDocument,
  createText,
  decodePoulpe,
  encodePoulpe,
  flowText,
  layoutText,
  listMarker,
  styleFromNode,
  type TextNode,
} from '../src';

/* Version 1.2, texte : justification de la dernière ligne, listes, alignement vertical, colonnes. */

function block(text: string, width = 200, height = 100): TextNode {
  const t = createText({ x: 0, y: 0, width, height, text, autoWidth: false });
  t.style = { ...t.style, fontSize: 10, lineHeight: 1 };
  return t;
}

function frame(text: string, width = 200, height = 100): TextNode {
  const t = block(text, width, height);
  t.frame = true;
  return t;
}

describe('justification', () => {
  // Mesure approchée : 5.5 px par caractère en 10 px. Deux lignes : « aa bb cc dd » puis « ee ff ».
  const words = 'aa bb cc dd ee ff';

  it('laisse la dernière ligne à gauche par défaut', () => {
    const t = block(words, 70);
    t.style.align = 'justify';
    const [first, last] = layoutText(t, approximateMeasure).lines;
    expect(first.gap).toBeGreaterThan(0);
    expect(last.gap).toBe(0);
    expect(last.offset).toBe(0);
  });

  it('centre, aligne à droite ou justifie la dernière ligne', () => {
    const t = block(words, 70);
    t.style = { ...t.style, align: 'justify', lastLine: 'center' };
    let last = layoutText(t, approximateMeasure).lines.at(-1)!;
    expect(last.offset).toBeCloseTo((70 - last.width) / 2);
    t.style.lastLine = 'right';
    last = layoutText(t, approximateMeasure).lines.at(-1)!;
    expect(last.offset).toBeCloseTo(70 - last.width);
    t.style.lastLine = 'justify';
    last = layoutText(t, approximateMeasure).lines.at(-1)!;
    expect(last.gap).toBeCloseTo(70 - last.width);
  });
});

describe('listes', () => {
  it('posent une puce devant chaque paragraphe non vide, en retrait', () => {
    const t = block('un\n\ndeux');
    t.style.list = 'bullet';
    const lines = layoutText(t, approximateMeasure).lines;
    expect(lines.map((l) => l.marker?.text)).toEqual(['•', undefined, '•']);
    // Le texte est décalé du retrait, la puce est au bord gauche.
    expect(lines[0].offset).toBeCloseTo(13);
    expect(lines[0].marker!.x).toBeCloseTo(0);
    expect(lines[1].offset).toBeCloseTo(13);
  });

  it('numérotent les paragraphes, sans repère sur les lignes suivantes', () => {
    const t = block('aaaa bbbb cccc dddd eeee\nffff', 80);
    t.style.list = 'number';
    const lines = layoutText(t, approximateMeasure).lines;
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0].marker?.text).toBe('1.');
    expect(lines[1].marker).toBeUndefined();
    expect(lines.at(-1)!.marker?.text).toBe('2.');
    // La largeur disponible tient compte du retrait (2 em).
    for (const l of lines) expect(l.offset - 20 + l.width).toBeLessThanOrEqual(60 + 0.01);
    expect(listMarker('number', 12)).toBe('12.');
  });

  it('élargissent le retrait d’un texte artistique', () => {
    const t = block('abc');
    t.autoWidth = true;
    const plain = layoutText(t, approximateMeasure).width;
    t.style.list = 'bullet';
    expect(layoutText(t, approximateMeasure).width).toBeCloseTo(plain + 13);
  });

  it('continuent leur numérotation d’un cadre lié à l’autre', () => {
    const doc = createDocument();
    const a = frame('un\ndeux\ntrois\nquatre', 200, 20);
    const b = frame('', 200, 100);
    a.style.list = 'number';
    a.next = b.id;
    doc.artboards[0].children.push(a, b);
    const flow = flowText(doc, a.id, approximateMeasure, null);
    expect(flow.parts[0].layout.lines.map((l) => l.marker?.text)).toEqual(['1.', '2.']);
    expect(flow.parts[1].layout.lines.map((l) => l.marker?.text)).toEqual(['3.', '4.']);
  });

  it('ne remettent pas de puce sur un paragraphe coupé entre deux cadres', () => {
    const doc = createDocument();
    const a = frame('aaaa bbbb cccc dddd\neeee', 80, 10);
    const b = frame('', 80, 100);
    a.style.list = 'number';
    a.next = b.id;
    doc.artboards[0].children.push(a, b);
    const flow = flowText(doc, a.id, approximateMeasure, null);
    expect(flow.parts[0].layout.lines[0].marker?.text).toBe('1.');
    const next = flow.parts[1].layout.lines;
    expect(next[0].marker).toBeUndefined();
    expect(next.at(-1)!.marker?.text).toBe('2.');
  });

  it('s’exportent en SVG et se gardent dans les styles', () => {
    const doc = createDocument();
    const t = block('pomme\npoire');
    t.style.list = 'number';
    t.style.lastLine = 'center';
    doc.artboards[0].children.push(t);
    const svg = artboardToSvg(doc, doc.artboards[0], { measureText: approximateMeasure });
    expect(svg).toContain('>1.</tspan>');
    expect(svg).toContain('>2.</tspan>');
    t.style.list = 'bullet';
    expect(artboardToSvg(doc, doc.artboards[0], { measureText: approximateMeasure })).toContain('>•</tspan>');
    const saved = styleFromNode(t, 'Liste');
    expect(saved.text?.list).toBe('bullet');
    expect(saved.text?.lastLine).toBe('center');
  });
});

describe('cadres de texte', () => {
  it('placent le texte au milieu ou en bas', () => {
    const doc = createDocument();
    const t = frame('un\ndeux', 200, 100);
    doc.artboards[0].children.push(t);
    const top = flowText(doc, t.id, approximateMeasure, null).parts[0].layout.lines;
    expect(top[0].top).toBe(0);
    t.style.verticalAlign = 'center';
    const mid = flowText(doc, t.id, approximateMeasure, null).parts[0].layout.lines;
    expect(mid[0].top).toBeCloseTo(40);
    expect(mid[0].baseline - top[0].baseline).toBeCloseTo(40);
    t.style.verticalAlign = 'bottom';
    const low = flowText(doc, t.id, approximateMeasure, null).parts[0].layout.lines;
    expect(low[1].top + low[1].height).toBeCloseTo(100);
  });

  it('alignent chaque colonne séparément', () => {
    const lines = [
      { top: 0, height: 10, baseline: 8, column: 0 },
      { top: 10, height: 10, baseline: 18, column: 0 },
      { top: 0, height: 10, baseline: 8, column: 1 },
    ] as Parameters<typeof alignVertically>[0];
    const out = alignVertically(lines, 40, 'bottom');
    expect(out.map((l) => l.top)).toEqual([20, 30, 30]);
    expect(alignVertically(lines, 40, 'top')).toBe(lines);
  });

  it('répartissent leurs lignes entre leurs colonnes', () => {
    const doc = createDocument();
    const t = frame('un deux trois quatre cinq six sept huit neuf dix onze douze treize', 400, 10);
    t.style.columns = { count: 2, gap: 10 };
    doc.artboards[0].children.push(t);
    const flow = flowText(doc, t.id, approximateMeasure, null);
    const lines = flow.parts[0].layout.lines;
    expect(Math.max(...lines.map((l) => l.column ?? 0))).toBe(1);
    // La deuxième colonne repart du haut du cadre, ligne de base comprise.
    const second = lines.find((l) => l.column === 1)!;
    expect(second.top).toBe(0);
    expect(second.baseline).toBeCloseTo(lines[0].baseline);
    expect(second.offset).toBeCloseTo(205);
  });
});

describe('format', () => {
  it('garde les nouveaux réglages du texte', async () => {
    const doc = createDocument();
    const t = frame('texte');
    t.style = { ...t.style, verticalAlign: 'bottom', list: 'number', lastLine: 'right' };
    doc.artboards[0].children.push(t);
    const back = await decodePoulpe(await encodePoulpe(doc));
    const n = back.artboards[0].children[0] as TextNode;
    expect(n.style.verticalAlign).toBe('bottom');
    expect(n.style.list).toBe('number');
    expect(n.style.lastLine).toBe('right');
  });
});
