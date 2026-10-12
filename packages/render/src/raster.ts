import type { Artboard, PoulpeDocument } from '@poulpe/core';
import { drawArtboard } from './draw';
import type { ImageCache } from './images';

/* Export : un plan de travail dessiné dans une toile à part, encodée en PNG ou en JPEG. */

export interface RasterOptions {
  scale?: number;
  type?: 'image/png' | 'image/jpeg';
  /** Qualité JPEG, de 0 à 1. */
  quality?: number;
  background?: boolean;
}

/** Rendu d'un plan de travail en image (PNG ou JPEG). */
export async function rasterizeArtboard(
  doc: PoulpeDocument,
  ab: Artboard,
  images: ImageCache,
  opts: RasterOptions = {},
): Promise<Blob> {
  await images.ready(doc);
  const scale = opts.scale ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(ab.width * scale));
  canvas.height = Math.max(1, Math.round(ab.height * scale));
  const ctx = canvas.getContext('2d')!;
  if (opts.type === 'image/jpeg') {
    // Le JPEG n'a pas de transparence : fond blanc sous le plan de travail.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  ctx.translate(-ab.x, -ab.y);
  drawArtboard(ctx, doc, ab, { images, background: opts.background });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('export impossible'))),
      opts.type ?? 'image/png',
      opts.quality ?? 0.92,
    ),
  );
}
