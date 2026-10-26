import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  filtersReach,
  CANVAS_FEATURES,
  FORMAT_VERSION,
  OPENTYPE_FEATURES,
  WIDTH_PROFILES,
  applyKnife,
  applyStyle,
  approximateMeasure,
  artboardToSvg,
  cornerKeys,
  createDocument,
  createRect,
  createSymbolInstance,
  createText,
  cutPathAtPoint,
  decodePoulpe,
  defaultEffect,
  encodePoulpe,
  featureSettings,
  fromSubpaths,
  hasClosedSubpath,
  knifeOpenPath,
  layoutText,
  migrate,
  parseSvgPath,
  pathToSvg,
  profileAt,
  roundCorners,
  styleFromNode,
  symbolContent,
  symbolInstances,
  textColumns,
  toSubpaths,
  widthProfileOutline,
  type PoulpeDocument,
  type TextNode,
} from '../src';

/* Outils vectoriels de la version 0.6 : coupe, contours variables, symboles, styles, colonnes. */

describe('ciseaux, cutter et outil Coin', () => {
  it('ciseaux : un carré fermé s’ouvre au point de coupe', () => {
    const cmds = parseSvgPath('M0 0L10 0L10 10L0 10Z');
    const out = cutPathAtPoint(cmds, { x: 5, y: 0 }, 1)!;
    expect(out).not.toBeNull();
    const sps = toSubpaths(out);
    expect(sps).toHaveLength(1);
    expect(sps[0].closed).toBe(false);
    expect(sps[0].anchors).toHaveLength(6);
  });

  it('ciseaux : un tracé ouvert donne deux morceaux, et rien de loin', () => {
    const cmds = parseSvgPath('M0 0L10 0L10 10');
    expect(toSubpaths(cutPathAtPoint(cmds, { x: 5, y: 0 }, 1)!)).toHaveLength(2);
    expect(cutPathAtPoint(cmds, { x: 50, y: 50 }, 1)).toBeNull();
  });

  it('cutter : un tracé ouvert est séparé à chaque croisement', () => {
    const cmds = parseSvgPath('M0 0L10 0L10 10');
    const out = knifeOpenPath(cmds, { x: -5, y: 5 }, { x: 15, y: 5 })!;
    expect(out).not.toBeNull();
    expect(toSubpaths(out)).toHaveLength(2);
    expect(knifeOpenPath(cmds, { x: 50, y: 50 }, { x: 60, y: 60 })).toBeNull();
  });

  it('cutter : une forme pleine devient deux objets', () => {
    const doc = createDocument({ width: 100, height: 100 });
    const rect = createRect({ x: 10, y: 10, width: 40, height: 40 });
    doc.artboards[0].children.push(rect);
    const made = applyKnife(doc, [rect.id], { x: 0, y: 30 }, { x: 100, y: 30 }, 'Courbe');
    expect(made).toHaveLength(2);
    expect(doc.artboards[0].children.map((n) => n.id)).toEqual(made);
    // Chaque moitié fait la moitié de la hauteur.
    for (const n of doc.artboards[0].children) expect(n.height).toBeCloseTo(20, 1);
  });

  it('cutter : une ligne qui ne traverse rien ne change rien', () => {
    const doc = createDocument({ width: 100, height: 100 });
    const rect = createRect({ x: 10, y: 10, width: 20, height: 20 });
    doc.artboards[0].children.push(rect);
    expect(applyKnife(doc, [rect.id], { x: 60, y: 0 }, { x: 60, y: 100 }, 'Courbe')).toBeNull();
    expect(doc.artboards[0].children).toHaveLength(1);
  });

  it('outil Coin : arrondi par des courbes, chanfrein par des droites', () => {
    const cmds = parseSvgPath('M0 0L10 0L10 10L0 10Z');
    const keys = cornerKeys(cmds);
    expect(keys).toHaveLength(4);
    const round = fromSubpaths(roundCorners(toSubpaths(cmds), keys, 3));
    expect(toSubpaths(round)[0].anchors).toHaveLength(8);
    expect(pathToSvg(round)).toContain('C');
    expect(hasClosedSubpath(round)).toBe(true);
    const chamfer = toSubpaths(fromSubpaths(roundCorners(toSubpaths(cmds), keys, 3, 'chamfer')));
    expect(chamfer[0].anchors.every((a) => !a.in && !a.out)).toBe(true);
    // Le rayon ne dépasse jamais la moitié du côté : le tracé reste propre.
    const big = toSubpaths(fromSubpaths(roundCorners(toSubpaths(cmds), keys, 50)));
    expect(big[0].anchors.every((a) => a.x >= -0.01 && a.x <= 10.01)).toBe(true);
  });
});

describe('contours à largeur variable', () => {
  it('le profil est interpolé en douceur, bornes comprises', () => {
    const p = [0, 1, 0];
    expect(profileAt(p, 0)).toBeCloseTo(0);
    expect(profileAt(p, 0.5)).toBeCloseTo(1);
    expect(profileAt(p, 1)).toBeCloseTo(0);
    expect(profileAt(p, -1)).toBeCloseTo(0);
    expect(profileAt(p, 2)).toBeCloseTo(0);
    expect(WIDTH_PROFILES.find((x) => x.id === 'uniform')!.profile).toEqual([1, 1]);
  });

  it('un contour ouvert devient une forme fermée, plus étroite aux bouts', () => {
    const stroke = { paint: { type: 'solid' as const, color: '#000' }, width: 10, profile: [0.1, 1, 0.1] };
    const out = widthProfileOutline(parseSvgPath('M0 0L100 0'), stroke);
    expect(hasClosedSubpath(out)).toBe(true);
    const ys = out.filter((c) => c.op !== 'Z').map((c) => Math.abs((c as { y: number }).y));
    // Au milieu le contour fait son épaisseur entière, aux extrémités presque rien.
    expect(Math.max(...ys)).toBeCloseTo(5, 0);
    expect(Math.min(...ys)).toBeLessThan(1);
  });

  it('un sous-tracé fermé donne un anneau', () => {
    const stroke = { paint: { type: 'solid' as const, color: '#000' }, width: 6, profile: [1, 0.2, 1] };
    const out = widthProfileOutline(parseSvgPath('M0 0L20 0L20 20L0 20Z'), stroke);
    expect(out.filter((c) => c.op === 'Z')).toHaveLength(2);
  });
});

describe('symboles', () => {
  function docWithSymbol(): { doc: PoulpeDocument; symbolId: string } {
    const doc = createDocument({ width: 200, height: 200 });
    const rect = createRect({ x: 0, y: 0, width: 20, height: 10 });
    doc.symbols = {
      s1: { id: 's1', name: 'Puce', box: { x: 0, y: 0, width: 20, height: 10 }, children: [rect] },
    };
    return { doc, symbolId: 's1' };
  }

  it('une instance ramène le contenu dans sa propre boîte', () => {
    const { doc } = docWithSymbol();
    const node = createSymbolInstance({ x: 50, y: 30, width: 40, height: 20, symbolId: 's1' });
    doc.artboards[0].children.push(node);
    const [child] = symbolContent(doc, node);
    expect(child).toMatchObject({ x: 50, y: 30, width: 40, height: 20 });
    // Les copies sont neuves : personne ne les garde d'un rendu à l'autre.
    expect(symbolContent(doc, node)[0]).not.toBe(child);
    expect(symbolInstances(doc, 's1').map((n) => n.id)).toEqual([node.id]);
  });

  it('un symbole inconnu n’affiche rien', () => {
    const { doc } = docWithSymbol();
    const node = createSymbolInstance({ x: 0, y: 0, width: 10, height: 10, symbolId: 'absent' });
    expect(symbolContent(doc, node)).toEqual([]);
  });

  it('le SVG exporte le contenu de l’instance', () => {
    const { doc } = docWithSymbol();
    doc.artboards[0].children.push(
      createSymbolInstance({ x: 10, y: 10, width: 20, height: 10, symbolId: 's1' }),
    );
    const svg = artboardToSvg(doc, doc.artboards[0]);
    expect(svg).toContain('<path');
  });
});

describe('styles enregistrés', () => {
  it('le style reprend l’apparence et la repose ailleurs', () => {
    const source = createRect({ x: 0, y: 0, width: 10, height: 10 });
    source.fill = { type: 'solid', color: '#ff0000' };
    source.stroke = { paint: { type: 'solid', color: '#0000ff' }, width: 4 };
    source.strokes = [{ paint: { type: 'solid', color: '#00ff00' }, width: 9 }];
    source.effects = [defaultEffect('bevel')];
    source.opacity = 0.5;
    const style = styleFromNode(source, 'Mon style');

    const target = createRect({ x: 50, y: 50, width: 10, height: 10 });
    expect(applyStyle(target, style)).toBe(true);
    expect(target.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(target.stroke.width).toBe(4);
    expect(target.strokes?.[0].width).toBe(9);
    expect(target.effects?.[0].type).toBe('bevel');
    expect(target.opacity).toBe(0.5);
    // La position ne fait pas partie du style.
    expect(target.x).toBe(50);
  });

  it('un style sans contour en plus retire ceux de la cible', () => {
    const source = createRect({ x: 0, y: 0, width: 10, height: 10 });
    const style = styleFromNode(source, 'Simple');
    const target = createRect({ x: 0, y: 0, width: 10, height: 10 });
    target.strokes = [{ paint: { type: 'solid', color: '#000' }, width: 3 }];
    applyStyle(target, style);
    expect(target.strokes).toBeUndefined();
  });

  it('un style de texte garde les réglages de caractère', () => {
    const source = createText({ x: 0, y: 0, width: 100, height: 20, text: 'Titre' });
    source.style = { ...source.style, fontSize: 48, features: ['smcp'] };
    const style = styleFromNode(source, 'Titre');
    const target = createText({ x: 0, y: 0, width: 100, height: 20, text: 'Autre' });
    target.runs = [{ start: 0, end: 5, style: { fontSize: 10 } }];
    applyStyle(target, style);
    expect(target.style.fontSize).toBe(48);
    expect(target.style.features).toEqual(['smcp']);
    expect(target.runs).toEqual([]);
    expect(target.text).toBe('Autre');
  });
});

describe('texte : colonnes et fonctions OpenType', () => {
  function text(over: Partial<TextNode> = {}): TextNode {
    const n = createText({ x: 0, y: 0, width: 200, height: 100, text: 'un deux trois quatre cinq six' });
    n.autoWidth = false;
    return Object.assign(n, over);
  }

  it('les colonnes partagent la largeur, gouttière comprise', () => {
    const n = text();
    n.style = { ...n.style, columns: { count: 2, gap: 20 } };
    expect(textColumns(n)).toEqual({ count: 2, width: 90, gap: 20 });
    // Une seule colonne : toute la largeur.
    expect(textColumns(text()).width).toBe(200);
  });

  it('un cadre à largeur libre reste sur une colonne', () => {
    const n = text({ autoWidth: true });
    n.style = { ...n.style, columns: { count: 3, gap: 10 } };
    expect(textColumns(n).count).toBe(1);
  });

  it('les lignes se répartissent entre les colonnes', () => {
    const n = text({ height: 40 });
    n.style = { ...n.style, fontSize: 16, columns: { count: 2, gap: 10 } };
    const lines = layoutText(n, approximateMeasure).lines;
    expect(lines.length).toBeGreaterThan(1);
    expect(Math.max(...lines.map((l) => l.column ?? 0))).toBeGreaterThan(0);
  });

  it('les fonctions OpenType deviennent une valeur CSS', () => {
    expect(featureSettings()).toBe('normal');
    expect(featureSettings([])).toBe('normal');
    expect(featureSettings(['smcp', 'liga'])).toBe('"smcp" 1, "liga" 1');
    for (const f of CANVAS_FEATURES) expect(OPENTYPE_FEATURES).toContain(f);
  });
});

describe('format de fichier', () => {
  it('la version 7 range les symboles et les styles', async () => {
    const doc = createDocument({ width: 100, height: 100 });
    const rect = createRect({ x: 0, y: 0, width: 10, height: 10 });
    doc.symbols = {
      s1: { id: 's1', name: 'Puce', box: { x: 0, y: 0, width: 10, height: 10 }, children: [rect] },
    };
    doc.styles = [{ id: 'st1', name: 'Rouge', fill: { type: 'solid', color: '#ff0000' } }];
    doc.artboards[0].children.push(
      createSymbolInstance({ x: 0, y: 0, width: 10, height: 10, symbolId: 's1' }),
    );
    expect(FORMAT_VERSION).toBeGreaterThanOrEqual(7);
    const back = await decodePoulpe(await encodePoulpe(doc));
    expect(back.symbols?.s1.name).toBe('Puce');
    expect(back.styles?.[0].fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(back.artboards[0].children[0].type).toBe('symbol');
  });

  it('un document de la version 6 s’ouvre toujours', () => {
    const doc = createDocument({ width: 100, height: 100 });
    const old = { ...structuredClone(doc), version: 6 } as unknown as Record<string, unknown>;
    const up = migrate(old) as PoulpeDocument;
    expect(up.version).toBe(FORMAT_VERSION);
    expect(up.artboards).toHaveLength(1);
  });
});

describe('filtres en direct (format 8)', () => {
  it('portée des filtres actifs et aller-retour du fichier', async () => {
    const doc = createDocument({ name: 'f', width: 100, height: 100 });
    const r = createRect({ x: 0, y: 0, width: 10, height: 10 });
    r.filters = [
      { id: 'a', enabled: true, adjustment: { kind: 'gaussianBlur', radius: 10 } },
      { id: 'b', enabled: false, adjustment: { kind: 'pixelate', size: 40 } },
    ];
    doc.artboards[0].children.push(r);
    expect(activeFilters(r).map((f) => f.id)).toEqual(['a']);
    expect(filtersReach(r)).toBe(15);
    expect(FORMAT_VERSION).toBe(8);
    const back = await decodePoulpe(await encodePoulpe(doc));
    expect(back.artboards[0].children[0].filters).toEqual(r.filters);
  });
});
