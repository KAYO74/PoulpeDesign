import { contentAwareScale, findNode, newId } from '@poulpe/core';
import { registerBitmap } from '@poulpe/render';
import { t } from '../i18n';
import { editor, toast, ui } from '../store';
import { targetPixels } from './paintTarget';
import { makeCanvas, pruneAssets, selectedImage } from './pixels';
import { getSelection, selectionIn } from './selection';

/*
 * Image › Mise à l'échelle selon le contenu (Photoshop : Content-Aware Scale) : le calque d'image
 * change de taille en gardant intacts les détails (visages, objets) ; le ciel et les fonds unis
 * absorbent le changement. « Quantité » mélange avec une mise à l'échelle ordinaire, et la
 * sélection de pixels, s'il y en a une, est protégée.
 */

/** Au-delà, les coutures sont cherchées sur une version réduite à ce nombre de pixels. */
export const SCALE_MAX_PIXELS = 2_000_000;

export interface ContentScaleSettings {
  /** Nouvelle largeur et hauteur, en pourcentage de la taille actuelle. */
  widthPct: number;
  heightPct: number;
  /** 0 : mise à l'échelle ordinaire, 1 : entièrement selon le contenu. */
  amount: number;
  protect: boolean;
}

let nodeId: string | null = null;

export const canContentScale = (): boolean => {
  const n = selectedImage();
  return !!n && !n.crop;
};

/** Ouvre la fenêtre (il faut un calque d'image sélectionné, sans recadrage). */
export function openContentScale(): void {
  const n = selectedImage();
  if (!n) return;
  nodeId = n.id;
  ui.set({ dialog: 'contentScale' });
}

export const hasSelectionToProtect = (): boolean => getSelection() !== null;

export function closeContentScale(): void {
  nodeId = null;
  ui.set({ dialog: null });
}

/** Calcule et applique ; renvoie false si c'est annulé ou impossible. */
export async function applyContentScale(
  s: ContentScaleSettings,
  onProgress: (part: number) => void,
  cancelled: () => boolean,
): Promise<boolean> {
  const id = nodeId;
  const node = id ? findNode(editor.doc, id)?.node : null;
  if (!node || node.type !== 'image') return false;
  const px = targetPixels(node, 'pixels');
  if (!px) return false;
  // Très grande image : les coutures sont cherchées sur une version k fois plus petite, puis
  // rejouées à pleine résolution (voir contentAwareScale).
  const bw = px.base.width,
    bh = px.base.height;
  const k = Math.max(1, Math.ceil(Math.sqrt((bw * bh) / SCALE_MAX_PIXELS)));
  const work = { w: Math.max(1, Math.floor(bw / k)), h: Math.max(1, Math.floor(bh / k)) };
  const src = makeCanvas(work.w, work.h);
  src.getContext('2d')!.drawImage(px.base, 0, 0, work.w, work.h);
  const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, work.w, work.h);
  const hi =
    k > 1
      ? {
          pixels: {
            data: px.base.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, bw, bh).data,
            width: bw,
            height: bh,
          },
          k,
        }
      : undefined;

  let protect: Uint8Array | undefined;
  if (s.protect) {
    const sel = selectionIn(bw, bh, px.toPx);
    if (sel) {
      const c = makeCanvas(work.w, work.h);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(sel, 0, 0, work.w, work.h);
      const a = g.getImageData(0, 0, work.w, work.h).data;
      protect = new Uint8Array(work.w * work.h);
      for (let i = 0; i < protect.length; i++) protect[i] = a[i * 4 + 3] > 127 ? 1 : 0;
    }
  }

  // Cible (pleine résolution), et étape selon le contenu : « Quantité » en fait une part, le reste
  // est une mise à l'échelle ordinaire.
  const tw = Math.max(8, Math.round((bw * s.widthPct) / 100));
  const th = Math.max(8, Math.round((bh * s.heightPct) / 100));
  const iw = Math.round(work.w + ((work.w * s.widthPct) / 100 - work.w) * s.amount);
  const ih = Math.round(work.h + ((work.h * s.heightPct) / 100 - work.h) * s.amount);
  const out = await contentAwareScale({ data: data.data, width: work.w, height: work.h }, iw, ih, {
    protect,
    hi,
    tick: async (done, total) => {
      onProgress(done / Math.max(1, total));
      await new Promise((r) => setTimeout(r, 0));
      return cancelled();
    },
  });
  if (!out || cancelled()) return false;

  const mid = makeCanvas(out.width, out.height);
  const midCtx = mid.getContext('2d')!;
  const img = midCtx.createImageData(out.width, out.height);
  img.data.set(out.data);
  midCtx.putImageData(img, 0, 0);
  let final = mid;
  if (mid.width !== tw || mid.height !== th) {
    final = makeCanvas(tw, th);
    const g = final.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(mid, 0, 0, tw, th);
  }
  const key = registerBitmap(final);
  const kx = final.width / bw;
  const ky = final.height / bh;
  editor.apply('history.contentScale', (d) => {
    const n = findNode(d, node.id)?.node;
    if (!n || n.type !== 'image') return;
    const assetId = newId('img');
    d.assets[assetId] = {
      id: assetId,
      mime: 'image/png',
      width: final.width,
      height: final.height,
      data: key,
    };
    n.assetId = assetId;
    n.width = Math.max(1, n.width * kx);
    n.height = Math.max(1, n.height * ky);
    pruneAssets(d);
  });
  return true;
}

export function toastScaleFailed(): void {
  toast(t('contentscale.failed'));
}
