import {
  artboardAt,
  createImage,
  findArtboard,
  findNode,
  hitNode,
  isStyled,
  newId,
  walkDocument,
  type Box,
  type ImageNode,
  type Paint,
  type PoulpeDocument,
  type SceneNode,
  type Stroke,
  type Vec,
} from '@poulpe/core';
import { ImageCache, drawableSize, registerBitmap, type Drawable } from '@poulpe/render';
import { getController } from '../components/Viewport';
import { t } from '../i18n';
import { editor } from '../store';

/*
 * Calques de pixels : un calque de pixels est un objet Image. Ce module fait le lien entre les
 * coordonnées du document et les pixels d'une image ou d'un masque, et enregistre les pixels
 * modifiés dans le document (une étape d'historique par modification).
 */

const fallbackImages = new ImageCache();

export function images(): ImageCache {
  return getController()?.images ?? fallbackImages;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Repère local de l'objet (0..largeur, 0..hauteur) vers le document. */
export function localToDoc(node: Box & { rotation: number }): DOMMatrix {
  return new DOMMatrix()
    .translate(node.x + node.width / 2, node.y + node.height / 2)
    .rotate(node.rotation)
    .translate(-node.width / 2, -node.height / 2);
}

/** Document vers pixels de l'image d'un calque (recadrage compris). */
export function docToPixels(node: ImageNode, pw: number, ph: number): DOMMatrix {
  const c = node.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return new DOMMatrix()
    .translate(c.x * pw, c.y * ph)
    .scale((c.width * pw) / Math.max(1e-6, node.width), (c.height * ph) / Math.max(1e-6, node.height))
    .multiply(localToDoc(node).inverse());
}

/** Document vers pixels du masque d'un objet (le masque couvre la boîte de l'objet). */
export function docToMask(node: SceneNode, mw: number, mh: number): DOMMatrix {
  return new DOMMatrix()
    .scale(mw / Math.max(1e-6, node.width), mh / Math.max(1e-6, node.height))
    .multiply(localToDoc(node).inverse());
}

/** Copie modifiable d'une image du document, ou null si elle n'est pas encore décodée. */
export function copyDrawable(img: Drawable): HTMLCanvasElement {
  const { width, height } = drawableSize(img);
  const c = makeCanvas(width, height);
  c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0);
  return c;
}

export function pixelsOf(node: ImageNode, doc: PoulpeDocument = editor.doc): HTMLCanvasElement | null {
  const img = images().get(doc, node.assetId);
  return img ? copyDrawable(img) : null;
}

/** Résolution d'un nouveau masque : celle de l'image pour un calque de pixels, sinon 1 pixel par pixel du document. */
export function maskSize(
  node: SceneNode,
  doc: PoulpeDocument = editor.doc,
): { width: number; height: number } {
  if (node.type === 'image') {
    const a = doc.assets[node.assetId];
    if (a) {
      const c = node.crop ?? { width: 1, height: 1 };
      return {
        width: Math.max(1, Math.round(a.width * c.width)),
        height: Math.max(1, Math.round(a.height * c.height)),
      };
    }
  }
  const k = Math.min(1, 4096 / Math.max(node.width, node.height, 1));
  return { width: Math.max(1, Math.round(node.width * k)), height: Math.max(1, Math.round(node.height * k)) };
}

export function maskOf(node: SceneNode, doc: PoulpeDocument = editor.doc): HTMLCanvasElement | null {
  if (!node.mask) return null;
  const img = images().get(doc, node.mask.assetId);
  return img ? copyDrawable(img) : null;
}

/**
 * Retire les images que plus rien n'utilise : ni comme pixels, ni comme masque, ni comme motif
 * (remplissage ou contour d'un objet, d'un cadre de texte en forme, fond d'un plan de travail,
 * symbole ou style enregistré, couche alpha).
 */
export function pruneAssets(d: PoulpeDocument): void {
  const used = new Set<string>();
  const paint = (p: Paint | undefined) => {
    if (p?.type === 'pattern') used.add(p.assetId);
  };
  const strokes = (st: Stroke | undefined, more: Stroke[] | undefined) => {
    paint(st?.paint);
    more?.forEach((s) => paint(s.paint));
  };
  const visit = (node: SceneNode) => {
    if (node.type === 'image') used.add(node.assetId);
    if (node.mask) used.add(node.mask.assetId);
    if (isStyled(node)) {
      paint(node.fill);
      strokes(node.stroke, node.strokes);
    }
    if (node.type === 'text' && node.frameShape) {
      paint(node.frameShape.fill);
      strokes(node.frameShape.stroke, undefined);
    }
    if (node.type === 'group') node.children.forEach(visit);
  };
  for (const ab of d.artboards) {
    paint(ab.background);
    ab.children.forEach(visit);
  }
  for (const sym of Object.values(d.symbols ?? {})) sym.children.forEach(visit);
  for (const st of d.styles ?? []) {
    paint(st.fill);
    strokes(st.stroke, st.strokes);
  }
  for (const ch of d.channels ?? []) used.add(ch.assetId);
  for (const id of Object.keys(d.assets)) if (!used.has(id)) delete d.assets[id];
}

/**
 * Enregistre des pixels modifiés : les pixels d'un calque image, ou le masque d'un objet. Une
 * nouvelle image est créée (l'ancienne reste dans l'historique), la toile est encodée en
 * arrière-plan.
 */
export function commitBitmap(
  nodeId: string,
  which: 'pixels' | 'mask',
  canvas: HTMLCanvasElement,
  label: string,
): void {
  const key = registerBitmap(canvas);
  editor.apply(label, (d) => {
    const n = findNode(d, nodeId)?.node;
    if (!n) return;
    const assetId = newId('img');
    d.assets[assetId] = {
      id: assetId,
      mime: 'image/png',
      width: canvas.width,
      height: canvas.height,
      data: key,
    };
    if (which === 'pixels' && n.type === 'image') n.assetId = assetId;
    else n.mask = { assetId, enabled: n.mask?.enabled ?? true };
    pruneAssets(d);
  });
}

/** Le calque image sélectionné (seul objet sélectionné), s'il est modifiable. */
export function selectedImage(): ImageNode | null {
  if (editor.selection.length !== 1) return null;
  const n = findNode(editor.doc, editor.selection[0])?.node;
  return n?.type === 'image' && !n.locked && n.visible ? n : null;
}

/** Le calque image visible le plus haut sous un point du document. */
export function imageAt(p: Vec): ImageNode | null {
  let found: ImageNode | null = null;
  for (const { node } of walkDocument(editor.doc)) {
    if (node.type === 'image' && node.visible && !node.locked && hitNode(node, p)) found = node;
  }
  return found;
}

/**
 * Crée un calque de pixels vide (transparent) qui couvre le plan de travail actif, au-dessus de
 * la sélection. Renvoie son id.
 */
export function newPixelLayer(at?: Vec): string | null {
  const doc = editor.doc;
  const ab =
    (at && artboardAt(doc, at)) || findArtboard(doc, editor.getState().activeArtboardId) || doc.artboards[0];
  if (!ab) return null;
  const k = Math.min(1, 8192 / Math.max(ab.width, ab.height));
  const canvas = makeCanvas(ab.width * k, ab.height * k);
  const key = registerBitmap(canvas);
  const assetId = newId('img');
  const node = createImage({
    x: ab.x,
    y: ab.y,
    width: ab.width,
    height: ab.height,
    assetId,
    name: t('name.pixelLayer'),
  });
  editor.apply('history.newPixelLayer', (d) => {
    d.assets[assetId] = {
      id: assetId,
      mime: 'image/png',
      width: canvas.width,
      height: canvas.height,
      data: key,
    };
    const target = findArtboard(d, ab.id)!;
    // Au-dessus de l'objet sélectionné s'il est sur ce plan de travail.
    const sel = editor.selection.length ? findNode(d, editor.selection[editor.selection.length - 1]) : null;
    if (sel && sel.artboard.id === ab.id) sel.parent.children.splice(sel.index + 1, 0, node);
    else target.children.push(node);
    return [node.id];
  });
  return node.id;
}
