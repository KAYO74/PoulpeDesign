import {
  applyPickedStyle,
  findNode,
  isVectorCrop,
  pickStyle,
  powerDuplicate,
  removeVectorCrop,
  topLevelIds,
} from '@poulpe/core';
import { duplicateSelection } from '../../actions';
import { t } from '../../i18n';
import { editor, setTool, toast } from '../../store';
import { moveState } from './state';

/* Actions de l'outil Déplacer, du Recadrage vectoriel et de la Pipette de style. */

/**
 * Dupliquer (Ctrl+J). Juste après une duplication, si l'on a déplacé, tourné ou mis à l'échelle
 * la copie, une nouvelle copie reprend la même transformation (duplication intelligente
 * d'Affinity) ; sinon, copie décalée comme avant.
 */
export function duplicateWithRepeat(): void {
  const ids = editor.selection;
  if (!ids.length) return;
  const dup = moveState.get().lastDup;
  if (dup) {
    const out: { ids: string[] | null } = { ids: null };
    editor.apply('history.duplicate', (d) => {
      out.ids = powerDuplicate(d, dup.sources, dup.copies, dup.base);
      return out.ids ?? undefined;
    });
    if (out.ids) {
      moveState.set({ lastDup: { sources: dup.copies, copies: out.ids } });
      return;
    }
  }
  const sources = topLevelIds(editor.doc, ids);
  duplicateSelection();
  const copies = editor.selection;
  // La copie est décalée : on garde son état de départ, pour ne répéter ensuite que ce qu'on lui fait.
  if (copies.length === sources.length)
    moveState.set({ lastDup: { sources, copies, base: findNode(editor.doc, copies[0])?.node } });
}

/** Recadrage vectoriel sélectionné, s'il y en a un seul. */
export function selectedVectorCrop(): string | null {
  const sel = editor.selection;
  if (sel.length !== 1) return null;
  return isVectorCrop(findNode(editor.doc, sel[0])?.node) ? sel[0] : null;
}

/** Retire le recadrage vectoriel sélectionné : l'objet retrouve sa forme entière. */
export function resetVectorCrop(): void {
  const id = selectedVectorCrop();
  if (id) editor.apply('history.vectorCrop', (d) => removeVectorCrop(d, id));
}

/** Termine le recadrage : retour à l'outil Déplacer, l'objet recadré reste sélectionné. */
export function finishVectorCrop(): void {
  setTool('select');
}

/** Prend le style d'un objet (Pipette de style). */
export function loadStyle(id: string): void {
  const n = findNode(editor.doc, id)?.node;
  if (!n) return;
  moveState.set({ picked: pickStyle(n) });
  toast(t('stylePicker.loaded', { name: n.name }));
}

export function unloadStyle(): void {
  moveState.set({ picked: null });
}

/** Applique le style pris à un objet, selon les parties choisies dans la barre contextuelle. */
export function applyLoadedStyle(id: string): boolean {
  const { picked, parts } = moveState.get();
  const n = findNode(editor.doc, id)?.node;
  if (!picked || !n || n.locked) return false;
  editor.apply('history.style', (d) => void applyPickedStyle(findNode(d, id)!.node, picked, parts));
  return true;
}
