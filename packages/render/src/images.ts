import type { PoulpeDocument } from '@poulpe/core';
import { bitmapSource, isBitmapRef, resolveData } from './bitmaps';

/*
 * Images du document pour le dessin : images décodées, toiles affichées pendant une retouche, et
 * révisions du rendu qui suivent ce qui change à l'écran sans que le document change.
 */

/**
 * Image prête à dessiner : décodée depuis le fichier, toile modifiée dans l'appli, ou copie
 * envoyée à un fil de dessin (voir `ParallelPainter`).
 */
export type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

export function drawableSize(img: Drawable): { width: number; height: number } {
  return typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : { width: img.width, height: img.height };
}

/** Source des images du document pour le dessin (`ImageCache` dans la page). */
export interface ImageSource {
  get(doc: PoulpeDocument, assetId: string): Drawable | null;
}

/*
 * Révision du rendu : augmente quand ce qui est dessiné change sans que le document change
 * (une image finit de se décoder, un coup de pinceau en cours). Les calques de réglage s'en
 * servent pour savoir si leur résultat mémorisé est encore bon.
 */
// Interne au paquet : lue telle quelle par `drawChildren` (draw.ts), qui ne peut pas la modifier
// (liaison d'import en lecture seule) ; index.ts ne la réexporte pas.
export let renderRevision = 0;
/** Comme `renderRevision`, sans les retouches en cours, suivies image par image (`assetRevision`). */
let sharedRevision = 0;
const assetRevisions = new Map<string, number>();
export function bumpRenderRevision(): void {
  renderRevision++;
  sharedRevision++;
}

/** Révision de tout ce qui n'est pas une image en cours de retouche. */
export function getSharedRevision(): number {
  return sharedRevision;
}

/** Révision d'une image en cours de retouche (pinceau, aperçu d'un filtre). */
export function getAssetRevision(assetId: string): number {
  return assetRevisions.get(assetId) ?? 0;
}

/** Révision courante du rendu (voir `bumpRenderRevision`). */
export function getRenderRevision(): number {
  return renderRevision;
}

/** Toiles affichées à la place d'une image pendant qu'on la modifie (pinceau, aperçu d'un filtre). */
const liveOverrides = new Map<string, HTMLCanvasElement>();

export function setLiveBitmap(assetId: string, canvas: HTMLCanvasElement | null): void {
  if (canvas) liveOverrides.set(assetId, canvas);
  else liveOverrides.delete(assetId);
  renderRevision++;
  assetRevisions.set(assetId, getAssetRevision(assetId) + 1);
}

/** Cache des images du document, décodées à partir de leurs données. */
export class ImageCache implements ImageSource {
  private images = new Map<string, { data: string; img: HTMLImageElement }>();
  constructor(private onLoad: () => void = () => {}) {}

  private loaded = () => {
    renderRevision++;
    sharedRevision++;
    this.onLoad();
  };

  get(doc: PoulpeDocument, assetId: string): HTMLImageElement | HTMLCanvasElement | null {
    const live = liveOverrides.get(assetId);
    if (live) return live;
    const asset = doc.assets[assetId];
    if (!asset) return null;
    if (isBitmapRef(asset.data)) return bitmapSource(asset.data, this.loaded);
    let entry = this.images.get(assetId);
    if (!entry || entry.data !== asset.data) {
      const img = new Image();
      img.onload = this.loaded;
      img.src = asset.data;
      entry = { data: asset.data, img };
      this.images.set(assetId, entry);
    }
    const img = entry.img;
    return img.complete && img.naturalWidth ? img : null;
  }

  /** Attend que toutes les images du document soient décodées (avant un export). */
  async ready(doc: PoulpeDocument): Promise<void> {
    await Promise.all(
      Object.keys(doc.assets).map(async (id) => {
        const data = doc.assets[id].data;
        if (isBitmapRef(data)) {
          if (!bitmapSource(data)) {
            // Toile libérée : on attend le décodage du PNG.
            await resolveData(data);
            for (let i = 0; i < 100 && !bitmapSource(data); i++) await new Promise((r) => setTimeout(r, 20));
          }
          return;
        }
        this.get(doc, id);
        const img = this.images.get(id)?.img;
        if (img && !img.complete) await img.decode().catch(() => {});
      }),
    );
  }
}
