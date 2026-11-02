import { DEFAULT_DEVELOP, RawPhoto } from '@poulpe/engine';
import rawUrl from '@poulpe/engine/wasm/poulpe_raw.wasm?url';
import { t } from '../i18n';
import { safeName, saveBytes } from '../io';
import { pastedDevelopSettings } from '../photo/rawDevelop';
import { toast, ui } from '../store';
import { isRaw, library, photoFile } from './catalog';

/*
 * Export de photos de la photothèque (comme l'export de Lightroom) : taille, qualité, filigrane
 * texte, et pour les RAW les réglages copiés ou ceux par défaut. Le résultat est un fichier ZIP.
 */

export interface PhotoExportOptions {
  format: 'jpeg' | 'png';
  /** Plus grand côté en pixels ; 0 garde la taille d'origine. Une photo n'est jamais agrandie. */
  maxSide: number;
  /** Qualité JPEG, de 0 à 1. */
  quality: number;
  /** Filigrane texte en bas à droite ; vide : aucun. */
  watermark: string;
  /** RAW : appliquer les réglages copiés dans la fenêtre de développement. */
  useCopied: boolean;
}

export const DEFAULT_PHOTO_EXPORT: PhotoExportOptions = {
  format: 'jpeg',
  maxSide: 2048,
  quality: 0.9,
  watermark: '',
  useCopied: false,
};

let pending: string[] = [];

/** Photos à exporter (celles choisies quand on ouvre la fenêtre d'export). */
export const exportIds = (): string[] => pending;

export function openPhotoExport(ids: string[]): void {
  if (!ids.length) return;
  pending = ids;
  ui.set({ dialog: 'photoExport' });
}

/** Taille de sortie : réduite au plus grand côté demandé, jamais agrandie. */
export function fitSize(w: number, h: number, maxSide: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (!maxSide || long <= maxSide) return { w, h };
  const k = maxSide / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Nom de sortie d'une photo : son nom sans extension, rendu unique dans le ZIP. */
export function outputName(name: string, ext: string, used: Set<string>): string {
  const stem = safeName(name.replace(/\.[^.]+$/, ''));
  let out = `${stem}.${ext}`,
    i = 2;
  while (used.has(out.toLowerCase())) out = `${stem} (${i++}).${ext}`;
  used.add(out.toLowerCase());
  return out;
}

function drawWatermark(c: HTMLCanvasElement, text: string): void {
  const ctx = c.getContext('2d')!;
  const size = Math.max(12, Math.round(Math.max(c.width, c.height) * 0.03));
  ctx.font = `600 ${size}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const x = c.width - size,
    y = c.height - size * 0.8;
  ctx.fillStyle = 'rgb(0 0 0 / 0.45)';
  ctx.fillText(text, x + size * 0.06, y + size * 0.06);
  ctx.fillStyle = 'rgb(255 255 255 / 0.8)';
  ctx.fillText(text, x, y);
}

async function render(file: Blob, name: string, o: PhotoExportOptions): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas');
  if (isRaw(name)) {
    const raw = await RawPhoto.open(fetch(rawUrl), new Uint8Array(await file.arrayBuffer())).catch(
      () => null,
    );
    if (!raw) return null;
    try {
      const settings = (o.useCopied && pastedDevelopSettings()) || DEFAULT_DEVELOP;
      const img = raw.render(settings, o.maxSide);
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')!.putImageData(img, 0, 0);
    } finally {
      raw.dispose();
    }
  } else {
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return null;
    const { w, h } = fitSize(bmp.width, bmp.height, o.maxSide);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    if (o.format === 'jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
  }
  if (o.watermark.trim()) drawWatermark(canvas, o.watermark.trim());
  return canvas;
}

const toBytes = (c: HTMLCanvasElement, o: PhotoExportOptions): Promise<Uint8Array | null> =>
  new Promise((resolve) =>
    c.toBlob(
      async (b) => resolve(b ? new Uint8Array(await b.arrayBuffer()) : null),
      o.format === 'png' ? 'image/png' : 'image/jpeg',
      o.quality,
    ),
  );

/** Exporte les photos dans un ZIP. Renvoie le nombre de photos exportées, ou null si annulé. */
export async function exportPhotos(ids: string[], o: PhotoExportOptions): Promise<number | null> {
  const photos = library.get().photos.filter((p) => ids.includes(p.id));
  if (!photos.length) return 0;
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  let done = 0,
    failed = 0;
  for (const p of photos) {
    toast(t('plib.exporting', { done: ++done, total: photos.length }));
    const file = await photoFile(p.id);
    const canvas = file ? await render(file, p.name, o) : null;
    const bytes = canvas ? await toBytes(canvas, o) : null;
    if (!bytes) {
      failed++;
      continue;
    }
    files[outputName(p.name, o.format === 'png' ? 'png' : 'jpg', used)] = bytes;
  }
  const count = Object.keys(files).length;
  if (!count) {
    toast(t('plib.exportFailed', { n: failed }));
    return 0;
  }
  const zip = zipSync(files, { level: 0 });
  if (!(await saveBytes(zip, 'zip', t('plib.exportName')))) return null;
  toast(failed ? t('plib.exportedSome', { n: count, failed }) : t('plib.exported', { n: count }));
  return count;
}
