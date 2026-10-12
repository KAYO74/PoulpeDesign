import { setLiveBitmap } from '@poulpe/render';
import { ui, type Persona, type ToolId } from '../store';
import { toolGroupsFor } from '../toolCatalog';
import { isPhotoTool } from './photoTools';

export { openPhoto } from '../io';

/** Outils communs à toutes les Personas. */
const SHARED: ToolId[] = ['select', 'text', 'eyedropper', 'hand', 'zoom'];

/**
 * Passe d'une Persona à l'autre ; l'outil suit s'il n'existe pas dans la nouvelle. `tools` : la
 * colonne d'un espace de travail personnalisé (sinon celle de la Persona).
 */
export function setPersona(persona: Persona, tools?: ToolId[] | null): void {
  const { tool } = ui.get();
  if (ui.get().persona === persona) return;
  let next = tool;
  if (persona === 'photo' && !SHARED.includes(tool) && !isPhotoTool(tool)) next = 'brush';
  if (persona !== 'photo' && isPhotoTool(tool)) next = 'select';
  // Dessin et Mise en page n'ont pas les mêmes outils (Crayon, Couteau, Tableau, Cadre d'image…).
  if (persona !== 'photo' && !(tools ?? toolGroupsFor(persona).flat()).includes(next)) next = 'select';
  if (next !== tool) window.dispatchEvent(new Event('poulpe:toolchange'));
  ui.set({
    persona,
    tool: next,
    maskEditId: null,
    editingTextId: null,
    cropId: null,
    nodeSelection: [],
    linkFrom: null,
  });
}

export { setLiveBitmap };
