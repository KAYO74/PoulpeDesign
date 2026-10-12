import { applyVectorFill, artboardAt, type Paint, type Vec } from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { t } from '../../i18n';
import { editor, toast, ui } from '../../store';
import type { SubTool } from './common';
import { pathsState } from './state';

/*
 * Remplissage de zone vectoriel (Affinity Designer) : un clic dans une zone fermée formée par des
 * formes ou des traits crée une nouvelle forme, de la couleur de remplissage courante, qui couvre
 * exactement cette zone.
 */

/** Couleur de remplissage courante (à défaut, celle du contour, sinon un gris sombre). */
function fillPaint(): Paint {
  const d = ui.get().defaults;
  if (d.fill.type !== 'none') return d.fill;
  return d.stroke.paint.type !== 'none' ? d.stroke.paint : { type: 'solid', color: '#1a1a1d' };
}

export class VectorFillTool implements SubTool {
  constructor(private readonly c: CanvasController) {}

  readonly busy = false;

  pointerDown(_e: PointerEvent, p: Vec): boolean {
    const doc = editor.doc;
    const ab = artboardAt(doc, p);
    if (!ab) {
      toast(t('paths.fillNothing'));
      return true;
    }
    const fromSelection = pathsState.get().fillSource === 'selection';
    const ids = fromSelection ? editor.selection : null;
    if (fromSelection && !editor.selection.length) {
      toast(t('paths.fillNeedsSelection'));
      return true;
    }
    editor.setActiveArtboard(ab.id);
    let made: string | null = null;
    editor.apply('history.vectorFill', (d) => {
      made = applyVectorFill(d, ab.id, p, fillPaint(), t('paths.fillName'), ids, 0.05 / this.c.view.zoom);
      if (!made) return;
      // Zones de la sélection : elle reste choisie pour remplir d'autres zones.
      return ids ? [...ids] : [made];
    });
    if (!made) toast(t('paths.fillNothing'));
    return true;
  }

  pointerMove(): boolean {
    return false;
  }

  pointerUp(): boolean {
    return false;
  }

  cancel(): void {}

  draw(): void {}
}
