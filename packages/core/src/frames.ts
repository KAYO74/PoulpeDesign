import { boxCenter, rotatePoint } from './geometry';
import type { FrameFit, GroupNode, ImageNode, PictureFrame, PoulpeDocument, SceneNode } from './types';

/*
 * Cadres d'image (Persona Mise en page, comme dans Affinity Publisher).
 *
 * Un cadre d'image est un groupe à masque d'écrêtage marqué `picture` : son premier enfant
 * (rectangle, ellipse…) est le cadre, l'image vient ensuite. Le rendu et les exports le dessinent
 * comme tout groupe écrêté. Le zoom et le décalage de l'image ne sont pas enregistrés à part : ils
 * se lisent dans la position de l'image par rapport au cadre, ce qui reste juste quand on déplace
 * l'image à la main.
 */

export const FRAME_FITS: FrameFit[] = ['fill', 'fit', 'stretch', 'none'];

export function isPictureFrame(n: SceneNode | null | undefined): n is GroupNode & { picture: PictureFrame } {
  return (
    !!n &&
    n.type === 'group' &&
    !!n.picture &&
    n.clip &&
    n.children.length > 0 &&
    n.children[0].type !== 'group'
  );
}

/** Image d'un cadre (le premier enfant image après le cadre), ou null pour un cadre vide. */
export function frameImage(g: GroupNode): ImageNode | null {
  for (let i = 1; i < g.children.length; i++) {
    const c = g.children[i];
    if (c.type === 'image') return c;
  }
  return null;
}

export function frameFit(g: GroupNode): FrameFit {
  return g.picture?.fit ?? 'fill';
}

/** Taille de l'image ajustée (zoom 1) dans un cadre W × H, pour une image de taille propre iw × ih. */
export function fittedSize(
  fit: FrameFit,
  W: number,
  H: number,
  iw: number,
  ih: number,
): { width: number; height: number } {
  if (fit === 'stretch' || iw <= 0 || ih <= 0) return { width: W, height: H };
  if (fit === 'none') return { width: iw, height: ih };
  const k = fit === 'fill' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  return { width: iw * k, height: ih * k };
}

/** Taille propre d'une image (en pixels de la partie gardée), ou sa taille dans le document à défaut. */
export function naturalSize(doc: PoulpeDocument, img: ImageNode): { width: number; height: number } {
  const a = doc.assets[img.assetId];
  if (!a || !(a.width > 0) || !(a.height > 0)) return { width: img.width, height: img.height };
  const c = img.crop;
  return { width: a.width * (c ? c.width : 1), height: a.height * (c ? c.height : 1) };
}

/**
 * Position de l'image dans son cadre : zoom par rapport à l'ajustement (1 = ajustée, `zoomY` à
 * part pour une image étirée) et décalage de son centre, en fractions de la taille du cadre.
 */
export interface FramePlacement {
  zoom: number;
  zoomY?: number;
  ox: number;
  oy: number;
}

export const CENTERED: FramePlacement = { zoom: 1, ox: 0, oy: 0 };

/** Zoom et décalage actuels de l'image, lus dans sa position par rapport au cadre. */
export function framePlacement(
  g: GroupNode,
  img: ImageNode,
  natural: { width: number; height: number },
): FramePlacement {
  const m = g.children[0];
  const base = fittedSize(frameFit(g), m.width, m.height, natural.width, natural.height);
  const mc = boxCenter(m);
  const off = rotatePoint(boxCenter(img), mc, -m.rotation);
  const zoom = base.width ? img.width / base.width : 1;
  const zoomY = base.height ? img.height / base.height : zoom;
  return {
    zoom,
    ...(Math.abs(zoomY - zoom) > 1e-9 ? { zoomY } : {}),
    ox: m.width ? (off.x - mc.x) / m.width : 0,
    oy: m.height ? (off.y - mc.y) / m.height : 0,
  };
}

/** Place l'image dans son cadre : l'ajustement du cadre, puis le zoom et le décalage donnés. */
export function placeFrameImage(
  g: GroupNode,
  img: ImageNode,
  natural: { width: number; height: number },
  p: FramePlacement = CENTERED,
): void {
  const m = g.children[0];
  const base = fittedSize(frameFit(g), m.width, m.height, natural.width, natural.height);
  const w = Math.max(0.01, base.width * p.zoom),
    h = Math.max(0.01, base.height * (p.zoomY ?? p.zoom));
  const mc = boxCenter(m);
  const c = rotatePoint({ x: mc.x + p.ox * m.width, y: mc.y + p.oy * m.height }, mc, m.rotation);
  img.width = w;
  img.height = h;
  img.x = c.x - w / 2;
  img.y = c.y - h / 2;
  img.rotation = m.rotation;
}

/**
 * Avant de redimensionner un cadre (voir `scaleNode`) : position de l'image par rapport au cadre.
 * La taille actuelle de l'image tient lieu de taille propre (les proportions suffisent).
 */
export function captureFrame(
  g: GroupNode,
): { natural: { width: number; height: number }; p: FramePlacement } | null {
  if (!isPictureFrame(g)) return null;
  const img = frameImage(g);
  if (!img) return null;
  const natural = { width: img.width, height: img.height };
  return { natural, p: framePlacement(g, img, natural) };
}

/** Après le redimensionnement : l'ajustement se réapplique au nouveau cadre. */
export function restoreFrame(
  g: GroupNode,
  keep: { natural: { width: number; height: number }; p: FramePlacement },
): void {
  const img = frameImage(g);
  if (img) placeFrameImage(g, img, keep.natural, keep.p);
}

/**
 * Met une image dans un cadre (vide ou non) : elle remplace l'image ou le contenu d'attente, et
 * prend l'ajustement du cadre, centrée. Un groupe écrêté sans réglage devient un cadre d'image.
 */
export function putImageInFrame(g: GroupNode, image: ImageNode, natural: { width: number; height: number }) {
  const mask = g.children[0];
  g.clip = true;
  if (!g.picture) g.picture = { fit: 'fill' };
  g.children = [mask, image];
  placeFrameImage(g, image, natural);
}

/** Choisit l'ajustement d'un cadre et le réapplique (image recentrée, sans zoom). */
export function setFrameFitIn(doc: PoulpeDocument, g: GroupNode, fit: FrameFit): void {
  g.picture = { ...(g.picture ?? {}), fit };
  const img = frameImage(g);
  if (img) placeFrameImage(g, img, naturalSize(doc, img));
}

/** Change le zoom de l'image dans son cadre, autour de son centre. */
export function setFrameZoomIn(doc: PoulpeDocument, g: GroupNode, zoom: number): void {
  const img = frameImage(g);
  if (!img) return;
  const natural = naturalSize(doc, img);
  const p = framePlacement(g, img, natural);
  const k = p.zoomY !== undefined && p.zoom ? p.zoomY / p.zoom : 1;
  placeFrameImage(g, img, natural, { ...p, zoom, ...(p.zoomY !== undefined ? { zoomY: zoom * k } : {}) });
}

/** Donne au cadre la taille et la place de son image (« Ajuster le cadre au contenu »). */
export function sizeFrameToContentIn(g: GroupNode): void {
  const img = frameImage(g);
  if (!img) return;
  const m = g.children[0];
  m.x = img.x;
  m.y = img.y;
  m.width = img.width;
  m.height = img.height;
  m.rotation = img.rotation;
}

/** Nouvelle image à la place d'une autre : même place, même ajustement, même zoom dans le cadre. */
export function replaceImageIn(
  doc: PoulpeDocument,
  img: ImageNode,
  frame: GroupNode | null,
  assetId: string,
  natural: { width: number; height: number },
): void {
  if (frame) {
    const p = framePlacement(frame, img, naturalSize(doc, img));
    img.assetId = assetId;
    delete img.crop;
    placeFrameImage(frame, img, natural, p);
    return;
  }
  // Image seule : la nouvelle tient dans la boîte de l'ancienne, centrée, sans déformation.
  const c = boxCenter(img);
  const fit = fittedSize('fit', img.width, img.height, natural.width, natural.height);
  img.assetId = assetId;
  delete img.crop;
  img.width = fit.width;
  img.height = fit.height;
  img.x = c.x - fit.width / 2;
  img.y = c.y - fit.height / 2;
}
