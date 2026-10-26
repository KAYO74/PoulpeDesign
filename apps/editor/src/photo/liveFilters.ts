import { defaultAdjustment, findNode, newId, type Adjustment, type AdjustmentKind } from '@poulpe/core';
import { editor, ui } from '../store';

/*
 * Filtres en direct des calques : posés sur un calque (forme, texte, image, groupe), ils
 * restent modifiables et ne touchent pas à ses pixels. La fenêtre de réglage travaille dans un
 * geste de l'éditeur : l'aperçu s'affiche dans le document, Appliquer en fait une seule étape
 * d'historique, Annuler revient à l'état d'avant.
 */

/** Calques sélectionnés qui peuvent recevoir un filtre en direct. */
function targets(): string[] {
  const doc = editor.doc;
  return editor.selection.filter((id) => {
    const n = findNode(doc, id)?.node;
    return n && n.type !== 'adjustment';
  });
}

export function canLiveFilter(): boolean {
  return targets().length > 0;
}

/** Ajoute un filtre en direct aux calques sélectionnés et ouvre son réglage. */
export function addLiveFilter(kind: AdjustmentKind): void {
  const nodeIds = targets();
  if (!nodeIds.length) return;
  editor.begin();
  ui.set({ liveFilter: { nodeIds, filterId: newId('flt'), isNew: true } });
  previewLiveFilter(defaultAdjustment(kind));
  ui.set({ dialog: 'liveFilter' });
}

/** Ouvre le réglage d'un filtre en direct existant. */
export function editLiveFilter(nodeId: string, filterId: string): void {
  editor.begin();
  ui.set({ dialog: 'liveFilter', liveFilter: { nodeIds: [nodeId], filterId, isNew: false } });
}

/** Filtre ouvert dans la fenêtre de réglage (sur le premier calque). */
export function openLiveFilter(): Adjustment | null {
  const lf = ui.get().liveFilter;
  if (!lf) return null;
  const n = findNode(editor.doc, lf.nodeIds[0])?.node;
  return n?.filters?.find((f) => f.id === lf.filterId)?.adjustment ?? null;
}

/**
 * Aperçu des nouveaux réglages du filtre ouvert. Chaque aperçu repart de l'état d'avant la
 * fenêtre : un filtre qui vient d'être ajouté y est donc ajouté à nouveau.
 */
export function previewLiveFilter(adjustment: Adjustment): void {
  const lf = ui.get().liveFilter;
  if (!lf) return;
  editor.preview((d) => {
    for (const id of lf.nodeIds) {
      const n = findNode(d, id)?.node;
      if (!n) continue;
      const f = n.filters?.find((x) => x.id === lf.filterId);
      if (f) f.adjustment = adjustment;
      else if (lf.isNew) n.filters = [...(n.filters ?? []), { id: lf.filterId, adjustment, enabled: true }];
    }
  });
}

/** Ferme la fenêtre de réglage : garde (une étape d'historique) ou abandonne les changements. */
export function closeLiveFilter(keep: boolean): void {
  const lf = ui.get().liveFilter;
  ui.set({ dialog: null, liveFilter: null });
  if (!lf) return;
  if (keep) editor.commit(lf.isNew ? 'history.addLiveFilter' : 'history.liveFilter');
  else editor.cancel();
}

/** Active ou désactive un filtre en direct (bouton œil du panneau Calques). */
export function toggleLiveFilter(nodeId: string, filterId: string): void {
  editor.apply('history.liveFilter', (d) => {
    const f = findNode(d, nodeId)?.node.filters?.find((x) => x.id === filterId);
    if (f) f.enabled = !f.enabled;
  });
}

export function removeLiveFilter(nodeId: string, filterId: string): void {
  editor.apply('history.removeLiveFilter', (d) => {
    const n = findNode(d, nodeId)?.node;
    if (!n?.filters) return;
    n.filters = n.filters.filter((f) => f.id !== filterId);
    if (!n.filters.length) delete n.filters;
  });
}
