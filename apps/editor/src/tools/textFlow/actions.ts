import {
  artboardAt,
  autoFlowText,
  boxContains,
  createText,
  findArtboard,
  findNode,
  findNodes,
  flattenCommands,
  hitNode,
  isClosedShape,
  nodeBounds,
  shapePath,
  shapeToTextFrame,
  textChain,
  topLevelIds,
  worldToLocal,
  type Box,
  type PoulpeDocument,
  type SceneNode,
  type TextNode,
  type TextWrap,
  type Vec,
} from '@poulpe/core';
import { cachedFlow, measureText } from '@poulpe/render';
import { beginTextEdit, editedTextId } from '../../canvas/textEdit';
import { t } from '../../i18n';
import { editor, toast, ui } from '../../store';

/*
 * Actions de la mise en page du texte : habillage des objets, réglages des cadres de texte (marges
 * intérieures, débordement, habillage ignoré), coulée automatique, cadre lié tracé à la souris et
 * formes changées en cadres de texte. Chacune est un seul pas d'annulation.
 */

// ————— Habillage —————

const targetsCache = new WeakMap<PoulpeDocument, { ids: readonly string[]; nodes: SceneNode[] }>();

/** Objets sélectionnés dont on règle l'habillage (les premiers niveaux de la sélection). */
export function wrapTargets(doc: PoulpeDocument = editor.doc, ids = editor.selection): SceneNode[] {
  // La barre contextuelle le demande à chaque changement : une réponse par document et sélection.
  const hit = targetsCache.get(doc);
  if (hit?.ids === ids) return hit.nodes;
  const nodes = findNodes(doc, topLevelIds(doc, ids)).filter((n) => n.type !== 'adjustment');
  if (Object.isFrozen(doc)) targetsCache.set(doc, { ids, nodes });
  return nodes;
}

/** Change l'habillage des objets sélectionnés ; `type: 'none'` le retire. */
export function setWrap(patch: Partial<Omit<TextWrap, 'type'>> & { type?: TextWrap['type'] | 'none' }): void {
  const ids = wrapTargets().map((n) => n.id);
  if (!ids.length) return;
  editor.apply('history.textWrap', (d) => {
    for (const id of ids) {
      const n = findNode(d, id)?.node;
      if (!n) continue;
      if (patch.type === 'none') {
        delete n.wrap;
        continue;
      }
      const next: TextWrap = { ...(n.wrap ?? { type: 'square', distance: DEFAULT_DISTANCE }) };
      if (patch.type) next.type = patch.type;
      if (patch.side !== undefined) next.side = patch.side;
      if (patch.distance !== undefined) next.distance = Math.max(0, patch.distance);
      if (!next.side || next.side === 'both') delete next.side;
      if (!next.distance) delete next.distance;
      n.wrap = next;
    }
  });
}

/** Distance donnée à un objet qui reçoit un habillage, en pixels. */
export const DEFAULT_DISTANCE = 12;

// ————— Réglages des cadres de texte —————

/** Cadre de texte (hauteur fixe, ou cadre d'une chaîne). */
export function isTextFrame(doc: PoulpeDocument, n: SceneNode | null | undefined): n is TextNode {
  return n?.type === 'text' && !n.path && (!!n.frame || textChain(doc, n.id).length > 1);
}

/** Cadres de texte sélectionnés (hors édition du texte, qui est un geste en cours). */
export function targetFrames(doc: PoulpeDocument = editor.doc): TextNode[] {
  if (editedTextId()) return [];
  return findNodes(doc, editor.selection).filter((n): n is TextNode => isTextFrame(doc, n));
}

export interface FrameSettings {
  insets?: [number, number, number, number] | null;
  ignoreWrap?: boolean;
  hideOverflow?: boolean;
}

export function setFrameSettings(patch: FrameSettings): void {
  const ids = targetFrames().map((n) => n.id);
  if (!ids.length) return;
  editor.apply('history.textFrame', (d) => {
    for (const id of ids) {
      const n = findNode(d, id)?.node;
      if (n?.type !== 'text') continue;
      if (patch.insets !== undefined) {
        const i = patch.insets?.map((v) => Math.max(0, v)) as [number, number, number, number] | undefined;
        if (i && i.some((v) => v > 0)) n.insets = i;
        else delete n.insets;
      }
      for (const k of ['ignoreWrap', 'hideOverflow'] as const) {
        if (patch[k] === undefined) continue;
        if (patch[k]) n[k] = true;
        else delete n[k];
      }
    }
  });
}

// ————— Coulée du texte —————

/** Le texte de cette chaîne déborde-t-il de son dernier cadre ? */
export function chainOverflows(id: string): boolean {
  return cachedFlow(editor.doc, id, null).overflow;
}

/**
 * Coulée automatique (Maj+clic sur le « + » rouge) : des pages (avec la même page maître) et des
 * cadres de même taille au même endroit, jusqu'à ce que tout le texte tienne.
 */
export function autoFlow(id: string): void {
  if (!chainOverflows(id)) return;
  let made: string[] = [];
  const arrange = ui.get().persona === 'layout' || !!editor.doc.layout;
  editor.apply('history.autoFlow', (d) => {
    made = autoFlowText(d, id, measureText, {
      pageName: (n) => t('pages.pageName', { n }),
      frameName: t('name.textFrame'),
      arrange,
    });
  });
  if (made.length) toast(t('tf.autoFlowDone', { n: made.length }));
  else toast(t('tf.autoFlowNone'));
}

/** Nouveau cadre lié au dernier cadre de la chaîne de `fromId`, tracé à la souris. */
export function linkNewFrame(fromId: string, box: Box): void {
  const doc = editor.doc;
  const chain = textChain(doc, fromId);
  const tail = chain[chain.length - 1];
  if (!tail) return;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const ab =
    artboardAt(doc, center) ??
    artboardAt(doc, box) ??
    findArtboard(doc, editor.getState().activeArtboardId) ??
    doc.artboards[0];
  if (!ab) return;
  const frame = createText(
    {
      x: box.x,
      y: box.y,
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
      name: t('name.textFrame'),
      autoWidth: false,
    },
    ui.get().defaults,
  );
  frame.frame = true;
  frame.fill = tail.fill;
  frame.stroke = tail.stroke;
  editor.apply('history.link', (d) => {
    findArtboard(d, ab.id)!.children.push(frame);
    const tl = findNode(d, tail.id)!.node as TextNode;
    tl.frame = true;
    tl.next = frame.id;
    return [frame.id];
  });
}

// ————— Formes changées en cadres de texte —————

/** Le point est-il dans le contour de la forme (pair-impair, repère du monde) ? */
function insideOutline(n: SceneNode, p: Vec): boolean {
  const l = worldToLocal(n, p);
  if (l.x < 0 || l.y < 0 || l.x > n.width || l.y > n.height) return false;
  let inside = false;
  for (const { points } of flattenCommands(shapePath(n), 1)) {
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j];
      if (a.y > l.y !== b.y > l.y && l.x < ((b.x - a.x) * (l.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Forme fermée sous le point, la plus haute dans les calques ; null si un autre objet (texte,
 * image, cadre d'image, tableau) la couvre.
 */
export function closedShapeAt(doc: PoulpeDocument, p: Vec): { node: SceneNode; artboardId: string } | null {
  const search = (nodes: SceneNode[]): SceneNode | null | undefined => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!n.visible || n.locked) continue;
      if (n.type === 'group' && !n.clip && !n.table && !n.picture) {
        const r = search(n.children);
        if (r !== undefined) return r;
        continue;
      }
      // Rien sous le point : on passe vite (le survol appelle cette recherche à chaque mouvement).
      if (!boxContains(nodeBounds(n), p)) continue;
      if (isClosedShape(n)) {
        if (insideOutline(n, p)) return n;
        continue;
      }
      if (hitNode(n, p)) return null;
    }
    return undefined;
  };
  for (let a = doc.artboards.length - 1; a >= 0; a--) {
    const ab = doc.artboards[a];
    if (p.x < ab.x || p.y < ab.y || p.x > ab.x + ab.width || p.y > ab.y + ab.height) continue;
    const found = search(ab.children);
    if (found !== undefined) return found ? { node: found, artboardId: ab.id } : null;
  }
  return null;
}

/**
 * Outil Cadre de texte, clic dans une forme fermée : la forme devient un cadre de texte de sa forme
 * et l'édition commence. Renvoie faux s'il n'y a pas de forme sous le point.
 */
export function frameFromShapeAt(p: Vec): boolean {
  const hit = closedShapeAt(editor.doc, p);
  if (!hit) return false;
  const frame = shapeToTextFrame(hit.node, t('name.textFrame'), ui.get().defaults);
  beginTextEdit(frame.id, true, frame, hit.artboardId, hit.node.id);
  return true;
}

/** Formes fermées sélectionnées (elles peuvent devenir des cadres de texte). */
export function convertibleShapes(): SceneNode[] {
  return wrapTargets().filter((n) => !n.locked && isClosedShape(n));
}

/** « Convertir en cadre de texte » : chaque forme fermée sélectionnée devient un cadre de sa forme. */
export function convertToTextFrame(): void {
  const shapes = convertibleShapes();
  if (!shapes.length) return;
  const name = t('name.textFrame');
  const defaults = ui.get().defaults;
  editor.apply('history.toTextFrame', (d) => {
    const ids: string[] = [];
    for (const s of shapes) {
      const loc = findNode(d, s.id);
      if (!loc) continue;
      const frame = shapeToTextFrame(s, name, defaults);
      loc.parent.children.splice(loc.index, 1, frame);
      ids.push(frame.id);
    }
    return ids;
  });
}

/** Lignes posées dans chaque cadre d'une chaîne (pour les tests et l'automatisation). */
export function flowLayout(id: string): {
  id: string;
  start: number;
  end: number;
  lines: {
    start: number;
    end: number;
    top: number;
    height: number;
    left: number;
    right: number;
    slot?: [number, number];
  }[];
}[] {
  return cachedFlow(editor.doc, id, null).parts.map((p) => ({
    id: p.node.id,
    start: p.start,
    end: p.end,
    lines: p.layout.lines.map((l) => ({
      start: l.start,
      end: l.end,
      top: l.top,
      height: l.height,
      left: l.offset,
      right: l.offset + l.width,
      slot: l.slot,
    })),
  }));
}
