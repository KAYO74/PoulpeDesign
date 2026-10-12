/*
 * Rendu du document sur un canevas 2D.
 *
 * C'est la première implémentation de l'interface de rendu. Tout le dessin passe par ce module,
 * ce qui permet de lui substituer un rendu CanvasKit (Skia / WebGL) sans toucher au reste.
 */

/*
 * Point d'entrée du paquet. Le rendu est réparti en modules :
 *  - canvas.ts : contexte de dessin, toiles de travail et modes de fusion ;
 *  - images.ts : images du document, toiles en cours de retouche et révisions du rendu ;
 *  - layout.ts : mesure et mise en page du texte, mémorisées ;
 *  - geometry.ts : tracés, contours, repère local et boîte peinte des objets ;
 *  - paints.ts : couleurs, dégradés et motifs ;
 *  - text.ts : dessin des textes ;
 *  - effects.ts : briques des effets et transparence ;
 *  - adjustments.ts : calques de réglage ;
 *  - draw.ts : parcours de la scène (objet, calques frères, plan de travail) ;
 *  - raster.ts : export en PNG ou JPEG ;
 *  - bitmaps.ts : images modifiées dans l'appli ; cache.ts : cache d'images du canevas.
 * Les modules exportent aussi des fonctions internes au paquet : seuls les noms publics sont
 * réexportés ici.
 */

export { compositeOp, type Ctx } from './canvas';
export {
  ImageCache,
  bumpRenderRevision,
  drawableSize,
  getAssetRevision,
  getRenderRevision,
  getSharedRevision,
  setLiveBitmap,
  type Drawable,
  type ImageSource,
} from './images';
export {
  cachedFlow,
  cachedLayout,
  clearLayoutCache,
  getLayoutRevision,
  measureText,
  textLayoutIn,
} from './layout';
export { applyStrokeStyle, nodePath, paintBounds, toPath2D } from './geometry';
export { canvasPaint } from './paints';
export { drawArtboard, drawChildren, drawNode, type RenderOptions } from './draw';
export { rasterizeArtboard, type RasterOptions } from './raster';

export * from './bitmaps';
export * from './cache';
