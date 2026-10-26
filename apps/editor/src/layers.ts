import type { Artboard, LiveFilter, PoulpeDocument, SceneNode } from '@poulpe/core';
import { editor } from './store';

/*
 * Liste des calques « à plat », dans l'ordre d'affichage du panneau (du dessus vers le dessous,
 * comme dans Affinity). Le panneau n'affiche que les lignes visibles de cette liste.
 */

export type LayerRow =
  | { kind: 'artboard'; key: string; artboard: Artboard }
  | { kind: 'empty'; key: string; artboard: Artboard }
  | {
      kind: 'node';
      key: string;
      node: SceneNode;
      /** Plan de travail ou groupe qui contient le calque. */
      parentId: string;
      /** Position dans `parent.children` (0 = tout en dessous). */
      index: number;
      depth: number;
    }
  /** Filtre en direct d'un calque, affiché sous lui. */
  | { kind: 'filter'; key: string; node: SceneNode; filter: LiveFilter; depth: number };

export function layerRows(doc: PoulpeDocument, collapsed: ReadonlySet<string>): LayerRow[] {
  const rows: LayerRow[] = [];
  const visit = (nodes: SceneNode[], parentId: string, depth: number) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      rows.push({ kind: 'node', key: node.id, node, parentId, index: i, depth });
      // Le dernier filtre appliqué en haut, comme dans Photoshop.
      for (let f = (node.filters?.length ?? 0) - 1; f >= 0; f--) {
        const filter = node.filters![f];
        rows.push({ kind: 'filter', key: `${node.id}:filter:${filter.id}`, node, filter, depth: depth + 1 });
      }
      if (node.type === 'group' && !collapsed.has(node.id)) visit(node.children, node.id, depth + 1);
    }
  };
  for (let a = doc.artboards.length - 1; a >= 0; a--) {
    const artboard = doc.artboards[a];
    rows.push({ kind: 'artboard', key: artboard.id, artboard });
    if (artboard.children.length) visit(artboard.children, artboard.id, 1);
    else rows.push({ kind: 'empty', key: `${artboard.id}:empty`, artboard });
  }
  return rows;
}

/** Ids des calques dans l'ordre d'affichage, groupes dépliés. */
function displayOrder(doc: PoulpeDocument): string[] {
  const ids: string[] = [];
  for (const r of layerRows(doc, new Set())) if (r.kind === 'node') ids.push(r.key);
  return ids;
}

/** Sélectionne le calque au-dessus (dir = -1) ou en dessous (dir = 1), comme Alt+] / Alt+[ dans Photoshop. */
export function selectAdjacentLayer(dir: -1 | 1, extend = false): void {
  const ids = displayOrder(editor.doc);
  if (!ids.length) return;
  const sel = editor.selection;
  const current = sel.length ? ids.indexOf(sel[sel.length - 1]) : -1;
  const next = current < 0 ? (dir > 0 ? 0 : ids.length - 1) : current + dir;
  if (next < 0 || next >= ids.length) return;
  const id = ids[next];
  editor.select(extend ? [...sel.filter((s) => s !== id), id] : [id]);
}

/** Calques entre deux lignes (incluses) de la liste affichée, pour Maj+clic. */
export function rangeBetween(rows: LayerRow[], a: string, b: string): string[] {
  const ids = rows.filter((r) => r.kind === 'node').map((r) => r.key);
  const i = ids.indexOf(a);
  const j = ids.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return ids.slice(Math.min(i, j), Math.max(i, j) + 1);
}
