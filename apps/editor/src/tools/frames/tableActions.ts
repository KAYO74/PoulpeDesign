import {
  artboardAt,
  cellOf,
  cellText,
  createTable,
  documentDpi,
  findArtboard,
  findNode,
  fitTableRows,
  insertTableCol,
  insertTableRow,
  isTable,
  layoutText,
  removeTableCols,
  removeTableRows,
  resizeTableGrid,
  setTableHeader,
  solid,
  styleTableCells,
  untouched,
  type Box,
  type CellRange,
  type PoulpeDocument,
  type SceneNode,
  type TableNode,
  type TextNode,
  type Vec,
} from '@poulpe/core';
import { getLayoutRevision, measureText } from '@poulpe/render';
import {
  beginTextEdit,
  currentEditedText,
  editedTextId,
  endTextEdit,
  isEditingText,
  setTextSelection,
} from '../../canvas/textEdit';
import { t } from '../../i18n';
import { editor, ui } from '../../store';
import { framesState } from './state';

/*
 * Tableaux : création à l'outil Tableau, lignes et colonnes, en-tête, fond et bordures des
 * cellules, passage d'une cellule à l'autre au clavier. Le modèle est dans core/tables.ts.
 */

// ————— Hauteur des lignes —————

const heights = new Map<string, number>();
let heightsRevision = -1;
/** Hauteurs des cellules restées telles quelles (objets figés du document), sans clé à calculer. */
let cellHeights = new WeakMap<TextNode, number>();
/** Tableaux déjà ajustés (objets figés du document), avec la révision des polices de l'ajustement. */
const fitted = new WeakMap<TableNode, number>();

/** Hauteur du texte d'une cellule (mémorisée par contenu, comme normalize.ts). */
function contentHeight(n: TextNode): number {
  if (heightsRevision !== getLayoutRevision()) {
    cellHeights = new WeakMap();
    heights.clear();
    heightsRevision = getLayoutRevision();
  } else if (heights.size > 4000) heights.clear();
  const base = untouched(n);
  const known = base ? cellHeights.get(base) : undefined;
  if (known !== undefined) return known;
  const key = JSON.stringify([n.text, n.runs, n.style, Math.round(n.width * 100)]);
  let h = heights.get(key);
  if (h === undefined) {
    h = n.text ? layoutText({ ...n, autoWidth: false }, measureText).height : 0;
    heights.set(key, h);
  }
  if (base) cellHeights.set(base, h);
  return h;
}

/**
 * Passe exécutée après chaque modification (avec celle des textes) : les lignes des tableaux
 * grandissent avec leur texte et les cellules restent sur la grille, même après un redimensionnement.
 */
export function normalizeTables(doc: PoulpeDocument): void {
  const rev = getLayoutRevision();
  const visit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      if (n.type !== 'group') continue;
      if (!isTable(n)) {
        visit(n.children);
        continue;
      }
      // Un tableau que la modification n'a pas touché, déjà ajusté avec ces polices, est sauté.
      const base = untouched(n);
      if (base && fitted.get(base) === rev) continue;
      fitTableRows(n, contentHeight);
      // L'ajustement n'a rien changé : l'objet figé est à jour.
      if (base && untouched(n) === base) fitted.set(base, rev);
    }
  };
  for (const ab of doc.artboards) visit(ab.children);
}

// ————— Repérage —————

/** Tableau qui contient l'objet `id` (le tableau lui-même ou une de ses cellules). */
export function tableOf(
  doc: PoulpeDocument,
  id: string | null | undefined,
): { table: TableNode; cell: { r: number; c: number } | null } | null {
  if (!id) return null;
  const loc = findNode(doc, id);
  if (!loc) return null;
  if (isTable(loc.node)) return { table: loc.node, cell: null };
  const parent = loc.parent as SceneNode;
  if (isTable(parent)) return { table: parent, cell: cellOf(parent, id) };
  return null;
}

/** Tableau sélectionné, ou dont une cellule est sélectionnée ou en cours d'édition. */
export function selectedTable(doc: PoulpeDocument, selection: string[]): TableNode | null {
  const editing = ui.get().editingTextId;
  return (
    (tableOf(doc, editing) ?? (selection.length === 1 ? tableOf(doc, selection[0]) : null))?.table ?? null
  );
}

/** Cellules visées par les réglages : la plage choisie dans ce tableau, sinon tout le tableau. */
export function targetRange(table: TableNode): CellRange | null {
  const cells = framesState.get().cells;
  const cell = tableOf(editor.doc, ui.get().editingTextId)?.cell;
  // Les cellules choisies valent avec l'outil Tableau ou pendant la saisie dans ce tableau.
  if (cells?.tableId === table.id && (ui.get().tool === 'table' || cell)) return cells.range;
  return cell ? { r0: cell.r, c0: cell.c, r1: cell.r, c1: cell.c } : null;
}

// ————— Création —————

/** Taille du texte des nouveaux tableaux : 12 points à la résolution du document. */
function tableFontSize(doc: PoulpeDocument): number {
  return Math.max(6, Math.round((12 / 72) * documentDpi(doc)));
}

/**
 * Crée un tableau dans la boîte glissée, ou à sa taille par défaut à partir du point cliqué, et
 * commence la saisie dans sa première cellule.
 */
export function createTableAt(at: Vec, box: Box | null): string | null {
  const doc = editor.doc;
  const ab = artboardAt(doc, at) ?? findArtboard(doc, editor.getState().activeArtboardId) ?? doc.artboards[0];
  if (!ab) return null;
  const { rows, cols, header } = framesState.get();
  const style = { ...ui.get().defaults.text, fontSize: tableFontSize(doc), align: 'left' as const };
  const b = box ?? {
    x: at.x,
    y: at.y,
    width: style.fontSize * 6 * cols,
    height: 0,
  };
  const table = createTable({
    ...b,
    rows,
    cols,
    style,
    header,
    names: { table: t('frames.tableName'), cell: t('frames.cellName'), text: t('name.text') },
  });
  editor.apply('history.table', (d) => {
    findArtboard(d, ab.id)!.children.push(table);
    return [table.id];
  });
  editor.setActiveArtboard(ab.id);
  editCell(table.id, 0, 0);
  return table.id;
}

/** Commence la saisie dans une cellule (et en fait la cellule choisie). */
export function editCell(tableId: string, r: number, c: number): void {
  const table = findNode(editor.doc, tableId)?.node;
  if (!isTable(table)) return;
  const text = cellText(table, r, c);
  framesState.set({ cells: { tableId, range: { r0: r, c0: c, r1: r, c1: c } } });
  if (isEditingText()) {
    endTextEdit();
    (document.activeElement as HTMLElement | null)?.blur();
  }
  beginTextEdit(text.id, false);
  // La zone de saisie de la nouvelle cellule peut être recréée juste après : on y remet le focus
  // (tout son texte choisi, comme en passant d'une cellule à l'autre dans Affinity). Si l'on a
  // déjà tapé entre-temps, on ne choisit rien : la frappe serait remplacée.
  const start = text.text;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (editedTextId() !== text.id) return;
      const now = currentEditedText();
      if (now === start) setTextSelection(0, now.length);
      else if (!(document.activeElement instanceof HTMLTextAreaElement)) setTextSelection(now.length);
    }),
  );
}

/**
 * Tab et Maj+Tab pendant la saisie dans une cellule : cellule suivante ou précédente. Tab dans
 * la dernière cellule ajoute une ligne, comme dans un traitement de texte.
 */
export function moveToCell(dir: 1 | -1): boolean {
  const found = tableOf(editor.doc, editedTextId());
  if (!found?.cell) return false;
  const { table, cell } = found;
  const { rows, cols } = table.table;
  let i = cell.r * cols + cell.c + dir;
  if (i < 0) i = 0;
  const id = table.id;
  if (i >= rows * cols) {
    endTextEdit();
    (document.activeElement as HTMLElement | null)?.blur();
    editor.apply('history.table', (d) => {
      const g = findNode(d, id)?.node;
      if (isTable(g)) insertTableRow(g, g.table.rows);
    });
  }
  editCell(id, Math.floor(i / cols), i % cols);
  return true;
}

// ————— Réglages —————

function editTable(label: string, fn: (g: TableNode) => void): void {
  const table = selectedTable(editor.doc, editor.selection);
  if (!table) return;
  const id = table.id;
  // La saisie en cours est enregistrée avant de changer la structure du tableau.
  const editing = editedTextId();
  const cell = tableOf(editor.doc, editing)?.cell ?? null;
  if (editing) {
    endTextEdit();
    (document.activeElement as HTMLElement | null)?.blur();
  }
  editor.apply(label, (d) => {
    const g = findNode(d, id)?.node;
    if (isTable(g)) fn(g);
    return [id];
  });
  const after = findNode(editor.doc, id)?.node;
  if (cell && isTable(after) && cell.r < after.table.rows && cell.c < after.table.cols)
    editCell(id, cell.r, cell.c);
}

/** Lignes et colonnes choisies (la cellule en cours, ou la dernière à défaut). */
function rangeOr(table: TableNode): CellRange {
  return (
    targetRange(table) ?? {
      r0: table.table.rows - 1,
      c0: table.table.cols - 1,
      r1: table.table.rows - 1,
      c1: table.table.cols - 1,
    }
  );
}

export function setTableGrid(rows: number, cols: number): void {
  const table = selectedTable(editor.doc, editor.selection);
  if (!table) {
    framesState.set({ rows: Math.max(1, Math.round(rows)), cols: Math.max(1, Math.round(cols)) });
    return;
  }
  framesState.set({ cells: null });
  editTable('history.table', (g) => resizeTableGrid(g, rows, cols));
}

export function addTableRow(where: 'above' | 'below'): void {
  const table = selectedTable(editor.doc, editor.selection);
  if (!table) return;
  const r = rangeOr(table);
  const at = where === 'above' ? Math.min(r.r0, r.r1) : Math.max(r.r0, r.r1) + 1;
  framesState.set({ cells: null });
  editTable('history.table', (g) => insertTableRow(g, at));
}

export function addTableCol(where: 'left' | 'right'): void {
  const table = selectedTable(editor.doc, editor.selection);
  if (!table) return;
  const r = rangeOr(table);
  const at = where === 'left' ? Math.min(r.c0, r.c1) : Math.max(r.c0, r.c1) + 1;
  framesState.set({ cells: null });
  editTable('history.table', (g) => insertTableCol(g, at));
}

export function removeTableRow(): void {
  const table = selectedTable(editor.doc, editor.selection);
  if (!table || table.table.rows < 2) return;
  const r = rangeOr(table);
  framesState.set({ cells: null });
  if (isEditingText()) endTextEdit();
  editTable('history.table', (g) => removeTableRows(g, r.r0, r.r1));
}

export function removeTableCol(): void {
  const table = selectedTable(editor.doc, editor.selection);
  if (!table || table.table.cols < 2) return;
  const r = rangeOr(table);
  framesState.set({ cells: null });
  if (isEditingText()) endTextEdit();
  editTable('history.table', (g) => removeTableCols(g, r.c0, r.c1));
}

export function setTableHeaderRow(on: boolean): void {
  const table = selectedTable(editor.doc, editor.selection);
  if (!table) {
    framesState.set({ header: on });
    return;
  }
  editTable('history.table', (g) => setTableHeader(g, on));
}

/** Fond des cellules choisies (ou de tout le tableau). */
export function setCellFill(color: string | null): void {
  const table = selectedTable(editor.doc, editor.selection);
  if (!table) return;
  const range = targetRange(table);
  editTable('history.table', (g) =>
    styleTableCells(g, range, { fill: color ? solid(color) : { type: 'none' } }),
  );
}

/** Bordures des cellules choisies (ou de tout le tableau). */
export function setCellBorder(patch: { borderColor?: string; borderWidth?: number }): void {
  const table = selectedTable(editor.doc, editor.selection);
  if (!table) return;
  const range = targetRange(table);
  editTable('history.table', (g) => styleTableCells(g, range, patch));
}
