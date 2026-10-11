import { NONE, createGroup, createRect, createText, solid } from './factory';
import { localToWorld, rotatePoint } from './geometry';
import { cloneWithNewIds } from './tree';
import type { GroupNode, Paint, RectNode, SceneNode, Stroke, TableInfo, TextNode, TextStyle } from './types';

/*
 * Tableaux (outil Tableau de la Persona Mise en page).
 *
 * Un tableau est un groupe marqué `table` dont les enfants sont, ligne par ligne, chaque cellule :
 * un rectangle (fond et bordures) suivi de son texte (un cadre de texte). Le rendu, les exports et
 * la sélection le traitent comme un groupe ordinaire. La grille (largeurs des colonnes, hauteurs des
 * lignes) se lit dans les rectangles ; `layoutTable` repose les cellules et `fitTableRows` fait
 * grandir une ligne dont le texte ne tient plus.
 */

export const TABLE_PADDING = 6;
export const TABLE_FILL = '#ffffff';
export const TABLE_HEADER_FILL = '#e6eaef';
export const TABLE_BORDER = '#8a939d';

export type TableNode = GroupNode & { table: TableInfo };

/** Plage de cellules, bornes comprises. */
export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** Un groupe tableau bien formé (sinon il reste un simple groupe). */
export function isTable(n: SceneNode | null | undefined): n is TableNode {
  if (!n || n.type !== 'group' || !n.table) return false;
  const { rows, cols } = n.table;
  const kids = n.children;
  if (rows < 1 || cols < 1 || kids.length !== rows * cols * 2) return false;
  for (let i = 0; i < kids.length; i += 2)
    if (kids[i].type !== 'rect' || kids[i + 1].type !== 'text') return false;
  return true;
}

export function tablePadding(g: TableNode): number {
  return g.table.padding ?? TABLE_PADDING;
}

export function cellRect(g: TableNode, r: number, c: number): RectNode {
  return g.children[(r * g.table.cols + c) * 2] as RectNode;
}

export function cellText(g: TableNode, r: number, c: number): TextNode {
  return g.children[(r * g.table.cols + c) * 2 + 1] as TextNode;
}

/** Ligne et colonne de la cellule qui contient l'objet `id` (son rectangle ou son texte). */
export function cellOf(g: TableNode, id: string): { r: number; c: number } | null {
  const i = g.children.findIndex((n) => n.id === id);
  if (i < 0) return null;
  const k = Math.floor(i / 2);
  return { r: Math.floor(k / g.table.cols), c: k % g.table.cols };
}

/** Largeurs des colonnes et hauteurs des lignes, lues dans les rectangles des cellules. */
export function tableSizes(g: TableNode): { cols: number[]; rows: number[] } {
  const cols: number[] = [],
    rows: number[] = [];
  for (let c = 0; c < g.table.cols; c++) cols.push(cellRect(g, 0, c).width);
  for (let r = 0; r < g.table.rows; r++) rows.push(cellRect(g, r, 0).height);
  return { cols, rows };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Change une propriété seulement si elle change vraiment (un brouillon intact reste intact). */
function put<T extends object, K extends keyof T>(o: T, k: K, v: T[K]) {
  const cur = o[k];
  if (typeof cur === 'number' && typeof v === 'number' ? !near(cur, v) : cur !== v) o[k] = v;
}

/**
 * Repose les cellules sur la grille donnée, à partir du coin haut gauche de la première cellule,
 * dans l'orientation du tableau. Les textes gardent la marge intérieure.
 */
export function layoutTable(g: TableNode, cols: number[], rows: number[]): void {
  const first = cellRect(g, 0, 0);
  const rot = first.rotation;
  const origin = localToWorld(first, { x: 0, y: 0 });
  const pad = tablePadding(g);
  let y = 0;
  for (let r = 0; r < g.table.rows; r++) {
    let x = 0;
    const h = Math.max(1, rows[r]);
    for (let c = 0; c < g.table.cols; c++) {
      const w = Math.max(1, cols[c]);
      const center = rotatePoint({ x: origin.x + x + w / 2, y: origin.y + y + h / 2 }, origin, rot);
      const rect = cellRect(g, r, c);
      put(rect, 'width', w);
      put(rect, 'height', h);
      put(rect, 'x', center.x - w / 2);
      put(rect, 'y', center.y - h / 2);
      put(rect, 'rotation', rot);
      const text = cellText(g, r, c);
      const tw = Math.max(1, w - pad * 2),
        th = Math.max(1, h - pad * 2);
      put(text, 'width', tw);
      put(text, 'height', th);
      put(text, 'x', center.x - tw / 2);
      put(text, 'y', center.y - th / 2);
      put(text, 'rotation', rot);
      x += w;
    }
    y += h;
  }
}

/**
 * Remet le tableau en ordre : une ligne grandit jusqu'à contenir son texte le plus haut
 * (`contentHeight` mesure un texte), puis les cellules se reposent sur la grille.
 */
export function fitTableRows(g: TableNode, contentHeight: (t: TextNode) => number): void {
  const { cols, rows } = tableSizes(g);
  const pad = tablePadding(g);
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < cols.length; c++) {
      const need = contentHeight(cellText(g, r, c)) + pad * 2;
      if (need > rows[r] + 0.5) rows[r] = need;
    }
  layoutTable(g, cols, rows);
}

/** Hauteur d'une ligne vide : une ligne de texte et la marge. */
export function baseRowHeight(style: TextStyle, padding: number): number {
  return Math.ceil(style.fontSize * style.lineHeight + padding * 2);
}

function cellRectNode(name: string, fill: Paint, stroke: Stroke): RectNode {
  const r = createRect({ x: 0, y: 0, width: 1, height: 1, name });
  r.fill = fill;
  r.stroke = stroke;
  return r;
}

function cellTextNode(name: string, style: TextStyle, color: Paint): TextNode {
  const t = createText({ x: 0, y: 0, width: 1, height: 1, name, autoWidth: false });
  t.style = { ...style };
  t.fill = color;
  t.frame = true;
  return t;
}

export interface NewTable {
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  style: TextStyle;
  /** Noms des objets (traduits par l'interface). */
  names: { table: string; cell: string; text: string };
  header?: boolean;
}

/** Nouveau tableau qui remplit la boîte donnée, en lignes et colonnes égales. */
export function createTable(o: NewTable): TableNode {
  const rows = Math.max(1, Math.round(o.rows)),
    cols = Math.max(1, Math.round(o.cols));
  const padding = Math.max(2, Math.round(o.style.fontSize * 0.35));
  // Bordure fine proportionnée au texte (environ 1 pt pour du 12 pt, quelle que soit la résolution).
  const border: Stroke = {
    paint: solid(TABLE_BORDER),
    width: Math.max(1, Math.round(o.style.fontSize / 12)),
  };
  const children: SceneNode[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const head = !!o.header && r === 0;
      children.push(cellRectNode(o.names.cell, solid(head ? TABLE_HEADER_FILL : TABLE_FILL), border));
      children.push(
        cellTextNode(
          o.names.text,
          { ...o.style, fontWeight: head ? 700 : o.style.fontWeight },
          solid('#1a1a1d'),
        ),
      );
    }
  const g = createGroup(children, o.names.table) as TableNode;
  g.table = { rows, cols, ...(o.header ? { header: true } : {}), padding };
  const first = children[0] as RectNode;
  first.x = o.x;
  first.y = o.y;
  const rowH = Math.max(baseRowHeight(o.style, padding), o.height / rows);
  layoutTable(
    g,
    Array.from({ length: cols }, () => Math.max(1, o.width / cols)),
    Array.from({ length: rows }, () => rowH),
  );
  Object.assign(g, { x: o.x, y: o.y, width: o.width, height: rowH * rows });
  return g;
}

/** Copie vide d'une cellule (mêmes fond, bordures et style de texte). */
function blankCell(g: TableNode, r: number, c: number): SceneNode[] {
  const rect = cloneWithNewIds(cellRect(g, r, c));
  const text = cloneWithNewIds(cellText(g, r, c));
  text.text = '';
  delete text.runs;
  return [rect, text];
}

/** Ajoute une ligne à la position `at` (0 à rows), sur le modèle de sa voisine. */
export function insertTableRow(g: TableNode, at: number): void {
  const { rows, cols } = g.table;
  at = Math.max(0, Math.min(rows, at));
  // Une ligne ajoutée au-dessus de l'en-tête copie la ligne d'en dessous, sinon celle du dessus.
  const model = at === 0 ? 0 : at - 1;
  const fromHeader = !!g.table.header && model === 0 && rows > 1 && at > 0;
  const src = fromHeader ? 1 : model;
  const sizes = tableSizes(g);
  const style = cellText(g, src, 0).style;
  const h = Math.min(sizes.rows[src], baseRowHeight(style, tablePadding(g)));
  const cells: SceneNode[] = [];
  for (let c = 0; c < cols; c++) cells.push(...blankCell(g, src, c));
  g.children.splice(at * cols * 2, 0, ...cells);
  g.table = { ...g.table, rows: rows + 1 };
  sizes.rows.splice(at, 0, h);
  // La première cellule a pu changer : la grille repart du coin de l'ancienne.
  restoreOrigin(g, at === 0 ? { dr: 1, dc: 0 } : null, sizes);
}

/** Ajoute une colonne à la position `at` (0 à cols), sur le modèle de sa voisine. */
export function insertTableCol(g: TableNode, at: number): void {
  const { rows, cols } = g.table;
  at = Math.max(0, Math.min(cols, at));
  const src = at === 0 ? 0 : at - 1;
  const sizes = tableSizes(g);
  const next = [...g.children];
  for (let r = rows - 1; r >= 0; r--) next.splice((r * cols + at) * 2, 0, ...blankCell(g, r, src));
  g.children = next;
  g.table = { ...g.table, cols: cols + 1 };
  sizes.cols.splice(at, 0, sizes.cols[src]);
  restoreOrigin(g, at === 0 ? { dr: 0, dc: 1 } : null, sizes);
}

/** Retire des lignes (de `r0` à `r1`) ; il en reste au moins une. */
export function removeTableRows(g: TableNode, r0: number, r1: number): void {
  const { rows, cols } = g.table;
  const a = Math.max(0, Math.min(r0, r1)),
    b = Math.min(rows - 1, Math.max(r0, r1));
  const n = b - a + 1;
  if (n >= rows) return;
  const sizes = tableSizes(g);
  // Le tableau garde son coin haut gauche, même si ses premières lignes partent.
  const corner = localToWorld(cellRect(g, 0, 0), { x: 0, y: 0 });
  g.children.splice(a * cols * 2, n * cols * 2);
  g.table = { ...g.table, rows: rows - n };
  if (a === 0 && g.table.header) delete g.table.header;
  sizes.rows.splice(a, n);
  setOrigin(g, corner, sizes);
}

/** Retire des colonnes (de `c0` à `c1`) ; il en reste au moins une. */
export function removeTableCols(g: TableNode, c0: number, c1: number): void {
  const { rows, cols } = g.table;
  const a = Math.max(0, Math.min(c0, c1)),
    b = Math.min(cols - 1, Math.max(c0, c1));
  const n = b - a + 1;
  if (n >= cols) return;
  const sizes = tableSizes(g);
  const corner = localToWorld(cellRect(g, 0, 0), { x: 0, y: 0 });
  const next: SceneNode[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if (c < a || c > b) next.push(...[cellRect(g, r, c), cellText(g, r, c)]);
  g.children = next;
  g.table = { ...g.table, cols: cols - n };
  sizes.cols.splice(a, n);
  setOrigin(g, corner, sizes);
}

/** Change le nombre de lignes et de colonnes (ajouts et retraits à la fin). */
export function resizeTableGrid(g: TableNode, rows: number, cols: number): void {
  rows = Math.max(1, Math.min(200, Math.round(rows)));
  cols = Math.max(1, Math.min(50, Math.round(cols)));
  while (g.table.rows < rows) insertTableRow(g, g.table.rows);
  if (g.table.rows > rows) removeTableRows(g, rows, g.table.rows - 1);
  while (g.table.cols < cols) insertTableCol(g, g.table.cols);
  if (g.table.cols > cols) removeTableCols(g, cols, g.table.cols - 1);
}

/** Repose la grille avec la première cellule au coin donné. */
function setOrigin(
  g: TableNode,
  corner: { x: number; y: number },
  sizes: { cols: number[]; rows: number[] },
) {
  const first = cellRect(g, 0, 0);
  const c = rotatePoint(
    { x: corner.x + first.width / 2, y: corner.y + first.height / 2 },
    corner,
    first.rotation,
  );
  first.x = c.x - first.width / 2;
  first.y = c.y - first.height / 2;
  layoutTable(g, sizes.cols, sizes.rows);
}

/**
 * Après un ajout en tête : la nouvelle première cellule est une copie (même place que l'ancienne).
 * Le tableau garde son coin haut gauche, la grille se décale vers le bas ou la droite.
 */
function restoreOrigin(
  g: TableNode,
  shifted: { dr: number; dc: number } | null,
  sizes: { cols: number[]; rows: number[] },
) {
  if (!shifted) {
    layoutTable(g, sizes.cols, sizes.rows);
    return;
  }
  const old = cellRect(g, shifted.dr, shifted.dc);
  setOrigin(g, localToWorld(old, { x: 0, y: 0 }), sizes);
}

/** Cellules d'une plage (toutes si `range` est null). */
export function cellsIn(g: TableNode, range: CellRange | null): { r: number; c: number }[] {
  const { rows, cols } = g.table;
  const r0 = range ? Math.max(0, Math.min(range.r0, range.r1)) : 0;
  const r1 = range ? Math.min(rows - 1, Math.max(range.r0, range.r1)) : rows - 1;
  const c0 = range ? Math.max(0, Math.min(range.c0, range.c1)) : 0;
  const c1 = range ? Math.min(cols - 1, Math.max(range.c0, range.c1)) : cols - 1;
  const out: { r: number; c: number }[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ r, c });
  return out;
}

/** Fond et bordures des cellules d'une plage (toutes si `range` est null). */
export function styleTableCells(
  g: TableNode,
  range: CellRange | null,
  patch: { fill?: Paint; borderColor?: string; borderWidth?: number },
): void {
  for (const { r, c } of cellsIn(g, range)) {
    const rect = cellRect(g, r, c);
    if (patch.fill) rect.fill = patch.fill;
    if (patch.borderColor !== undefined || patch.borderWidth !== undefined) {
      const width = patch.borderWidth ?? rect.stroke.width;
      const paint =
        patch.borderColor !== undefined
          ? solid(patch.borderColor)
          : rect.stroke.paint.type === 'none'
            ? solid(TABLE_BORDER)
            : rect.stroke.paint;
      rect.stroke = { ...rect.stroke, paint: width > 0 ? paint : NONE, width };
    }
  }
}

/** Ligne d'en-tête : la première ligne prend un fond distinct et un texte en gras. */
export function setTableHeader(g: TableNode, on: boolean): void {
  const { cols, rows } = g.table;
  g.table = { ...g.table, header: on };
  if (!on) delete g.table.header;
  const body = rows > 1 ? cellRect(g, 1, 0).fill : solid(TABLE_FILL);
  const weight = rows > 1 ? cellText(g, 1, 0).style.fontWeight : 400;
  for (let c = 0; c < cols; c++) {
    cellRect(g, 0, c).fill = on ? solid(TABLE_HEADER_FILL) : body;
    const t = cellText(g, 0, c);
    t.style = { ...t.style, fontWeight: on ? 700 : weight === 700 ? 400 : weight };
  }
}
