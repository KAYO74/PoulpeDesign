import type { CanvasController } from '../../canvas/controller';
import { photoHooks } from '../../photo/photoTools';
import { ui } from '../../store';
import type { ToolDelegate, ToolModule } from '../types';
import { registerPixelBrushes } from './brushes';
import {
  BackgroundEraserContext,
  BlemishContext,
  ColorReplaceContext,
  CropContext,
  FloodEraserContext,
  GradientContext,
  PatchContext,
  QuickMaskBadge,
  RedEyeContext,
  SpongeContext,
} from './context';
import { cropDelegate } from './crop';
import { gradientDelegate } from './gradient';
import { patchDelegate } from './patch';
import { drawQuickMask, quickMaskOn, quickMaskRedirect } from './quickMask';
import { retouchDelegate } from './retouch';
import { pixelStore } from './store';

/*
 * Outils de pixels de la version 1.2 (Persona Photo) : recadrage, dégradé, masque rapide, éponge,
 * gomme d'arrière-plan, gomme de zone, remplacement de couleur, correctif, retouche des
 * imperfections et yeux rouges. Les pinceaux passent par ceux de la Persona Photo (voir brushes.ts) ;
 * les autres outils ont leurs propres gestes, réunis ici en un seul délégué.
 */

registerPixelBrushes();
photoHooks.redirect = quickMaskRedirect;
photoHooks.hideAnts = quickMaskOn;

/** Plusieurs délégués consultés dans l'ordre : le premier qui prend l'événement l'arrête. */
function combine(c: CanvasController, list: ToolDelegate[]): ToolDelegate {
  // Les réglages de ces outils (cadre, repères, masque rapide…) changent le dessin du canevas.
  const unsub = pixelStore.subscribe(() => c.requestDraw());
  return {
    get busy() {
      return list.some((d) => d.busy);
    },
    pointerDown: (e, p, s) => list.some((d) => d.pointerDown?.(e, p, s)),
    pointerMove: (e, p, s) => list.some((d) => d.pointerMove?.(e, p, s)),
    pointerUp: (e, p, s) => list.some((d) => d.pointerUp?.(e, p, s)),
    cancel: () => list.forEach((d) => d.cancel?.()),
    key: (e) => {
      // Q maintenu : un seul changement du masque rapide.
      if (e.repeat && e.key.toLowerCase() === 'q' && ui.get().persona === 'photo') return true;
      return list.some((d) => d.key?.(e));
    },
    draw: (ctx, color) => {
      drawQuickMask(ctx);
      list.forEach((d) => d.draw?.(ctx, color));
    },
    cursor: (tool) => {
      for (const d of list) {
        const cur = d.cursor?.(tool);
        if (cur) return cur;
      }
      return null;
    },
    dispose: () => {
      unsub();
      list.forEach((d) => d.dispose?.());
    },
  };
}

const module: ToolModule = {
  delegate: (c) => combine(c, [cropDelegate(c), gradientDelegate(c), retouchDelegate(c), patchDelegate(c)]),
  context: {
    crop: CropContext,
    pixelGradient: GradientContext,
    sponge: SpongeContext,
    backgroundEraser: BackgroundEraserContext,
    floodEraser: FloodEraserContext,
    colorReplace: ColorReplaceContext,
    patch: PatchContext,
    blemish: BlemishContext,
    redEye: RedEyeContext,
  },
  contextExtra: QuickMaskBadge,
};

export default module;
