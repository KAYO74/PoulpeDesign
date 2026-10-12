import { nodeBounds, type Box } from './geometry';
import { isStyled, scaleNode, translateNode } from './tree';
import type { Artboard, SceneNode } from './types';

/*
 * Redimensionnement d'un design vers un autre format (comme « Redimensionner » dans Canva).
 *
 * Changer seulement la taille du plan de travail laisserait les objets en place ; tout étirer
 * déformerait le texte et les images. On fait comme un graphiste, axe par axe :
 *  - tout est mis à l'échelle du plus petit des deux rapports, pour tenir dans le nouveau format,
 *    sans déformation ;
 *  - un objet qui couvre (presque) toute la largeur ou la hauteur, comme un fond ou un bandeau,
 *    est étiré dans ce sens pour la couvrir encore (une image grandit sans se déformer) ;
 *  - un objet qui touche un bord, ou qui en dépasse, reste collé à ce bord ;
 *  - un objet posé sur un autre (un texte sur un bandeau, sur un badge) suit celui qui le porte ;
 *  - les autres objets forment un bloc qui garde sa disposition et sa place relative.
 */

/** Part de la largeur ou de la hauteur à partir de laquelle un objet est considéré comme pleine page. */
const FULL = 0.9;
/** Distance au bord (en part du côté) en dessous de laquelle un objet est collé au bord. */
const EDGE = 0.02;

interface Item {
  node: SceneNode;
  /** Boîte dans le repère du plan de travail, avant et après. */
  box: Box;
  next?: Box;
  full: [boolean, boolean];
  host?: Item;
}

type Axis = 0 | 1;
const start = (b: Box, a: Axis) => (a ? b.y : b.x);
const size = (b: Box, a: Axis) => (a ? b.height : b.width);

function contains(outer: Box, inner: Box): boolean {
  const t = 2;
  return (
    inner.x >= outer.x - t &&
    inner.y >= outer.y - t &&
    inner.x + inner.width <= outer.x + outer.width + t &&
    inner.y + inner.height <= outer.y + outer.height + t
  );
}

/**
 * Donne au plan de travail la taille `width` × `height` et réarrange son contenu.
 * Modifie le plan de travail en place (à appeler sur un brouillon de l'éditeur).
 */
export function resizeArtboard(ab: Artboard, width: number, height: number): void {
  const total = [ab.width, ab.height];
  const next = [width, height];
  const ratio = [width / ab.width, height / ab.height];
  const k = Math.min(ratio[0], ratio[1]);
  const items: Item[] = ab.children.map((node) => {
    const b = nodeBounds(node);
    const box = { x: b.x - ab.x, y: b.y - ab.y, width: b.width, height: b.height };
    const isText = node.type === 'text' || (node.type === 'group' && hasText(node.children));
    return {
      node,
      box,
      full: [!isText && box.width >= ab.width * FULL, !isText && box.height >= ab.height * FULL],
    };
  });
  // Support de chaque objet : le plus petit objet (hors fond pleine page) qui le contient.
  const area = (i: Item) => i.box.width * i.box.height;
  for (const it of items) {
    let best: Item | undefined;
    for (const other of items) {
      if (other === it || (other.full[0] && other.full[1]) || other.node.type === 'text') continue;
      if (area(other) <= area(it) || !contains(other.box, it.box)) continue;
      if (!best || area(other) < area(best)) best = other;
    }
    it.host = best;
  }
  // Bloc des objets libres (ni pleine page, ni collés à un bord, ni portés), par axe.
  const pinned = (it: Item, a: Axis) => {
    const s0 = start(it.box, a),
      s1 = s0 + size(it.box, a);
    return { start: s0 <= total[a] * EDGE, end: s1 >= total[a] * (1 - EDGE) };
  };
  const block = ([0, 1] as Axis[]).map((a) => {
    const free = items.filter((it) => {
      const p = pinned(it, a);
      return !it.host && !it.full[a] && p.start === p.end;
    });
    if (!free.length) return null;
    const s0 = Math.min(...free.map((it) => start(it.box, a)));
    const s1 = Math.max(...free.map((it) => start(it.box, a) + size(it.box, a)));
    const center = ((s0 + s1) / 2 / total[a]) * next[a];
    return { from: s0, to: center - ((s1 - s0) * k) / 2 };
  });

  const newStart = (it: Item, a: Axis, newSize: number): number => {
    const s0 = start(it.box, a),
      sz = size(it.box, a);
    if (it.host?.next) {
      // Suit son support : même position relative à l'intérieur.
      const h = it.host;
      const rel = (s0 + sz / 2 - start(h.box, a)) / size(h.box, a);
      return start(h.next!, a) + rel * size(h.next!, a) - newSize / 2;
    }
    if (it.full[a]) return ((s0 + sz / 2) / total[a]) * next[a] - newSize / 2;
    const p = pinned(it, a);
    if (p.start && !p.end) return s0 * k;
    if (p.end && !p.start) return next[a] - (total[a] - s0 - sz) * k - newSize;
    if (p.start && p.end) return ((s0 + sz / 2) / total[a]) * next[a] - newSize / 2;
    const b = block[a]!;
    return b.to + (s0 - b.from) * k;
  };

  // Les supports d'abord : les plus grands objets passent avant ceux qu'ils portent.
  const order = [...items].sort((p, q) => area(q) - area(p));
  for (const it of order) {
    const { node } = it;
    let fx = it.full[0] && !it.host ? ratio[0] : k,
      fy = it.full[1] && !it.host ? ratio[1] : k;
    // Une image ne se déforme pas : elle grandit assez pour couvrir ce qu'elle couvrait.
    if (node.type === 'image' && (fx !== k || fy !== k)) fx = fy = Math.max(fx, fy);
    const b = nodeBounds(node);
    scaleNode(node, fx, fy, { x: b.x, y: b.y }, true);
    scaleDetails(node, k);
    const nb = nodeBounds(node);
    const nx = newStart(it, 0, nb.width);
    const ny = newStart(it, 1, nb.height);
    translateNode(node, ab.x + nx - nb.x, ab.y + ny - nb.y);
    it.next = { x: nx, y: ny, width: nb.width, height: nb.height };
  }
  ab.width = width;
  ab.height = height;
}

/**
 * Épaisseurs de contour, arrondis et autres distances en pixels (contour, habillage, marges et
 * gouttière des cadres de texte) suivent la mise à l'échelle.
 */
function scaleDetails(node: SceneNode, k: number): void {
  if (node.wrap?.distance) node.wrap = { ...node.wrap, distance: node.wrap.distance * k };
  if (node.type === 'group') return node.children.forEach((c) => scaleDetails(c, k));
  if (!isStyled(node)) return;
  node.stroke = { ...node.stroke, width: node.stroke.width * k };
  if (node.contour) node.contour = { ...node.contour, radius: node.contour.radius * k };
  if (node.type === 'text') {
    if (node.insets) node.insets = node.insets.map((v) => v * k) as [number, number, number, number];
    const cols = node.style.columns;
    if (cols?.gap) node.style = { ...node.style, columns: { ...cols, gap: cols.gap * k } };
  }
  if (node.type === 'rect') {
    node.cornerRadius *= k;
    if (node.radii) node.radii = node.radii.map((r) => r * k) as [number, number, number, number];
  }
  if ((node.type === 'polygon' || node.type === 'star' || node.type === 'path') && node.corners)
    node.corners = Object.fromEntries(
      Object.entries(node.corners).map(([key, c]) => [key, { ...c, radius: c.radius * k }]),
    );
  if (node.type === 'path' && node.shape?.params.radius !== undefined)
    node.shape = { ...node.shape, params: { ...node.shape.params, radius: node.shape.params.radius * k } };
}

function hasText(nodes: Artboard['children']): boolean {
  return nodes.some((n) => n.type === 'text' || (n.type === 'group' && hasText(n.children)));
}
