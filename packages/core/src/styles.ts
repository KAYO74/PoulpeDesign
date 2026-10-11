import { newId } from './ids';
import { isStyled } from './tree';
import type { PoulpeDocument, SavedStyle, SceneNode, TextStyle } from './types';

/*
 * Styles enregistrés (styles de calque et de texte d'Affinity) : l'apparence d'un objet mise de
 * côté, puis appliquée d'un clic à d'autres objets. Un style ne retient que ce qui est renseigné ;
 * les réglages absents ne touchent pas à l'objet.
 */

/** Réglages de texte retenus par un style de texte. */
const TEXT_KEYS: (keyof TextStyle)[] = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'italic',
  'lineHeight',
  'letterSpacing',
  'align',
  'underline',
  'strike',
  'uppercase',
  'features',
  'lastLine',
  'list',
];

/** Enregistre l'apparence d'un objet. Un texte garde aussi ses réglages de caractère. */
export function styleFromNode(node: SceneNode, name: string): SavedStyle {
  const style: SavedStyle = { id: newId('style'), name, opacity: node.opacity, blendMode: node.blendMode };
  if (node.effects?.length) style.effects = structuredClone(node.effects);
  if (isStyled(node)) {
    style.fill = structuredClone(node.fill);
    style.stroke = structuredClone(node.stroke);
    if (node.strokes?.length) style.strokes = structuredClone(node.strokes);
  }
  if (node.type === 'text') {
    const text: Partial<TextStyle> = {};
    for (const k of TEXT_KEYS)
      if (node.style[k] !== undefined) (text as Record<string, unknown>)[k] = node.style[k];
    style.text = structuredClone(text);
  }
  return style;
}

/** Applique un style à un objet, sur place. Renvoie vrai si quelque chose a changé. */
export function applyStyle(node: SceneNode, style: SavedStyle): boolean {
  let changed = false;
  if (style.opacity !== undefined) {
    node.opacity = style.opacity;
    changed = true;
  }
  if (style.blendMode !== undefined) {
    node.blendMode = style.blendMode;
    changed = true;
  }
  if (style.effects) {
    node.effects = structuredClone(style.effects);
    changed = true;
  }
  if (isStyled(node)) {
    if (style.fill) {
      node.fill = structuredClone(style.fill);
      changed = true;
    }
    if (style.stroke) {
      node.stroke = structuredClone(style.stroke);
      changed = true;
    }
    // Un style sans contours en plus retire ceux de l'objet : l'apparence doit être la même.
    if (style.stroke || style.strokes) {
      if (style.strokes?.length) node.strokes = structuredClone(style.strokes);
      else delete node.strokes;
      changed = true;
    }
  }
  if (node.type === 'text' && style.text) {
    Object.assign(node.style, structuredClone(style.text));
    // Les plages de caractères garderaient l'ancienne apparence.
    if (node.runs?.length) node.runs = [];
    changed = true;
  }
  return changed;
}

export function findStyle(doc: PoulpeDocument, id: string): SavedStyle | null {
  return doc.styles?.find((s) => s.id === id) ?? null;
}
