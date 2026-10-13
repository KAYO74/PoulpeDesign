import { findNode, type ImageNode, type SceneNode, type Vec } from '@poulpe/core';
import { t } from '../i18n';
import { editor, toast, ui, type ToolId } from '../store';
import { addMask } from './photoActions';
import {
  copyDrawable,
  docToMask,
  docToPixels,
  imageAt,
  images,
  makeCanvas,
  maskSize,
  newPixelLayer,
  selectedImage,
} from './pixels';
import { CREATES_LAYER } from './toolKinds';

/*
 * Calque visé par les pinceaux et le pot de peinture de la Persona Photo, et ses pixels de départ
 * (ceux du calque, ou ceux de son masque).
 */

/**
 * Calque visé : l'image sélectionnée, ou celle sous le pointeur. Pour le pinceau et le pot de
 * peinture, un calque de pixels vide est créé s'il n'y en a pas.
 */
export function paintTarget(tool: ToolId, p: Vec): { node: SceneNode; which: 'pixels' | 'mask' } | null {
  const maskId = ui.get().maskEditId;
  if (maskId) {
    let n = findNode(editor.doc, maskId)?.node;
    if (n && n.visible && !n.locked && n.type !== 'group') {
      if (!n.mask) {
        addMask(n.id);
        n = findNode(editor.doc, maskId)?.node;
      }
      if (n) return { node: n, which: 'mask' };
    }
    ui.set({ maskEditId: null });
  }
  let node: ImageNode | null = selectedImage();
  if (!node && !CREATES_LAYER.includes(tool)) {
    node = imageAt(p);
    if (node) editor.select([node.id]);
  }
  if (!node && CREATES_LAYER.includes(tool)) {
    const id = newPixelLayer(p);
    const n = id ? findNode(editor.doc, id)?.node : null;
    if (n?.type === 'image') node = n;
  }
  if (!node) {
    toast(t('photo.needPixelLayer'));
    return null;
  }
  return { node, which: 'pixels' };
}

/** Pixels de départ de la cible, son repère et l'image à remplacer pendant le geste. */
export function targetPixels(node: SceneNode, which: 'pixels' | 'mask') {
  const doc = editor.doc;
  if (which === 'pixels' && node.type === 'image') {
    const img = images().get(doc, node.assetId);
    if (!img) return null;
    const base = copyDrawable(img);
    const toPx = docToPixels(node, base.width, base.height);
    return { base, toPx, assetId: node.assetId };
  }
  let base: HTMLCanvasElement;
  if (node.mask) {
    const img = images().get(doc, node.mask.assetId);
    if (!img) return null;
    base = copyDrawable(img);
  } else {
    // Pas encore de masque : on part d'un masque blanc (tout visible).
    const size = maskSize(node);
    base = makeCanvas(size.width, size.height);
    const ctx = base.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, base.width, base.height);
  }
  return {
    base,
    toPx: docToMask(node, base.width, base.height),
    assetId: node.mask?.assetId ?? `pending-mask-${node.id}`,
  };
}

/** Pixels du calque redessinés dans le repère de son masque (couleur prélevée en peignant le masque). */
export function pixelsInMask(
  node: ImageNode,
  w: number,
  h: number,
  toMask: DOMMatrix,
): HTMLCanvasElement | null {
  const img = images().get(editor.doc, node.assetId);
  if (!img) return null;
  const src = copyDrawable(img);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(toMask.multiply(docToPixels(node, src.width, src.height).inverse()));
  ctx.drawImage(src, 0, 0);
  return c;
}
