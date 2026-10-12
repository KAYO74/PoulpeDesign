import { findNode, type ImageNode, type Vec } from '@poulpe/core';
import { setLiveBitmap } from '@poulpe/render';
import { t } from '../../i18n';
import { addMask } from '../../photo/photoActions';
import {
  commitBitmap,
  copyDrawable,
  docToMask,
  docToPixels,
  imageAt,
  images,
  makeCanvas,
  maskSize,
  newPixelLayer,
  selectedImage,
} from '../../photo/pixels';
import { selectionIn } from '../../photo/selection';
import { editor, toast, ui } from '../../store';
import { quickMaskOn, selectionTarget } from './quickMask';

/*
 * Cible des outils de pixels : le calque de pixels choisi (ou celui sous le pointeur), son masque
 * quand on peint le masque, ou la sélection elle-même pendant le masque rapide.
 */

export interface PixelTarget {
  which: 'pixels' | 'mask' | 'selection';
  /** Calque visé ('' pour la sélection). */
  nodeId: string;
  /** Pixels de départ (copie modifiable) et passage du document à ces pixels. */
  base: HTMLCanvasElement;
  toPx: DOMMatrix;
  /** Pixels de la cible par pixel du document. */
  pxScale: number;
  /** Sélection de pixels dans le repère de la cible, null s'il n'y en a pas. */
  sel: HTMLCanvasElement | null;
  /** Aperçu pendant le geste (null : on revient à l'image enregistrée). */
  live(canvas: HTMLCanvasElement | null): void;
  /** Enregistre le résultat, en une étape d'historique. */
  commit(canvas: HTMLCanvasElement, label: string): void;
}

const scaleOf = (m: DOMMatrix) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;

export function pixelTarget(
  p: Vec,
  opts: { create?: boolean; mask?: boolean; quickMask?: boolean } = {},
): PixelTarget | null {
  if (opts.quickMask && quickMaskOn()) {
    const r = selectionTarget();
    if (!r) return null;
    return {
      which: 'selection',
      nodeId: '',
      base: r.base,
      toPx: r.toPx,
      pxScale: scaleOf(r.toPx),
      sel: null,
      live: (c) => r.live(c),
      commit: (c) => r.commit(c),
    };
  }
  const maskId = opts.mask ? ui.get().maskEditId : null;
  if (maskId) {
    let n = findNode(editor.doc, maskId)?.node;
    if (n && n.visible && !n.locked && n.type !== 'group') {
      if (!n.mask) {
        addMask(n.id);
        n = findNode(editor.doc, maskId)?.node;
      }
      if (n?.mask) {
        const img = images().get(editor.doc, n.mask.assetId);
        let base: HTMLCanvasElement;
        if (img) base = copyDrawable(img);
        else {
          const size = maskSize(n);
          base = makeCanvas(size.width, size.height);
          const ctx = base.getContext('2d')!;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, base.width, base.height);
        }
        const toPx = docToMask(n, base.width, base.height);
        const nodeId = n.id,
          assetId = n.mask.assetId;
        return {
          which: 'mask',
          nodeId,
          base,
          toPx,
          pxScale: scaleOf(toPx),
          sel: selectionIn(base.width, base.height, toPx),
          live: (c) => setLiveBitmap(assetId, c),
          commit: (c, label) => {
            commitBitmap(nodeId, 'mask', c, label);
            setLiveBitmap(assetId, null);
          },
        };
      }
    }
  }
  let node: ImageNode | null = selectedImage();
  if (!node) {
    node = imageAt(p);
    if (node) editor.select([node.id]);
  }
  if (!node && opts.create) {
    const id = newPixelLayer(p);
    const n = id ? findNode(editor.doc, id)?.node : null;
    if (n?.type === 'image') node = n;
  }
  if (!node) {
    toast(t('photo.needPixelLayer'));
    return null;
  }
  const img = images().get(editor.doc, node.assetId);
  if (!img) return null;
  const base = copyDrawable(img);
  const toPx = docToPixels(node, base.width, base.height);
  const nodeId = node.id,
    assetId = node.assetId;
  return {
    which: 'pixels',
    nodeId,
    base,
    toPx,
    pxScale: scaleOf(toPx),
    sel: selectionIn(base.width, base.height, toPx),
    live: (c) => setLiveBitmap(assetId, c),
    commit: (c, label) => {
      commitBitmap(nodeId, 'pixels', c, label);
      setLiveBitmap(assetId, null);
    },
  };
}

/** Point du document dans les pixels de la cible. */
export function toTarget(tg: PixelTarget, p: Vec): Vec {
  const q = tg.toPx.transformPoint(new DOMPoint(p.x, p.y));
  return { x: q.x, y: q.y };
}

/**
 * Mélange `out` (pixels modifiés de la fenêtre x, y, w, h) avec les pixels d'origine selon la
 * sélection de pixels : hors de la sélection, rien ne change.
 */
export function limitToSelection(
  tg: PixelTarget,
  before: Uint8ClampedArray,
  out: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!tg.sel) return;
  const sd = tg.sel.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, w, h).data;
  for (let i = 0; i < out.length; i += 4) {
    const k = sd[i + 3] / 255;
    if (k >= 1) continue;
    for (let c = 0; c < 4; c++) out[i + c] = before[i + c] + (out[i + c] - before[i + c]) * k;
  }
}
