import { describe, expect, it } from 'vitest';
import {
  Editor,
  NONE,
  artboardToSvg,
  cellRect,
  cellText,
  createDocument,
  createGroup,
  createImage,
  createRect,
  createTable,
  decodePoulpe,
  detachFromMaster,
  detachMasterObject,
  encodePoulpe,
  findNode,
  fitTableRows,
  framePlacement,
  frameImage,
  hitNode,
  insertPage,
  insertTableCol,
  insertTableRow,
  isPictureFrame,
  isTable,
  masterOf,
  nodeBounds,
  putImageInFrame,
  removeTableCols,
  removeTableRows,
  replaceImageIn,
  resizeTableGrid,
  scaleNode,
  setFrameFitIn,
  setFrameZoomIn,
  setTableHeader,
  sizeFrameToContentIn,
  styleTableCells,
  tableSizes,
  DEFAULT_TEXT_STYLE,
  type FrameFit,
  type GroupNode,
  type PoulpeDocument,
} from '../src';

/* Version 1.2 : cadres d'image, tableaux, pages détachées de leur page maître. */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Document avec une image de 400 × 200 px dans ses ressources. */
function docWithAsset(): PoulpeDocument {
  const doc = createDocument({ width: 1000, height: 1000 });
  doc.assets.a = { id: 'a', mime: 'image/png', width: 400, height: 200, data: PNG };
  doc.assets.b = { id: 'b', mime: 'image/png', width: 100, height: 300, data: PNG };
  return doc;
}

/** Cadre d'image de 200 × 200 en (100, 100), rempli de l'image `a` (400 × 200). */
function frame(fit: FrameFit = 'fill'): GroupNode {
  const mask = createRect({ x: 100, y: 100, width: 200, height: 200 });
  mask.fill = NONE;
  const g = createGroup([mask], 'Cadre');
  g.clip = true;
  g.picture = { fit };
  putImageInFrame(g, createImage({ x: 0, y: 0, width: 1, height: 1, assetId: 'a' }), {
    width: 400,
    height: 200,
  });
  return g;
}

describe('cadres d’image', () => {
  it('ajuste l’image : remplir, image entière, étirer, taille réelle', () => {
    const fill = frameImage(frame('fill'))!;
    expect([fill.x, fill.y, fill.width, fill.height]).toEqual([0, 100, 400, 200]);
    const fit = frameImage(frame('fit'))!;
    expect([fit.x, fit.y, fit.width, fit.height]).toEqual([100, 150, 200, 100]);
    const stretch = frameImage(frame('stretch'))!;
    expect([stretch.x, stretch.y, stretch.width, stretch.height]).toEqual([100, 100, 200, 200]);
    const none = frameImage(frame('none'))!;
    expect([none.width, none.height]).toEqual([400, 200]);
  });

  it('réapplique l’ajustement quand le cadre change de taille', () => {
    const g = frame('fill');
    // Le cadre devient 400 × 100 : l'image couvre toujours le cadre, sans déformation.
    scaleNode(g, 2, 0.5, { x: 100, y: 100 });
    const m = g.children[0];
    expect([m.x, m.y, m.width, m.height]).toEqual([100, 100, 400, 100]);
    const img = frameImage(g)!;
    expect(img.width / img.height).toBeCloseTo(2, 9);
    expect(img.width).toBeCloseTo(400, 9);
    expect(img.x + img.width / 2).toBeCloseTo(300, 9);

    const fit = frame('fit');
    scaleNode(fit, 0.5, 1, { x: 100, y: 100 });
    const f = frameImage(fit)!;
    expect([f.width, f.height]).toEqual([100, 50]);

    const none = frame('none');
    scaleNode(none, 3, 3, { x: 100, y: 100 });
    expect([frameImage(none)!.width, frameImage(none)!.height]).toEqual([400, 200]);
  });

  it('garde le zoom et le décalage de l’image en redimensionnant', () => {
    const doc = docWithAsset();
    const g = frame('fill');
    setFrameZoomIn(doc, g, 1.5);
    const img = frameImage(g)!;
    img.x += 20;
    const before = framePlacement(g, img, { width: 400, height: 200 });
    expect(before.zoom).toBeCloseTo(1.5, 9);
    scaleNode(g, 2, 2, { x: 100, y: 100 });
    const after = framePlacement(g, frameImage(g)!, { width: 400, height: 200 });
    expect(after.zoom).toBeCloseTo(1.5, 9);
    expect(after.ox).toBeCloseTo(before.ox, 9);
  });

  it('borne la sélection et le clic au cadre, pas à l’image qui dépasse', () => {
    const g = frame('fill');
    expect(nodeBounds(g)).toEqual({ x: 100, y: 100, width: 200, height: 200 });
    expect(hitNode(g, { x: 150, y: 150 })).toBe(true);
    // L'image dépasse à gauche du cadre, mais cette partie est cachée.
    expect(hitNode(g, { x: 50, y: 150 })).toBe(false);
    expect(isPictureFrame(g)).toBe(true);
  });

  it('change l’ajustement, ajuste le cadre au contenu et remplace l’image', () => {
    const doc = docWithAsset();
    const g = frame('fill');
    setFrameFitIn(doc, g, 'fit');
    expect(frameImage(g)!.height).toBe(100);
    sizeFrameToContentIn(g);
    expect([g.children[0].width, g.children[0].height]).toEqual([200, 100]);

    // La nouvelle image (100 × 300) prend l'ajustement du cadre.
    const h = frame('fill');
    const img = frameImage(h)!;
    replaceImageIn(doc, img, h, 'b', { width: 100, height: 300 });
    expect(img.assetId).toBe('b');
    expect([img.width, img.height]).toEqual([200, 600]);

    // Une image seule : la nouvelle tient dans la boîte de l'ancienne.
    const solo = createImage({ x: 0, y: 0, width: 400, height: 200, assetId: 'a' });
    replaceImageIn(doc, solo, null, 'b', { width: 100, height: 300 });
    expect(solo.height).toBe(200);
    expect(solo.width).toBeCloseTo(200 / 3, 9);
    expect(solo.x + solo.width / 2).toBeCloseTo(200, 9);
  });

  it('se rend en SVG écrêté et survit à l’enregistrement', () => {
    const doc = docWithAsset();
    const g = frame('fit');
    doc.artboards[0].children.push(g);
    const empty = createGroup([createRect({ x: 600, y: 600, width: 100, height: 100 })], 'Vide');
    empty.clip = true;
    empty.picture = { fit: 'fill' };
    (empty.children[0] as { fill: unknown }).fill = NONE;
    doc.artboards[0].children.push(empty);
    const svg = artboardToSvg(doc, doc.artboards[0]);
    expect(svg).toContain('clip-path="url(#');
    expect(svg.match(/<image /g)).toHaveLength(1);
    const back = decodePoulpe(encodePoulpe(doc));
    expect((back.artboards[0].children[0] as GroupNode).picture).toEqual({ fit: 'fit' });
    expect(isPictureFrame(back.artboards[0].children[1])).toBe(true);
  });

  it('la boîte du groupe suit le cadre après une modification', () => {
    const doc = docWithAsset();
    const g = frame('fill');
    doc.artboards[0].children.push(g);
    const editor = new Editor(doc);
    editor.apply('test', (d) => {
      const n = findNode(d, g.id)!.node;
      scaleNode(n, 1.5, 1, { x: 100, y: 100 });
    });
    const n = findNode(editor.doc, g.id)!.node;
    expect([n.x, n.y, n.width, n.height]).toEqual([100, 100, 300, 200]);
  });
});

const names = { table: 'Tableau', cell: 'Cellule', text: 'Texte' };
const style = { ...DEFAULT_TEXT_STYLE, fontSize: 20 };

describe('tableaux', () => {
  it('crée une grille de cellules rectangle + texte', () => {
    const t = createTable({ x: 10, y: 20, width: 300, height: 150, rows: 3, cols: 3, style, names });
    expect(isTable(t)).toBe(true);
    expect(t.children).toHaveLength(18);
    expect(tableSizes(t)).toEqual({ cols: [100, 100, 100], rows: [50, 50, 50] });
    const c = cellRect(t, 1, 2);
    expect([c.x, c.y]).toEqual([210, 70]);
    const text = cellText(t, 1, 2);
    expect(text.frame).toBe(true);
    expect(text.x).toBe(210 + (t.table.padding ?? 6));
  });

  it('fait grandir une ligne avec son texte et remet la grille après un redimensionnement', () => {
    const t = createTable({ x: 0, y: 0, width: 300, height: 120, rows: 3, cols: 3, style, names });
    const pad = t.table.padding!;
    cellText(t, 0, 1).text = 'long';
    fitTableRows(t, (n) => (n.text ? 100 : 10));
    expect(tableSizes(t).rows).toEqual([100 + pad * 2, 40, 40]);
    expect(cellRect(t, 1, 0).y).toBe(100 + pad * 2);
    // Mis à l'échelle comme un groupe : les marges des textes reviennent à leur taille.
    scaleNode(t, 2, 1, { x: 0, y: 0 });
    fitTableRows(t, () => 0);
    expect(tableSizes(t).cols).toEqual([200, 200, 200]);
    expect(cellText(t, 0, 0).width).toBe(200 - pad * 2);
  });

  it('ajoute et retire des lignes et des colonnes', () => {
    const t = createTable({ x: 0, y: 0, width: 300, height: 120, rows: 3, cols: 3, style, names });
    cellText(t, 0, 0).text = 'A';
    insertTableRow(t, 0);
    expect(t.table.rows).toBe(4);
    expect(cellText(t, 1, 0).text).toBe('A');
    expect(cellText(t, 0, 0).text).toBe('');
    expect(cellRect(t, 0, 0).y).toBe(0);
    insertTableCol(t, 3);
    expect(t.table.cols).toBe(4);
    expect(isTable(t)).toBe(true);
    expect(cellRect(t, 0, 3).x).toBe(300);
    removeTableRows(t, 0, 0);
    expect(cellText(t, 0, 0).text).toBe('A');
    expect(cellRect(t, 0, 0).y).toBe(0);
    removeTableCols(t, 0, 1);
    expect(t.table.cols).toBe(2);
    expect(isTable(t)).toBe(true);
    resizeTableGrid(t, 5, 4);
    expect([t.table.rows, t.table.cols, t.children.length]).toEqual([5, 4, 40]);
    // On ne retire jamais la dernière ligne.
    removeTableRows(t, 0, 4);
    expect(t.table.rows).toBe(5);
  });

  it('règle l’en-tête, le fond et les bordures des cellules', () => {
    const t = createTable({ x: 0, y: 0, width: 300, height: 120, rows: 3, cols: 3, style, names });
    setTableHeader(t, true);
    expect(t.table.header).toBe(true);
    expect(cellText(t, 0, 2).style.fontWeight).toBe(700);
    expect(cellRect(t, 0, 0).fill).not.toEqual(cellRect(t, 1, 0).fill);
    setTableHeader(t, false);
    expect(cellText(t, 0, 2).style.fontWeight).toBe(400);
    expect(cellRect(t, 0, 0).fill).toEqual(cellRect(t, 1, 0).fill);
    styleTableCells(t, { r0: 1, c0: 1, r1: 2, c1: 1 }, { fill: { type: 'solid', color: '#ff0000' } });
    expect(cellRect(t, 2, 1).fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(cellRect(t, 2, 2).fill).not.toEqual({ type: 'solid', color: '#ff0000' });
    styleTableCells(t, null, { borderWidth: 0 });
    expect(cellRect(t, 0, 0).stroke.paint.type).toBe('none');
    styleTableCells(t, null, { borderColor: '#00ff00', borderWidth: 2 });
    expect(cellRect(t, 1, 1).stroke).toMatchObject({ width: 2, paint: { type: 'solid', color: '#00ff00' } });
  });

  it('s’exporte en SVG et survit à l’enregistrement', () => {
    const doc = createDocument({ width: 600, height: 600 });
    const t = createTable({ x: 10, y: 10, width: 300, height: 120, rows: 2, cols: 2, style, names });
    cellText(t, 1, 1).text = 'Prix';
    doc.artboards[0].children.push(t);
    const svg = artboardToSvg(doc, doc.artboards[0]);
    expect(svg).toContain('Prix');
    // Fond de page, puis quatre cellules (fond et bordure).
    expect(svg.match(/<path /g)!.length).toBeGreaterThanOrEqual(4);
    const back = decodePoulpe(encodePoulpe(doc));
    expect(isTable(back.artboards[0].children[0])).toBe(true);
  });
});

describe('pages et page maître', () => {
  function withMaster(): PoulpeDocument {
    const doc = createDocument({ width: 500, height: 800 });
    const master = insertPage(doc, { name: 'A-Maître' });
    master.master = true;
    master.x = -1000;
    master.y = 0;
    master.children.push(createRect({ x: -1000, y: 0, width: 500, height: 50, name: 'Bandeau' }));
    master.children.push(createRect({ x: -900, y: 700, width: 50, height: 50, name: 'Coin' }));
    doc.artboards[0].masterId = master.id;
    return doc;
  }

  it('détache un objet de la page maître sur une page', () => {
    const doc = withMaster();
    const page = doc.artboards[0];
    const master = doc.artboards[1];
    const id = detachMasterObject(doc, page.id, master.children[1].id)!;
    const copy = findNode(doc, id)!;
    expect(copy.artboard.id).toBe(page.id);
    expect([copy.node.x, copy.node.y]).toEqual([100, 700]);
    expect(page.masterHidden).toEqual([master.children[1].id]);
    // La page ne montre plus l'original ; la page maître le garde.
    const seen = masterOf(doc, page)!;
    expect(seen.children.map((c) => c.name)).toEqual(['Bandeau']);
    expect(masterOf(doc, page)).toBe(seen);
    expect(master.children).toHaveLength(2);
    // Le bandeau détaché ensuite passe sous le coin, comme sur la page maître.
    detachMasterObject(doc, page.id, master.children[0].id);
    expect(page.children.map((c) => c.name)).toEqual(['Bandeau', 'Coin']);
    // Les deux copies sur la page, sans les originaux de la page maître en double.
    const svg = artboardToSvg(doc, page);
    expect(svg.match(/<path /g)!.length).toBe(2);
  });

  it('détache une page de sa page maître', () => {
    const doc = withMaster();
    const page = doc.artboards[0];
    page.children.push(createRect({ x: 10, y: 10, width: 10, height: 10, name: 'Page' }));
    const ids = detachFromMaster(doc, page.id);
    expect(ids).toHaveLength(2);
    expect(page.masterId).toBeUndefined();
    expect(page.children.map((c) => c.name)).toEqual(['Bandeau', 'Coin', 'Page']);
    expect(page.children[0].x).toBe(0);
  });
});
