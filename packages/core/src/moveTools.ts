import { NONE, createGroup, createRect } from './factory';
import { isPictureFrame } from './frames';
import { boxCenter, hitNode, nodeBounds, rad, type Box, type Vec } from './geometry';
import { applyStyle, styleFromNode } from './styles';
import { isTable } from './tables';
import {
  cloneWithNewIds,
  findNode,
  groupNodes,
  normalizeAngle,
  scaleTextSize,
  topLevelIds,
  ungroupNode,
} from './tree';
import type { GroupNode, PoulpeDocument, SavedStyle, SceneNode } from './types';

/*
 * Outil Déplacer (sélection automatique, objet de dessous, duplication intelligente), Recadrage
 * vectoriel et Pipette de style, comme dans Affinity Designer et Publisher.
 */

// ————— Sélection automatique —————

/** Ce qu'un clic sélectionne : l'objet du plan de travail, le groupe le plus proche, ou l'objet lui-même. */
export type AutoSelect = 'layer' | 'group' | 'object';

/** Recadrage vectoriel : groupe à masque dont le premier enfant est le cadre. */
export function isVectorCrop(n: SceneNode | null | undefined): n is GroupNode {
  return !!n && n.type === 'group' && !!n.vectorCrop && n.clip && n.children.length > 1;
}

/** Groupes choisis d'un bloc, comme un seul objet : cadres d'image, tableaux, objets recadrés. */
export function isSolidGroup(n: SceneNode): boolean {
  return n.type === 'group' && (isPictureFrame(n) || isTable(n) || isVectorCrop(n));
}

/**
 * Objets sous le point, du dessus vers le dessous, au niveau demandé : objets des plans de
 * travail (`layer`), groupes qui contiennent directement l'objet touché (`group`), ou objets
 * eux-mêmes (`object`). Sert au clic de l'outil Déplacer et à Alt + clic (objet de dessous).
 */
export function nodesAt(doc: PoulpeDocument, p: Vec, tolerance: number, mode: AutoSelect): SceneNode[] {
  const out: SceneNode[] = [];
  const seen = new Set<string>();
  const push = (n: SceneNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
  };
  const visit = (nodes: SceneNode[], parent: GroupNode | null) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!n.visible || n.locked || !hitNode(n, p, tolerance)) continue;
      if (mode === 'layer' || n.type !== 'group' || isSolidGroup(n))
        push(mode === 'group' && parent ? parent : n);
      else visit(n.children, n);
    }
  };
  for (let a = doc.artboards.length - 1; a >= 0; a--) {
    const ab = doc.artboards[a];
    if (p.x < ab.x || p.y < ab.y || p.x > ab.x + ab.width || p.y > ab.y + ab.height) continue;
    visit(ab.children, null);
  }
  return out;
}

/**
 * Objet choisi par Alt + clic : celui de dessous l'objet sélectionné sous le pointeur (au premier
 * clic, celui de dessous l'objet du dessus), en revenant au premier après le dernier.
 */
export function objectBehind(stack: SceneNode[], selection: string[]): SceneNode | null {
  if (!stack.length) return null;
  const i = stack.findIndex((n) => selection.includes(n.id));
  if (i < 0) return stack[Math.min(1, stack.length - 1)];
  return stack[(i + 1) % stack.length];
}

// ————— Duplication intelligente —————

/** Transformation affine du plan : x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function multiplyAffine(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function invertAffine(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Repère d'un objet : le carré unité centré devient sa boîte tournée (tailles nulles remplacées). */
function frameMatrix(n: SceneNode, w = n.width, h = n.height): Affine {
  const r = rad(n.rotation);
  const cos = Math.cos(r),
    sin = Math.sin(r);
  return { a: cos * w, b: sin * w, c: -sin * h, d: cos * h, e: n.x + n.width / 2, f: n.y + n.height / 2 };
}

/** Premier objet simple (hors groupe) à la même place dans deux arbres de même forme. */
function firstLeafPair(s: SceneNode, c: SceneNode): [SceneNode, SceneNode] | null {
  if (s.type !== c.type) return null;
  if (s.type === 'group' && c.type === 'group') {
    if (s.children.length !== c.children.length) return null;
    for (let i = 0; i < s.children.length; i++) {
      const pair = firstLeafPair(s.children[i], c.children[i]);
      if (pair) return pair;
    }
    return null;
  }
  return [s, c];
}

/**
 * Transformation qui mène d'un objet à sa copie (déplacée, tournée, mise à l'échelle), lue sur
 * leur premier objet simple. Null si la copie n'a plus la même forme que l'original.
 */
export function transformBetween(src: SceneNode, copy: SceneNode): Affine | null {
  const pair = firstLeafPair(src, copy);
  if (!pair) return null;
  const [s, c] = pair;
  // Un axe de taille nulle (ligne horizontale) ne dit rien de l'échelle sur cet axe.
  const flatW = s.width < 1e-9 || c.width < 1e-9;
  const flatH = s.height < 1e-9 || c.height < 1e-9;
  const inv = invertAffine(frameMatrix(s, flatW ? 1 : s.width, flatH ? 1 : s.height));
  if (!inv) return null;
  return multiplyAffine(frameMatrix(c, flatW ? 1 : c.width, flatH ? 1 : c.height), inv);
}

/** Applique une transformation affine à un objet, sur place (sans cisaillement, comme `scaleNode`). */
export function applyAffine(node: SceneNode, t: Affine): void {
  if (node.type === 'group') {
    node.children.forEach((c) => applyAffine(c, t));
    return;
  }
  const m = multiplyAffine(t, frameMatrix(node));
  const l1 = Math.hypot(m.a, m.b),
    l2 = Math.hypot(m.c, m.d);
  let deg = node.rotation;
  if (l1 > 1e-9) deg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  else if (l2 > 1e-9) deg = (Math.atan2(-m.c, m.d) * 180) / Math.PI;
  const r = rad(deg);
  const w = l1 > 1e-9 ? l1 : 0;
  // Hauteur dans l'axe tourné : négative si la copie est retournée.
  const h = -m.c * Math.sin(r) + m.d * Math.cos(r);
  node.width = w;
  node.height = Math.abs(h);
  node.rotation = normalizeAngle(deg);
  node.x = m.e - w / 2;
  node.y = m.f - Math.abs(h) / 2;
  if (h < 0 && node.type === 'line') node.direction = node.direction === 1 ? -1 : 1;
}

/**
 * Duplication intelligente (Ctrl+J répété) : nouvelle copie de `copy`, à qui l'on fait subir la
 * transformation `t` qui a mené de `src` à `copy`. Les textes prennent aussi le même changement
 * de taille de police.
 */
export function repeatTransform(src: SceneNode, copy: SceneNode, t: Affine): SceneNode {
  const next = cloneWithNewIds(copy);
  const visit = (s: SceneNode | undefined, c: SceneNode | undefined, n: SceneNode) => {
    if (n.type === 'group') {
      n.children.forEach((k, i) =>
        visit(
          s?.type === 'group' ? s.children[i] : undefined,
          c?.type === 'group' ? c.children[i] : undefined,
          k,
        ),
      );
      return;
    }
    applyAffine(n, t);
    if (n.type === 'text' && s?.type === 'text' && c?.type === 'text' && s.style.fontSize > 0) {
      const k = c.style.fontSize / s.style.fontSize;
      if (Math.abs(k - 1) > 1e-6) scaleTextSize(n, k);
    }
  };
  visit(src, copy, next);
  return next;
}

/** La transformation n'est-elle qu'un déplacement ? */
function isTranslation(t: Affine): boolean {
  const eps = 1e-6;
  return Math.abs(t.a - 1) < eps && Math.abs(t.b) < eps && Math.abs(t.c) < eps && Math.abs(t.d - 1) < eps;
}

/**
 * Duplique `copies` en répétant la transformation qui mène de `sources` à `copies` (listes
 * parallèles d'objets du premier niveau). Chaque nouvelle copie est placée juste au-dessus de
 * son modèle. Renvoie les ids des nouvelles copies, ou null si la répétition n'a pas de sens.
 *
 * `base` : la première copie telle qu'elle était à sa création, quand elle a été décalée (Ctrl+J).
 * Si l'on a ensuite tourné ou mis à l'échelle la copie, seul ce geste se répète, sans le décalage
 * de départ : Affinity duplique sur place, et les copies tournent ainsi autour du point d'origine.
 * Un simple déplacement garde l'écart entre l'original et la copie.
 */
export function powerDuplicate(
  doc: PoulpeDocument,
  sources: string[],
  copies: string[],
  base?: SceneNode,
): string[] | null {
  if (!copies.length || sources.length !== copies.length) return null;
  const src = sources.map((id) => findNode(doc, id)?.node);
  const first = findNode(doc, copies[0])?.node;
  if (src.some((n) => !n) || !first || copies.some((id) => !findNode(doc, id))) return null;
  let t = transformBetween(src[0]!, first);
  const done = base && transformBetween(base, first);
  if (done && !isTranslation(done)) t = done;
  if (!t) return null;
  const created: string[] = [];
  copies.forEach((id, i) => {
    const loc = findNode(doc, id)!;
    const next = repeatTransform(src[i]!, loc.node, t);
    next.name = loc.node.name;
    loc.parent.children.splice(loc.parent.children.indexOf(loc.node) + 1, 0, next);
    created.push(next.id);
  });
  return created;
}

// ————— Redimensionnement d'une boîte par ses poignées —————

/**
 * Boîte alignée sur les axes après avoir tiré la poignée (hx, hy) — 0, 0.5 ou 1 sur chaque axe —
 * jusqu'au point `p`. `keepRatio` garde les proportions, `fromCenter` part du centre.
 */
export function dragBoxHandle(
  b: Box,
  hx: number,
  hy: number,
  p: Vec,
  keepRatio: boolean,
  fromCenter: boolean,
  min = 1,
): Box {
  const c = boxCenter(b);
  // Point fixe sur chaque axe : le bord opposé à la poignée, ou le centre.
  const ax = fromCenter || hx === 0.5 ? c.x : hx === 0 ? b.x + b.width : b.x;
  const ay = fromCenter || hy === 0.5 ? c.y : hy === 0 ? b.y + b.height : b.y;
  const k = fromCenter ? 2 : 1;
  let w = hx === 0.5 ? b.width : Math.abs(p.x - ax) * k;
  let h = hy === 0.5 ? b.height : Math.abs(p.y - ay) * k;
  if (keepRatio && b.width > 0 && b.height > 0) {
    const s =
      hx !== 0.5 && hy !== 0.5
        ? Math.max(w / b.width, h / b.height)
        : hx !== 0.5
          ? w / b.width
          : h / b.height;
    w = b.width * s;
    h = b.height * s;
  }
  w = Math.max(min, w);
  h = Math.max(min, h);
  // La boîte part du côté du pointeur : on peut passer de l'autre côté du bord fixe.
  const x = fromCenter || hx === 0.5 ? ax - w / 2 : p.x < ax ? ax - w : ax;
  const y = fromCenter || hy === 0.5 ? ay - h / 2 : p.y < ay ? ay - h : ay;
  return { x, y, width: w, height: h };
}

// ————— Recadrage vectoriel —————

/** Cadre d'un recadrage : une boîte tournée, en coordonnées du monde. */
export interface CropFrame extends Box {
  rotation: number;
}

/**
 * Cadre de recadrage des objets choisis : celui d'un objet déjà recadré, la boîte (tournée) d'un
 * objet seul, sinon la boîte englobante.
 */
export function vectorCropFrame(doc: PoulpeDocument, ids: string[]): CropFrame | null {
  const top = topLevelIds(doc, ids);
  if (!top.length) return null;
  const nodes = top.map((id) => findNode(doc, id)!.node);
  if (nodes.length === 1) {
    const n: SceneNode = nodes[0];
    const box = n.type !== 'group' ? n : isVectorCrop(n) ? n.children[0] : null;
    if (box) return { x: box.x, y: box.y, width: box.width, height: box.height, rotation: box.rotation };
  }
  const b = nodes.map(nodeBounds).reduce((u, k) => {
    const x = Math.min(u.x, k.x),
      y = Math.min(u.y, k.y);
    return {
      x,
      y,
      width: Math.max(u.x + u.width, k.x + k.width) - x,
      height: Math.max(u.y + u.height, k.y + k.height) - y,
    };
  });
  return { ...b, rotation: 0 };
}

/**
 * Met les objets dans un recadrage vectoriel (groupe `groupId` à masque) dont le cadre est
 * `frame`, ou règle le cadre s'ils y sont déjà. Renvoie l'id du groupe.
 */
export function setVectorCrop(
  doc: PoulpeDocument,
  ids: string[],
  frame: CropFrame,
  groupId: string,
  names: { group: string; mask: string },
): string | null {
  const top = topLevelIds(doc, ids);
  const only = top.length === 1 ? findNode(doc, top[0])?.node : null;
  let g: GroupNode;
  if (isVectorCrop(only)) g = only;
  else {
    const group = createGroup([], names.group);
    group.id = groupId;
    group.clip = true;
    group.vectorCrop = true;
    if (!groupNodes(doc, top, group)) return null;
    g = findNode(doc, group.id)!.node as GroupNode;
    const mask = createRect({ x: 0, y: 0, width: 1, height: 1, name: names.mask });
    mask.fill = NONE;
    mask.stroke = { paint: NONE, width: 0 };
    g.children.unshift(mask);
  }
  Object.assign(g.children[0], {
    x: frame.x,
    y: frame.y,
    width: Math.max(1, frame.width),
    height: Math.max(1, frame.height),
    rotation: frame.rotation,
  });
  return g.id;
}

/** Retire un recadrage vectoriel : le contenu reprend sa place, entier. Renvoie ses ids. */
export function removeVectorCrop(doc: PoulpeDocument, id: string): string[] {
  const g = findNode(doc, id)?.node;
  if (!isVectorCrop(g)) return [];
  g.children.shift();
  return ungroupNode(doc, id);
}

// ————— Pipette de style —————

/** Parties d'un style que la Pipette de style applique. */
export interface StyleParts {
  fill: boolean;
  stroke: boolean;
  /** Effets, opacité et mode de fusion. */
  effects: boolean;
  /** Caractère et paragraphe des textes. */
  text: boolean;
}

/** Style d'un objet pris par la Pipette de style. */
export function pickStyle(node: SceneNode): SavedStyle {
  return styleFromNode(node, node.name);
}

/**
 * Applique les parties choisies d'un style pris par la Pipette de style. L'objet prend
 * l'apparence du modèle : un modèle sans effets retire ceux de l'objet.
 */
export function applyPickedStyle(node: SceneNode, style: SavedStyle, parts: StyleParts): boolean {
  const s: SavedStyle = { id: style.id, name: style.name };
  if (parts.fill && style.fill) s.fill = style.fill;
  if (parts.stroke && style.stroke) {
    s.stroke = style.stroke;
    if (style.strokes) s.strokes = style.strokes;
  }
  if (parts.effects) {
    s.opacity = style.opacity;
    s.blendMode = style.blendMode;
    if (style.effects?.length) s.effects = style.effects;
  }
  if (parts.text && style.text) s.text = style.text;
  let changed = applyStyle(node, s);
  if (parts.effects && !style.effects?.length && node.effects) {
    delete node.effects;
    changed = true;
  }
  return changed;
}
