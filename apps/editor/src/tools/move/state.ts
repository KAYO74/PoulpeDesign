import type { AutoSelect, SavedStyle, SceneNode, StyleParts } from '@poulpe/core';
import { Store, editor } from '../../store';

/* Réglages et état de l'outil Déplacer, du Recadrage vectoriel et de la Pipette de style. */

export interface MoveState {
  /** Ce qu'un clic sélectionne dans les groupes. */
  autoSelect: AutoSelect;
  /** Point d'origine de la transformation affiché (et utilisé par la rotation et Ctrl). */
  showOrigin: boolean;
  /**
   * Point d'origine déplacé, en fractions du cadre de la sélection `key` (ids de la sélection).
   * Absent ou pour une autre sélection : le centre.
   */
  origin: { key: string; u: number; v: number } | null;
  /** Redimensionner et faire pivoter chaque objet autour de son propre centre. */
  separately: boolean;
  /**
   * Dernière duplication (Ctrl+J ou Alt + glisser) : originaux et copies du premier niveau. Le
   * Ctrl+J suivant répète sur une nouvelle copie la transformation faite entre-temps. `base` : la
   * première copie décalée par Ctrl+J, telle qu'elle était à sa création.
   */
  lastDup: { sources: string[]; copies: string[]; base?: SceneNode } | null;
  /** Style pris par la Pipette de style, et ce qu'elle applique. */
  picked: SavedStyle | null;
  parts: StyleParts;
}

export const moveState = new Store<MoveState>({
  autoSelect: 'layer',
  showOrigin: false,
  origin: null,
  separately: false,
  lastDup: null,
  picked: null,
  parts: { fill: true, stroke: true, effects: true, text: true },
});

const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Clé de la sélection, pour savoir à quelle sélection appartient le point d'origine. */
export function selectionKey(): string {
  return editor.selection.join(',');
}

// La duplication intelligente s'arrête quand on sélectionne autre chose que les copies.
editor.subscribe(() => {
  const dup = moveState.get().lastDup;
  if (dup && !same(editor.selection, dup.copies)) moveState.set({ lastDup: null });
});
