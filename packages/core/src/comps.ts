import { newId } from './ids';
import type { LayerComp, LayerCompState, PoulpeDocument } from './types';
import { walkDocument } from './tree';

/** État actuel de tous les objets du document. */
export function captureStates(doc: PoulpeDocument): Record<string, LayerCompState> {
  const states: Record<string, LayerCompState> = {};
  for (const { node } of walkDocument(doc))
    states[node.id] = { visible: node.visible, opacity: node.opacity, x: node.x, y: node.y };
  return states;
}

/** Ajoute une variante avec l'état actuel et renvoie son id. */
export function addComp(doc: PoulpeDocument, name: string): string {
  const comp: LayerComp = { id: newId('comp'), name: name.trim() || 'Variante', states: captureStates(doc) };
  (doc.comps ??= []).push(comp);
  return comp.id;
}

/** Remplace l'état enregistré d'une variante par l'état actuel. */
export function updateComp(doc: PoulpeDocument, id: string): void {
  const comp = doc.comps?.find((c) => c.id === id);
  if (comp) comp.states = captureStates(doc);
}

export function removeComp(doc: PoulpeDocument, id: string): void {
  if (doc.comps) doc.comps = doc.comps.filter((c) => c.id !== id);
}

/** Rappelle une variante : les objets qui n'y figurent pas (ajoutés depuis) ne changent pas. */
export function applyComp(doc: PoulpeDocument, id: string): void {
  const comp = doc.comps?.find((c) => c.id === id);
  if (!comp) return;
  for (const { node } of walkDocument(doc)) {
    const s = comp.states[node.id];
    if (!s) continue;
    node.visible = s.visible;
    node.opacity = s.opacity;
    node.x = s.x;
    node.y = s.y;
  }
}
