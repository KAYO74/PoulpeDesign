import {
  chainHead,
  clearRunKeys,
  findNode,
  findNodes,
  findStyle,
  scaleTextSize,
  styleAt,
  type TextNode,
  type TextStyle,
} from '@poulpe/core';
import { setTextStyle } from '../../actions';
import {
  applyEditingStyle,
  editedTextId,
  editingStyle,
  isEditingText,
  setTextSelection,
  textSelection,
} from '../../canvas/textEdit';
import { editor, ui } from '../../store';

/*
 * Mise en forme du texte depuis la barre contextuelle et les raccourcis (Ctrl+B, Ctrl+I…), comme
 * dans Affinity : pendant l'édition, sur la sélection dans le texte ; sinon sur les textes
 * sélectionnés ; sans texte, sur les réglages des prochains textes.
 */

/** Premiers cadres (ceux qui portent le texte) des textes sélectionnés, sans doublon. */
export function selectedTexts(): TextNode[] {
  const doc = editor.doc;
  const out = new Map<string, TextNode>();
  // Un seul parcours du document pour toute la sélection (la barre le demande à chaque changement).
  for (const n of findNodes(doc, editor.selection)) {
    if (n.type !== 'text') continue;
    const head = chainHead(doc, n.id) ?? n;
    out.set(head.id, head);
  }
  return [...out.values()];
}

/** Texte que montre la barre : celui en édition, sinon le premier sélectionné. */
export function targetText(): TextNode | null {
  const id = editedTextId();
  const n = id ? findNode(editor.doc, id)?.node : null;
  if (n?.type === 'text') return n;
  return selectedTexts()[0] ?? null;
}

/** Réglages affichés : ceux du début de la sélection pendant l'édition, sinon ceux du texte. */
export function currentTextStyle(): TextStyle {
  return editingStyle() ?? targetText()?.style ?? ui.get().defaults.text;
}

/** Les raccourcis de mise en forme ont-ils quelque chose à faire ? */
export function canFormatText(): boolean {
  const tool = ui.get().tool;
  return isEditingText() || selectedTexts().length > 0 || tool === 'text' || tool === 'frameText';
}

export const isBold = (st: Pick<TextStyle, 'fontWeight'>) => st.fontWeight >= 700;

export function toggleBold(): void {
  setTextStyle({ fontWeight: isBold(currentTextStyle()) ? 400 : 700 });
}

export function toggleItalic(): void {
  setTextStyle({ italic: !currentTextStyle().italic });
}

export function toggleUnderline(): void {
  setTextStyle({ underline: !currentTextStyle().underline });
}

export function toggleStrike(): void {
  setTextStyle({ strike: !currentTextStyle().strike });
}

/** Alignement : à gauche, centré, à droite, ou justifié (`last` : la dernière ligne). */
export function setAlign(align: TextStyle['align'], last?: TextStyle['lastLine']): void {
  setTextStyle({ align, lastLine: align === 'justify' && last !== 'left' ? last : undefined });
}

/** Taille suivante ou précédente : pas de 1 px pour les petits corps, plus grand ensuite. */
export function stepSize(size: number, dir: 1 | -1): number {
  const step = size < 12 ? 1 : size < 36 ? 2 : size < 72 ? 4 : 8;
  const next =
    dir > 0 ? Math.floor(size / step + 1e-6) * step + step : Math.ceil(size / step - 1e-6) * step - step;
  return Math.min(2000, Math.max(1, next));
}

/** Agrandit ou réduit la police (Ctrl+Maj+> et <). Les plages de taille gardent leurs proportions. */
export function stepFontSize(dir: 1 | -1): void {
  if (isEditingText()) {
    applyEditingStyle({ fontSize: stepSize(currentTextStyle().fontSize, dir) });
    return;
  }
  const texts = selectedTexts();
  if (!texts.length) {
    const d = ui.get().defaults;
    ui.set({ defaults: { ...d, text: { ...d.text, fontSize: stepSize(d.text.fontSize, dir) } } });
    return;
  }
  editor.apply('history.text', (d) => {
    for (const t of texts) {
      const n = findNode(d, t.id)?.node;
      if (n?.type === 'text') scaleTextSize(n, stepSize(n.style.fontSize, dir) / n.style.fontSize);
    }
  });
}

/** Pas d'interlettrage d'Alt+flèche : un cinquantième de la taille de la police. */
function trackingStep(size: number): number {
  return Math.max(0.1, Math.round(size * 0.2) / 10);
}

/**
 * Alt+Gauche / Alt+Droite : resserre ou espace les lettres. Pendant l'édition, sur la sélection,
 * ou sans sélection sur la paire de lettres autour du curseur (approche de paire).
 */
export function nudgeTracking(dir: 1 | -1): boolean {
  const sel = textSelection();
  if (sel) {
    const st = currentTextStyle();
    if (sel.start !== sel.end) {
      applyEditingStyle({ letterSpacing: round1(st.letterSpacing + dir * trackingStep(st.fontSize)) });
      return true;
    }
    const n = targetText();
    if (!n || sel.start === 0) return true;
    // L'espace après la lettre qui précède le curseur.
    const before = styleAt({ style: n.style, runs: n.runs }, sel.start - 1);
    setTextSelection(sel.start - 1, sel.start);
    applyEditingStyle({ letterSpacing: round1(before.letterSpacing + dir * trackingStep(before.fontSize)) });
    setTextSelection(sel.start);
    return true;
  }
  const texts = selectedTexts();
  if (!texts.length) return false;
  const st = texts[0].style;
  setTextStyle({ letterSpacing: round1(st.letterSpacing + dir * trackingStep(st.fontSize)) });
  return true;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Styles enregistrés qui portent des réglages de texte. */
export function textStyles() {
  return (editor.doc.styles ?? []).filter((s) => s.text && Object.keys(s.text).length);
}

/**
 * Applique la partie texte d'un style enregistré. Pendant l'édition : à la sélection (le style
 * de paragraphe vaut pour tout le texte), ou à tout le texte si rien n'est sélectionné.
 */
export function applySavedTextStyle(styleId: string): void {
  const style = findStyle(editor.doc, styleId);
  if (!style?.text) return;
  const patch: Partial<TextStyle> = structuredClone(style.text);
  const sel = textSelection();
  if (sel) {
    const len = targetText()?.text.length ?? 0;
    if (sel.start === sel.end) setTextSelection(0, len);
    applyEditingStyle(patch);
    if (sel.start === sel.end) setTextSelection(sel.start);
    return;
  }
  const texts = selectedTexts();
  if (!texts.length) {
    const d = ui.get().defaults;
    ui.set({ defaults: { ...d, text: { ...d.text, ...patch } } });
    return;
  }
  editor.apply('history.applyStyle', (d) => {
    for (const t of texts) {
      const n = findNode(d, t.id)?.node;
      if (n?.type !== 'text') continue;
      n.style = { ...n.style, ...patch };
      if (n.runs) n.runs = clearRunKeys(n.runs, Object.keys(patch), n.style, n.text.length);
    }
  });
}
