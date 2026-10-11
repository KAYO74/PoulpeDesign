import { current, isDraft } from 'immer';
import {
  boxCenter,
  boxContains,
  clipMaskOf,
  nodeBounds,
  rotatePoint,
  unionBoxes,
  type Box,
  type Vec,
} from './geometry';
import { captureFrame, restoreFrame } from './frames';
import { newId } from './ids';
import type {
  Artboard,
  GroupNode,
  Parent,
  PoulpeDocument,
  SceneNode,
  StyledNode,
  SymbolNode,
  TextNode,
} from './types';

/** Multiplie les tailles de police d'un texte, plages comprises. */
export function scaleTextSize(node: TextNode, k: number): void {
  node.style = { ...node.style, fontSize: Math.max(1, node.style.fontSize * k) };
  if (node.runs)
    node.runs = node.runs.map((r) =>
      r.style.fontSize ? { ...r, style: { ...r.style, fontSize: Math.max(1, r.style.fontSize * k) } } : r,
    );
}

/*
 * Opérations sur l'arbre du document. Elles modifient l'objet reçu en place :
 * l'éditeur les appelle sur un brouillon immer, ce qui garde l'historique immuable.
 */

export interface NodeLocation {
  node: SceneNode;
  parent: Parent;
  index: number;
  artboard: Artboard;
}

/** L'objet a-t-il un remplissage et un contour (formes, tracés, textes) ? */
export function isStyled(n: SceneNode): n is StyledNode {
  return n.type !== 'group' && n.type !== 'image' && n.type !== 'adjustment' && n.type !== 'symbol';
}

/** Objets qui contiennent d'autres objets (groupe ou instance de symbole). */
export function isContainer(n: SceneNode): n is GroupNode | SymbolNode {
  return n.type === 'group' || n.type === 'symbol';
}

export function isGroup(n: SceneNode | Parent): n is GroupNode {
  return (n as SceneNode).type === 'group';
}

export function* walk(nodes: SceneNode[], parent: Parent, artboard: Artboard): Generator<NodeLocation> {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    yield { node, parent, index: i, artboard };
    if (node.type === 'group') yield* walk(node.children, node, artboard);
  }
}

export function* walkDocument(doc: PoulpeDocument): Generator<NodeLocation> {
  for (const ab of doc.artboards) yield* walk(ab.children, ab, ab);
}

export function findNode(doc: PoulpeDocument, id: string): NodeLocation | null {
  for (const loc of walkDocument(doc)) if (loc.node.id === id) return loc;
  return null;
}

export function findArtboard(doc: PoulpeDocument, id: string): Artboard | null {
  return doc.artboards.find((a) => a.id === id) ?? null;
}

export function findParent(doc: PoulpeDocument, id: string): Parent | null {
  return findArtboard(doc, id) ?? (findNode(doc, id)?.node as GroupNode | undefined) ?? null;
}

/** Chaîne des ancêtres (groupes) d'un objet, du plus haut au plus proche. */
export function ancestors(doc: PoulpeDocument, id: string): GroupNode[] {
  const path: GroupNode[] = [];
  const visit = (nodes: SceneNode[]): boolean => {
    for (const n of nodes) {
      if (n.id === id) return true;
      if (n.type === 'group') {
        path.push(n);
        if (visit(n.children)) return true;
        path.pop();
      }
    }
    return false;
  };
  for (const ab of doc.artboards) if (visit(ab.children)) return path;
  return [];
}

/** Retire de la liste les objets dont un ancêtre est déjà dans la liste. */
export function topLevelIds(doc: PoulpeDocument, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => !ancestors(doc, id).some((g) => set.has(g.id)) && findNode(doc, id));
}

export function selectionBounds(doc: PoulpeDocument, ids: string[]): Box | null {
  return unionBoxes(
    ids
      .map((id) => findNode(doc, id)?.node)
      .filter((n): n is SceneNode => !!n)
      .map(nodeBounds),
  );
}

/** Recalcule la boîte des groupes à partir de leurs enfants (les groupes n'ont pas de géométrie propre). */
export function fitGroups(doc: PoulpeDocument): void {
  const fit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      if (n.type !== 'group') continue;
      fit(n.children);
      const mask = clipMaskOf(n);
      const b = mask ? nodeBounds(mask) : unionBoxes(n.children.map(nodeBounds));
      if (b) Object.assign(n, { x: b.x, y: b.y, width: b.width, height: b.height, rotation: 0 });
    }
  };
  for (const ab of doc.artboards) fit(ab.children);
}

/** Supprime les groupes vides. */
export function pruneEmptyGroups(doc: PoulpeDocument): void {
  const prune = (p: Parent) => {
    p.children = p.children.filter((n) => {
      if (n.type !== 'group') return true;
      prune(n);
      return n.children.length > 0;
    });
  };
  doc.artboards.forEach(prune);
}

export function insertNode(parent: Parent, node: SceneNode, index = parent.children.length): void {
  parent.children.splice(Math.max(0, Math.min(index, parent.children.length)), 0, node);
}

export function removeNodes(doc: PoulpeDocument, ids: string[]): SceneNode[] {
  const removed: SceneNode[] = [];
  const set = new Set(ids);
  for (const loc of walkDocument(doc)) {
    if (set.has(loc.node.id) && loc.node.type === 'group')
      for (const d of walk(loc.node.children, loc.node, loc.artboard)) set.add(d.node.id);
  }
  closeTextChains(doc, set);
  const strip = (p: Parent) => {
    p.children = p.children.filter((n) => {
      if (set.has(n.id)) {
        removed.push(n);
        return false;
      }
      if (n.type === 'group') strip(n);
      return true;
    });
  };
  doc.artboards.forEach(strip);
  pruneEmptyGroups(doc);
  return removed;
}

export function translateNode(node: SceneNode, dx: number, dy: number): void {
  node.x += dx;
  node.y += dy;
  if (node.type === 'group') node.children.forEach((c) => translateNode(c, dx, dy));
}

/** Fait tourner un objet de `deg` degrés autour de `pivot`. */
export function rotateNode(node: SceneNode, deg: number, pivot: Vec): void {
  if (node.type === 'group') {
    node.children.forEach((c) => rotateNode(c, deg, pivot));
    return;
  }
  const c = rotatePoint(boxCenter(node), pivot, deg);
  node.x = c.x - node.width / 2;
  node.y = c.y - node.height / 2;
  node.rotation = normalizeAngle(node.rotation + deg);
}

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return Math.abs(a) < 1e-9 ? 0 : a;
}

/**
 * Met un objet à l'échelle (sx, sy) par rapport à `origin`, dans les axes du monde.
 * Pour un objet tourné, la taille est approchée dans ses propres axes (pas de cisaillement en v0.1).
 */
export function scaleNode(node: SceneNode, sx: number, sy: number, origin: Vec, scaleText = false): void {
  if (node.type === 'group') {
    // Cadre d'image : l'image ne suit pas le cadre, elle reprend son ajustement dans le nouveau cadre.
    const frame = node.picture ? captureFrame(node) : null;
    node.children.forEach((c) => scaleNode(c, sx, sy, origin, scaleText));
    if (frame) restoreFrame(node, frame);
    return;
  }
  const c = boxCenter(node);
  const nc = { x: origin.x + (c.x - origin.x) * sx, y: origin.y + (c.y - origin.y) * sy };
  const a = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(a),
    sin = Math.sin(a);
  const kw = Math.hypot(sx * cos, sy * sin);
  const kh = Math.hypot(sx * sin, sy * cos);
  node.width = Math.abs(node.width * kw);
  node.height = Math.abs(node.height * kh);
  node.x = nc.x - node.width / 2;
  node.y = nc.y - node.height / 2;
  if (node.type === 'line' && Math.sign(sx) * Math.sign(sy) < 0)
    node.direction = node.direction === 1 ? -1 : 1;
  if (node.type === 'text' && scaleText) {
    scaleTextSize(node, Math.sqrt(Math.abs(sx * sy)));
  }
}

/**
 * Avant de retirer des cadres de texte liés : la chaîne se referme sans eux, et si le premier
 * cadre disparaît, son texte passe au premier cadre qui reste.
 */
function closeTextChains(doc: PoulpeDocument, removed: Set<string>): void {
  const texts = new Map<string, TextNode>();
  for (const { node } of walkDocument(doc)) if (node.type === 'text') texts.set(node.id, node);
  const hasPrev = new Set<string>();
  for (const t of texts.values()) if (t.next && texts.has(t.next)) hasPrev.add(t.next);
  for (const head of texts.values()) {
    if (hasPrev.has(head.id) || !head.next) continue;
    const chain: TextNode[] = [];
    const seen = new Set<string>();
    for (
      let n: TextNode | undefined = head;
      n && !seen.has(n.id);
      n = n.next ? texts.get(n.next) : undefined
    ) {
      seen.add(n.id);
      chain.push(n);
    }
    const kept = chain.filter((n) => !removed.has(n.id));
    if (kept.length === chain.length || !kept.length) continue;
    const first = kept[0];
    if (first !== head) {
      first.text = head.text;
      first.style = head.style;
      first.fill = head.fill;
      first.stroke = head.stroke;
      if (head.runs) first.runs = head.runs;
      else delete first.runs;
    }
    kept.forEach((n, i) => {
      if (kept[i + 1]) n.next = kept[i + 1].id;
      else delete n.next;
    });
  }
}

/** Copie profonde avec de nouveaux identifiants. Une copie de cadre de texte n'est liée à rien. */
export function cloneWithNewIds<T extends SceneNode>(node: T): T {
  // Dans une modification en cours (brouillon immer), on copie l'état courant de l'objet.
  const copy = structuredClone(isDraft(node) ? current(node) : node) as T;
  const renew = (n: SceneNode) => {
    n.id = newId();
    if (n.type === 'text') delete n.next;
    if (n.type === 'group') n.children.forEach(renew);
  };
  renew(copy);
  return copy;
}

/**
 * Copie de plusieurs objets avec de nouveaux identifiants ; les liens entre cadres de texte copiés
 * ensemble sont conservés (ils pointent vers les copies).
 */
export function cloneNodesKeepLinks(nodes: SceneNode[]): SceneNode[] {
  const map = new Map<string, string>();
  const links: [TextNode, string][] = [];
  const copies = nodes.map((node) => {
    const copy = structuredClone(isDraft(node) ? current(node) : node) as SceneNode;
    const renew = (n: SceneNode) => {
      const id = newId();
      map.set(n.id, id);
      n.id = id;
      if (n.type === 'text' && n.next) links.push([n, n.next]);
      if (n.type === 'group') n.children.forEach(renew);
    };
    renew(copy);
    return copy;
  });
  for (const [t, next] of links) {
    const m = map.get(next);
    if (m) t.next = m;
    else delete t.next;
  }
  return copies;
}

export type ZOrder = 'forward' | 'backward' | 'front' | 'back';

export function reorderNodes(doc: PoulpeDocument, ids: string[], order: ZOrder): void {
  const byParent = new Map<Parent, string[]>();
  for (const id of topLevelIds(doc, ids)) {
    const loc = findNode(doc, id);
    if (!loc) continue;
    byParent.set(loc.parent, [...(byParent.get(loc.parent) ?? []), id]);
  }
  for (const [parent, list] of byParent) {
    const set = new Set(list);
    const moving = parent.children.filter((n) => set.has(n.id));
    const rest = parent.children.filter((n) => !set.has(n.id));
    if (order === 'front') parent.children = [...rest, ...moving];
    else if (order === 'back') parent.children = [...moving, ...rest];
    else {
      const kids = parent.children;
      if (order === 'forward') {
        for (let i = kids.length - 2; i >= 0; i--)
          if (set.has(kids[i].id) && !set.has(kids[i + 1].id))
            [kids[i], kids[i + 1]] = [kids[i + 1], kids[i]];
      } else {
        for (let i = 1; i < kids.length; i++)
          if (set.has(kids[i].id) && !set.has(kids[i - 1].id))
            [kids[i], kids[i - 1]] = [kids[i - 1], kids[i]];
      }
    }
  }
}

/** Regroupe les objets dans le parent du plus haut d'entre eux. Renvoie l'id du groupe. */
export function groupNodes(doc: PoulpeDocument, ids: string[], group: GroupNode): string | null {
  const top = topLevelIds(doc, ids);
  if (!top.length) return null;
  // Ordre d'empilement conservé : on parcourt le document de bas en haut.
  const ordered = [...walkDocument(doc)].filter((l) => top.includes(l.node.id));
  const anchor = ordered[ordered.length - 1];
  const set = new Set(top);
  const parent = anchor.parent;
  const insertAt = parent.children.slice(0, anchor.index).filter((n) => !set.has(n.id)).length;
  group.children = removeNodesKeepOrder(
    doc,
    ordered.map((l) => l.node.id),
  );
  insertNode(parent, group, insertAt);
  pruneEmptyGroups(doc);
  fitGroups(doc);
  return group.id;
}

function removeNodesKeepOrder(doc: PoulpeDocument, orderedIds: string[]): SceneNode[] {
  const nodes = orderedIds.map((id) => findNode(doc, id)!.node);
  const set = new Set(orderedIds);
  const strip = (p: Parent) => {
    p.children = p.children.filter((n) => {
      if (set.has(n.id)) return false;
      if (n.type === 'group') strip(n);
      return true;
    });
  };
  doc.artboards.forEach(strip);
  return nodes;
}

/** Dissout un groupe : ses enfants prennent sa place. Renvoie les ids des enfants. */
export function ungroupNode(doc: PoulpeDocument, id: string): string[] {
  const loc = findNode(doc, id);
  if (!loc || loc.node.type !== 'group') return [];
  const g = loc.node;
  loc.parent.children.splice(loc.index, 1, ...g.children);
  fitGroups(doc);
  return g.children.map((c) => c.id);
}

/** Déplace un objet vers un autre parent (plan de travail ou groupe), à l'index donné. */
export function moveNodeTo(doc: PoulpeDocument, id: string, parentId: string, index: number): boolean {
  const loc = findNode(doc, id);
  const target = findParent(doc, parentId);
  if (!loc || !target) return false;
  if (target !== loc.artboard && ancestors(doc, (target as GroupNode).id).some((g) => g.id === id))
    return false;
  if ((target as SceneNode).id === id) return false;
  let i = index;
  if (loc.parent === target && loc.index < index) i -= 1;
  loc.parent.children.splice(loc.index, 1);
  insertNode(target, loc.node, i);
  pruneEmptyGroups(doc);
  fitGroups(doc);
  return true;
}

/**
 * Déplace plusieurs objets vers un parent, à l'index donné (compté dans les enfants actuels du
 * parent), en gardant leur ordre d'empilement. Sert au glisser-déposer de plusieurs calques.
 */
export function moveNodesTo(doc: PoulpeDocument, ids: string[], parentId: string, index: number): boolean {
  const target = findParent(doc, parentId);
  if (!target || !Array.isArray(target.children)) return false;
  const targetId = (target as SceneNode).id;
  // On ne peut pas glisser un groupe dans lui-même ni dans un de ses descendants.
  const inside =
    'type' in target && target.type === 'group'
      ? new Set([targetId, ...ancestors(doc, targetId).map((g) => g.id)])
      : new Set<string>();
  const top = topLevelIds(doc, ids).filter((id) => !inside.has(id));
  if (!top.length) return false;
  const set = new Set(top);
  const ordered = [...walkDocument(doc)].filter((l) => set.has(l.node.id)).map((l) => l.node.id);
  const before = target.children.slice(0, index).filter((n) => set.has(n.id)).length;
  const nodes = removeNodesKeepOrder(doc, ordered);
  const at = Math.max(0, Math.min(index - before, target.children.length));
  target.children.splice(at, 0, ...nodes);
  pruneEmptyGroups(doc);
  fitGroups(doc);
  return true;
}

/** Plan de travail sous un point du monde (le plus haut s'ils se chevauchent). */
export function artboardAt(doc: PoulpeDocument, p: Vec): Artboard | null {
  for (let i = doc.artboards.length - 1; i >= 0; i--) {
    const a = doc.artboards[i];
    if (boxContains(a, p)) return a;
  }
  return null;
}

/**
 * Après un déplacement, rattache chaque objet de premier niveau au plan de travail
 * qui contient son centre (comme quand on glisse un objet d'un plan de travail à l'autre).
 */
export function reparentToArtboards(doc: PoulpeDocument, ids: string[]): void {
  for (const id of ids) {
    const loc = findNode(doc, id);
    if (!loc || loc.parent !== loc.artboard) continue;
    const target = artboardAt(doc, boxCenter(nodeBounds(loc.node)));
    if (target && target !== loc.artboard) {
      loc.parent.children.splice(loc.index, 1);
      target.children.push(loc.node);
    }
  }
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Aligne les objets sur la boîte de la sélection, ou sur leur plan de travail s'il n'y a qu'un objet. */
export function alignNodes(doc: PoulpeDocument, ids: string[], mode: AlignMode): void {
  const top = topLevelIds(doc, ids);
  if (!top.length) return;
  const ref: Box | null = top.length === 1 ? findNode(doc, top[0])!.artboard : selectionBounds(doc, top);
  if (!ref) return;
  for (const id of top) {
    const n = findNode(doc, id)!.node;
    const b = nodeBounds(n);
    let dx = 0,
      dy = 0;
    if (mode === 'left') dx = ref.x - b.x;
    if (mode === 'hcenter') dx = ref.x + ref.width / 2 - (b.x + b.width / 2);
    if (mode === 'right') dx = ref.x + ref.width - (b.x + b.width);
    if (mode === 'top') dy = ref.y - b.y;
    if (mode === 'vcenter') dy = ref.y + ref.height / 2 - (b.y + b.height / 2);
    if (mode === 'bottom') dy = ref.y + ref.height - (b.y + b.height);
    translateNode(n, dx, dy);
  }
  fitGroups(doc);
}

/** Répartit les objets avec un espacement égal entre eux. */
export function distributeNodes(doc: PoulpeDocument, ids: string[], axis: 'h' | 'v'): void {
  const items = topLevelIds(doc, ids)
    .map((id) => {
      const node = findNode(doc, id)!.node;
      return { node, b: nodeBounds(node) };
    })
    .sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
  if (items.length < 3) return;
  const first = items[0].b,
    last = items[items.length - 1].b;
  const size = (b: Box) => (axis === 'h' ? b.width : b.height);
  const start = axis === 'h' ? first.x : first.y;
  const end = axis === 'h' ? last.x + last.width : last.y + last.height;
  const total = items.reduce((s, i) => s + size(i.b), 0);
  const gap = (end - start - total) / (items.length - 1);
  let cursor = start;
  for (const { node, b } of items) {
    const pos = axis === 'h' ? b.x : b.y;
    translateNode(node, axis === 'h' ? cursor - pos : 0, axis === 'v' ? cursor - pos : 0);
    cursor += size(b) + gap;
  }
  fitGroups(doc);
}

export function allNodeIds(doc: PoulpeDocument): string[] {
  return [...walkDocument(doc)].map((l) => l.node.id);
}
