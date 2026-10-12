import {
  findNode,
  hitNode,
  nodesAt,
  objectBehind,
  worldToLocal,
  type Box,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { editor, ui, type ToolId } from '../../store';
import { moveState, selectionKey } from './state';

/*
 * Points d'appel de l'outil Déplacer dans le contrôleur du canevas : objet choisi par un clic
 * (sélection automatique), Alt + clic (objet de dessous), point d'origine de la transformation,
 * transformation séparée des objets et duplication par Alt + glisser.
 */

type Frame = Box & { rotation: number };

const tolerance = (c: CanvasController) => 4 / c.view.zoom;

/**
 * Objet qu'un clic de l'outil Déplacer sélectionne, d'après la sélection automatique (Calque,
 * Groupe, Objet). Ctrl (ou l'outil Nœud) choisit toujours l'objet lui-même, dans les groupes.
 */
export function clickTarget(
  c: CanvasController,
  p: Vec,
  tool: ToolId,
  e: { ctrlKey: boolean; metaKey: boolean } | null,
): SceneNode | null {
  const deep = tool === 'direct' || !!e?.ctrlKey || !!e?.metaKey;
  const mode = moveState.get().autoSelect;
  if (deep || mode === 'layer') return c.hitTest(p, deep);
  // Les objets déjà sélectionnés passent en premier, comme dans `hitTest`.
  const doc = editor.doc;
  for (const id of editor.selection) {
    const n = findNode(doc, id)?.node;
    if (n && !n.locked && hitNode(n, p, tolerance(c))) return n;
  }
  return nodesAt(doc, p, tolerance(c), mode)[0] ?? null;
}

/** Alt enfoncé au clic : sélection d'avant le clic, pour choisir l'objet de dessous au relâchement. */
let altDown: { before: string[]; p: Vec; deep: boolean } | null = null;

export function noteAltDown(e: PointerEvent, p: Vec): void {
  altDown =
    e.altKey && !e.shiftKey && ui.get().tool === 'select'
      ? { before: editor.selection, p, deep: e.ctrlKey || e.metaKey }
      : null;
}

/** Alt + clic sans glisser (sinon c'est une duplication) : sélectionne l'objet de dessous. */
export function altClick(c: CanvasController): void {
  const a = altDown;
  altDown = null;
  if (!a) return;
  const mode = a.deep ? 'object' : moveState.get().autoSelect;
  const next = objectBehind(nodesAt(editor.doc, a.p, tolerance(c), mode), a.before);
  if (next) editor.select([next.id]);
}

/**
 * Point d'origine de la transformation dans le repère du cadre `f`, quand il est affiché ; null
 * sinon (la rotation et Ctrl partent alors du centre).
 */
export function pivotLocal(f: Frame): Vec | null {
  const s = moveState.get();
  if (!s.showOrigin) return null;
  const o = s.origin;
  if (!o || o.key !== selectionKey()) return { x: f.width / 2, y: f.height / 2 };
  return { x: o.u * f.width, y: o.v * f.height };
}

/** Place le point d'origine au point du monde `p` (dans le cadre `f` de la sélection). */
export function setPivot(f: Frame, p: Vec): void {
  const l = worldToLocal(f, p);
  moveState.set({
    origin: {
      key: selectionKey(),
      u: f.width ? l.x / f.width : 0.5,
      v: f.height ? l.y / f.height : 0.5,
    },
  });
}

/** Après une rotation, le point d'origine reste où il était (le cadre d'une sélection multiple change). */
export function keepPivot(c: CanvasController, p: Vec): void {
  const s = moveState.get();
  if (!s.showOrigin || s.origin?.key !== selectionKey()) return;
  const f = c.selectionFrame();
  if (f) setPivot(f, p);
}

/** Transformer les objets séparément : chacun autour de son propre centre. */
export function separately(count: number): boolean {
  return count > 1 && moveState.get().separately;
}

/** Copies faites par Alt + glisser : le Ctrl+J suivant répète le déplacement. */
export function noteDuplicate(sources: string[], copies: string[]): void {
  moveState.set({ lastDup: { sources, copies } });
}
