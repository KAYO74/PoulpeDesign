import { commandShortcut, matches, runCommand } from '../../commands';
import { nudgeTracking } from './actions';

/* Raccourcis de mise en forme pendant l'édition d'un texte (la zone de saisie garde ses touches). */

const EDIT_COMMANDS = [
  'text.bold',
  'text.italic',
  'text.underline',
  'text.biggerFont',
  'text.smallerFont',
  'text.alignLeft',
  'text.alignCenter',
  'text.alignRight',
  'text.justify',
];

/** Touche pressée dans le texte en édition : vrai si elle a servi (gras, taille, interlettrage…). */
export function textEditKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey) {
    for (const id of EDIT_COMMANDS) {
      const shortcut = commandShortcut(id);
      if (shortcut && matches(e, shortcut)) {
        runCommand(id);
        return true;
      }
    }
    return false;
  }
  // Alt+Gauche / Alt+Droite : interlettrage de la sélection, ou approche de la paire au curseur.
  if (e.altKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
    return nudgeTracking(e.key === 'ArrowLeft' ? -1 : 1);
  return false;
}
