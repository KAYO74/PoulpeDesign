import {
  RUN_KEYS,
  adjustRuns,
  applyRunStyle,
  chainHead,
  findArtboard,
  findNode,
  removeNodes,
  styleAt,
  type CharStyle,
  type RunStyle,
  type TextNode,
  type TextRun,
  type TextStyle,
} from '@poulpe/core';
import { editor, ui } from '../store';

/*
 * Session d'édition d'un texte. Toute la saisie forme un seul geste annulable ;
 * un nouveau texte resté vide est abandonné, un texte existant vidé est supprimé.
 *
 * La saisie passe par une zone de texte invisible posée sur l'objet ; le texte, le curseur et
 * la sélection sont dessinés sur le canevas, ce qui permet des styles différents par caractère.
 */

interface Session {
  id: string;
  isNew: boolean;
  node?: TextNode;
  artboardId?: string;
  text: string;
  style: TextStyle;
  runs: TextRun[];
  /** Style choisi sans sélection : il s'applique au prochain texte tapé. */
  typing: RunStyle | null;
  /** Objet dont le nouveau texte prend la place (texte posé sur le contour d'une forme). */
  replace?: string;
}

let session: Session | null = null;
let input: HTMLTextAreaElement | null = null;
let lastPointerTarget: EventTarget | null = null;

if (typeof document !== 'undefined')
  document.addEventListener('pointerdown', (e) => (lastPointerTarget = e.target), true);

export function beginTextEdit(
  id: string,
  isNew: boolean,
  node?: TextNode,
  artboardId?: string,
  replace?: string,
): void {
  // Dans une chaîne de cadres liés, on édite le texte du premier cadre, qui porte tout le texte.
  if (!isNew) id = chainHead(editor.doc, id)?.id ?? id;
  if (session?.id === id) return;
  if (session) endTextEdit();
  const existing = findNode(editor.doc, id)?.node;
  const src = existing?.type === 'text' ? existing : node;
  if (!src) return;
  session = {
    id,
    isNew,
    node,
    artboardId,
    text: isNew ? '' : src.text,
    style: src.style,
    runs: isNew ? [] : (src.runs ?? []),
    typing: null,
    replace,
  };
  editor.begin();
  if (isNew && node) preview();
  editor.select([id]);
  ui.set({ editingTextId: id });
}

function preview(): void {
  const s = session;
  if (!s) return;
  editor.preview((d) => {
    let n = findNode(d, s.id)?.node;
    const loc = !n && s.replace ? findNode(d, s.replace) : null;
    if (loc) {
      // Texte sur tracé : il remplace la forme, à sa place dans les calques.
      loc.parent.children.splice(loc.index, 1, { ...s.node! });
      n = loc.parent.children[loc.index];
    } else if (!n && s.node && s.artboardId) {
      const ab = findArtboard(d, s.artboardId) ?? d.artboards[0];
      ab.children.push({ ...s.node });
      n = ab.children[ab.children.length - 1];
    }
    if (n?.type === 'text') {
      n.text = s.text;
      n.style = s.style;
      if (s.runs.length) n.runs = s.runs;
      else delete n.runs;
    }
    return [s.id];
  });
}

export function setEditedText(text: string): void {
  const s = session;
  if (!s || text === s.text) return;
  s.runs = adjustRuns(s.runs, s.text, text, s.style, s.typing ?? undefined);
  s.text = text;
  preview();
}

export function currentEditedText(): string {
  return session?.text ?? '';
}

/** La zone de saisie de la session (posée par le Viewport). */
export function registerTextInput(el: HTMLTextAreaElement | null): void {
  input = el;
}

/** Sélection dans le texte édité, ou null hors édition. */
export function textSelection(): { start: number; end: number } | null {
  if (!session || !input) return null;
  const a = input.selectionStart,
    b = input.selectionEnd;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function setTextSelection(start: number, end = start): void {
  if (!input || !session) return;
  const len = session.text.length;
  const a = Math.max(0, Math.min(len, start)),
    b = Math.max(0, Math.min(len, end));
  if (b < a) input.setSelectionRange(b, a, 'backward');
  else input.setSelectionRange(a, b, 'forward');
  session.typing = null;
  input.focus();
  window.dispatchEvent(new Event('poulpe:textselection'));
}

/** Oublie le style de saisie (le curseur a bougé). */
export function resetTypingStyle(): void {
  if (session) session.typing = null;
}

/** Style affiché dans les panneaux pendant l'édition : celui du début de la sélection. */
export function editingStyle(): CharStyle | null {
  const s = session;
  const sel = textSelection();
  if (!s || !sel) return null;
  const node = { style: s.style, runs: s.runs };
  const at = sel.start === sel.end ? Math.max(0, sel.start - 1) : sel.start;
  const st = styleAt(node, at);
  return s.typing && sel.start === sel.end ? { ...st, ...s.typing } : st;
}

/**
 * Applique un style pendant l'édition : à la sélection si elle n'est pas vide, sinon au texte qui
 * sera tapé. Les réglages de paragraphe (alignement, interligne, capitales) valent pour tout le texte.
 * Renvoie faux hors édition.
 */
export function applyEditingStyle(patch: Partial<TextStyle> & { color?: string }): boolean {
  const s = session;
  const sel = textSelection();
  if (!s || !sel) return false;
  const run: RunStyle = {};
  const para: Partial<TextStyle> = {};
  for (const [k, v] of Object.entries(patch)) {
    if ((RUN_KEYS as readonly string[]).includes(k)) (run as Record<string, unknown>)[k] = v;
    else (para as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(para).length) s.style = { ...s.style, ...para };
  if (Object.keys(run).length) {
    const { color, ...font } = run;
    const all = sel.start === 0 && sel.end === s.text.length;
    if (sel.start === sel.end && s.text.length) s.typing = { ...s.typing, ...run };
    else if (all) {
      // Tout le texte (ou un texte vide) : la police change pour le texte entier, la couleur reste une plage.
      s.style = { ...s.style, ...(font as Partial<TextStyle>) };
      s.runs = applyRunStyle({ text: s.text, style: s.style, runs: s.runs }, 0, s.text.length, font);
      if (color) {
        if (s.text.length)
          s.runs = applyRunStyle({ text: s.text, style: s.style, runs: s.runs }, 0, s.text.length, { color });
        else s.typing = { ...s.typing, color };
      }
    } else s.runs = applyRunStyle({ text: s.text, style: s.style, runs: s.runs }, sel.start, sel.end, run);
  }
  preview();
  // Après un clic sur un bouton (gras, alignement…), la saisie reprend tout de suite dans le texte.
  // Après un champ validé par Entrée, c'est différé, pour que la touche n'arrive pas dans le texte.
  const refocus = () => {
    const active = document.activeElement as HTMLElement | null;
    if (session && (!active || active === document.body || active.tagName === 'BUTTON')) input?.focus();
  };
  if ((document.activeElement as HTMLElement | null)?.tagName === 'BUTTON') refocus();
  else setTimeout(refocus, 0);
  window.dispatchEvent(new Event('poulpe:textselection'));
  return true;
}

/** Faut-il garder la session quand la zone de saisie perd le focus (clic dans un panneau) ? */
export function keepEditingOnBlur(related: EventTarget | null): boolean {
  const t = (related ?? lastPointerTarget) as HTMLElement | null;
  // Les réglages (Caractère, Couleur, barre contextuelle) gardent l'édition ; les calques et l'historique non.
  return !!t?.closest?.('.studio, .contextbar') && !t.closest('.layer-tree, .history');
}

export function endTextEdit(): void {
  const s = session;
  if (!s) return;
  session = null;
  ui.set({ editingTextId: null });
  const n = findNode(editor.doc, s.id)?.node;
  // Un cadre de texte vidé reste en place (on le remplira plus tard), comme dans Affinity Publisher.
  const empty = !n || (n.type === 'text' && !n.text.trim() && !n.frame && !n.next);
  if (empty) {
    if (s.isNew) editor.cancel();
    else {
      editor.preview((d) => {
        removeNodes(d, [s.id]);
        return [];
      });
      editor.commit('history.delete');
    }
    return;
  }
  editor.commit(s.isNew ? 'history.add' : 'history.text');
}

/** Insère du texte à la place de la sélection du texte édité. Renvoie faux hors édition. */
export function insertEditedText(str: string): boolean {
  const s = session;
  const sel = textSelection();
  if (!s || !sel || !input) return false;
  const text = s.text.slice(0, sel.start) + str + s.text.slice(sel.end);
  input.value = text;
  setEditedText(text);
  setTextSelection(sel.start + str.length);
  return true;
}

/** Texte (premier cadre de la chaîne) en cours d'édition. */
export function editedTextId(): string | null {
  return session?.id ?? null;
}

export function isEditingText(): boolean {
  return session !== null;
}
