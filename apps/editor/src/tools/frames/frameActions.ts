import {
  NONE,
  artboardAt,
  bytesToDataUrl,
  createEllipse,
  createGroup,
  createImage,
  createRect,
  findArtboard,
  findNode,
  frameImage,
  isPictureFrame,
  newId,
  putImageInFrame,
  replaceImageIn,
  setFrameFitIn,
  setFrameZoomIn,
  sizeFrameToContentIn,
  framePlacement,
  naturalSize,
  placeFrameImage,
  type Box,
  type FrameFit,
  type GroupNode,
  type ImageNode,
  type PoulpeDocument,
  type Vec,
} from '@poulpe/core';
import { t } from '../../i18n';
import { pickFile } from '../../io';
import { frameTarget } from '../../libraryActions';
import { editor, setTool, ui } from '../../store';
import { framesState, type PendingImage } from './state';

/*
 * Cadres d'image et images (Persona Mise en page, comme dans Affinity Publisher) : dessiner un
 * cadre vide, y placer une image, choisir son ajustement, la remplacer, poser une image à sa taille
 * réelle ou à la taille d'un glisser. Chaque action s'annule d'un seul coup.
 */

/** Choisit un fichier image et le décode. */
export async function pickImage(): Promise<PendingImage | null> {
  const file = await pickFile(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'], 'image/*');
  if (!file) return null;
  const ext = file.name.split('.').pop()!.toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
  return decodeImage(file.bytes, mime);
}

export async function decodeImage(bytes: Uint8Array, mime: string): Promise<PendingImage | null> {
  const data = bytesToDataUrl(bytes, mime);
  const img = new Image();
  img.src = data;
  try {
    await img.decode();
  } catch {
    window.alert(t('file.imageError'));
    return null;
  }
  return { data, mime, width: img.naturalWidth || 512, height: img.naturalHeight || 512 };
}

function addAsset(d: PoulpeDocument, p: PendingImage): string {
  const id = newId('img');
  d.assets[id] = { id, mime: p.mime, width: p.width, height: p.height, data: p.data };
  return id;
}

/** Cadre d'image sélectionné, ou dont l'image est sélectionnée, et son image. */
export function selectedFrame(
  doc: PoulpeDocument,
  selection: string[],
): { frame: GroupNode; image: ImageNode | null } | null {
  if (selection.length !== 1) return null;
  const loc = findNode(doc, selection[0]);
  if (!loc) return null;
  if (isPictureFrame(loc.node)) return { frame: loc.node, image: frameImage(loc.node) };
  const parent = loc.parent as GroupNode;
  if (loc.node.type === 'image' && isPictureFrame(parent) && frameImage(parent) === loc.node)
    return { frame: parent, image: loc.node };
  return null;
}

/** Image sélectionnée (seule, ou dans un cadre), et son cadre éventuel. */
export function selectedImage(
  doc: PoulpeDocument,
  selection: string[],
): { image: ImageNode; frame: GroupNode | null } | null {
  const f = selectedFrame(doc, selection);
  if (f) return f.image ? { image: f.image, frame: f.frame } : null;
  if (selection.length !== 1) return null;
  const n = findNode(doc, selection[0])?.node;
  return n?.type === 'image' ? { image: n, frame: null } : null;
}

/** Cadre d'image vide (rectangle ou ellipse), sans fond ni contour, comme dans Affinity Publisher. */
export function makePictureFrame(box: Box, shape: 'rect' | 'ellipse', fit: FrameFit): GroupNode {
  const b = { ...box, name: t(shape === 'rect' ? 'name.rect' : 'name.ellipse') };
  const mask = shape === 'rect' ? createRect(b) : createEllipse(b);
  mask.fill = NONE;
  mask.stroke = { ...mask.stroke, paint: NONE };
  const g = createGroup([mask], t('frames.name'));
  g.clip = true;
  g.picture = { fit };
  Object.assign(g, { x: box.x, y: box.y, width: box.width, height: box.height });
  return g;
}

/** Met une image dans un cadre (vide ou non) ; elle prend l'ajustement du cadre. */
export function placeInFrame(frameId: string, p: PendingImage): void {
  editor.apply('history.image', (d) => {
    const g = findNode(d, frameId)?.node;
    if (g?.type !== 'group') return;
    const assetId = addAsset(d, p);
    const mask = g.children[0];
    const image = createImage({ ...mask, assetId, name: t('name.image') });
    putImageInFrame(g, image, { width: p.width, height: p.height });
    return [g.id];
  });
}

/** Choisit une image et la met dans le cadre donné. */
export async function chooseImageForFrame(frameId: string): Promise<void> {
  const p = await pickImage();
  if (p) placeInFrame(frameId, p);
}

/**
 * Remplace l'image sélectionnée (seule ou dans son cadre) : la nouvelle prend sa place, sa taille
 * et son ajustement. Un cadre vide sélectionné reçoit simplement l'image.
 */
export async function replaceSelectedImage(): Promise<void> {
  const doc = editor.doc;
  const sel = editor.selection;
  const f = selectedFrame(doc, sel);
  if (f && !f.image) return chooseImageForFrame(f.frame.id);
  const target = selectedImage(doc, sel);
  if (!target) return;
  const p = await pickImage();
  if (!p) return;
  const imageId = target.image.id;
  const frameId = target.frame?.id ?? null;
  editor.apply('history.replaceImage', (d) => {
    const img = findNode(d, imageId)?.node;
    if (img?.type !== 'image') return;
    const frame = frameId ? (findNode(d, frameId)?.node as GroupNode) : null;
    replaceImageIn(d, img, frame, addAsset(d, p), { width: p.width, height: p.height });
  });
}

/** Cadres d'image visés par la sélection (un cadre, ou l'image d'un cadre). */
function selectedFrameIds(): string[] {
  const doc = editor.doc;
  const ids = new Set<string>();
  for (const id of editor.selection) {
    const f = selectedFrame(doc, [id]);
    if (f) ids.add(f.frame.id);
  }
  return [...ids];
}

/** Ajustement des cadres sélectionnés (ou des prochains cadres, sans sélection). */
export function setFrameFit(fit: FrameFit): void {
  const ids = selectedFrameIds();
  if (!ids.length) {
    framesState.set({ fit });
    return;
  }
  editor.apply('history.frameFit', (d) => {
    for (const id of ids) {
      const g = findNode(d, id)?.node;
      if (g?.type === 'group') setFrameFitIn(d, g, fit);
    }
  });
}

/** Zoom de l'image dans son cadre (1 = ajustée) ; `live` : aperçu pendant le glisser du curseur. */
export function setFrameZoom(zoom: number, live = false): void {
  const f = selectedFrame(editor.doc, editor.selection);
  if (!f?.image) return;
  const id = f.frame.id;
  const recipe = (d: PoulpeDocument) => {
    const g = findNode(d, id)?.node;
    if (g?.type === 'group') setFrameZoomIn(d, g, Math.max(0.05, zoom));
  };
  if (live) editor.preview(recipe);
  else editor.apply('history.frameZoom', recipe);
}

export function endFrameZoom(): void {
  if (editor.inGesture) editor.commit('history.frameZoom');
}

/** Zoom actuel de l'image du cadre sélectionné, ou null. */
export function frameZoom(doc: PoulpeDocument, selection: string[]): number | null {
  const f = selectedFrame(doc, selection);
  if (!f?.image) return null;
  return framePlacement(f.frame, f.image, naturalSize(doc, f.image)).zoom;
}

/** Recentre l'image dans son cadre, sans changer son zoom. */
export function centerFrameImage(): void {
  const f = selectedFrame(editor.doc, editor.selection);
  if (!f?.image) return;
  const id = f.frame.id;
  editor.apply('history.frameFit', (d) => {
    const g = findNode(d, id)?.node;
    if (g?.type !== 'group') return;
    const img = frameImage(g);
    if (!img) return;
    const natural = naturalSize(d, img);
    placeFrameImage(g, img, natural, { ...framePlacement(g, img, natural), ox: 0, oy: 0 });
  });
}

/** Donne au cadre la taille de son image (« Ajuster le cadre au contenu »). */
export function sizeFrameToContent(): void {
  const ids = selectedFrameIds();
  if (!ids.length) return;
  editor.apply('history.frameFit', (d) => {
    for (const id of ids) {
      const g = findNode(d, id)?.node;
      if (g?.type === 'group') sizeFrameToContentIn(g);
    }
  });
}

// ————— Outil Image —————

/**
 * Outil Image : choisit un fichier, puis un clic le pose à sa taille réelle et un glisser à la
 * taille voulue. Si un cadre d'image est sélectionné, l'image va directement dedans.
 */
export async function startPlaceImage(): Promise<void> {
  const p = await pickImage();
  if (!p) {
    if (ui.get().tool === 'image') setTool('select');
    return;
  }
  const frame = frameTarget(editor.doc);
  if (frame) {
    placeInFrame(frame, p);
    setTool('select');
    return;
  }
  framesState.set({ pending: p });
  setTool('image');
}

export function cancelPlaceImage(): void {
  framesState.set({ pending: null });
  if (ui.get().tool === 'image') setTool('select');
}

/**
 * Pose l'image en attente : dans `box` (glisser), ou à sa taille réelle avec son coin haut gauche
 * au point `at` (clic). Un clic sur un cadre d'image le remplit.
 */
export function placePending(at: Vec, box: Box | null, frameId: string | null): void {
  const p = framesState.get().pending;
  if (!p) return;
  framesState.set({ pending: null });
  if (frameId && !box) {
    placeInFrame(frameId, p);
    setTool('select');
    return;
  }
  const doc = editor.doc;
  const b = box ?? { x: at.x, y: at.y, width: p.width, height: p.height };
  const ab =
    artboardAt(doc, { x: b.x + b.width / 2, y: b.y + b.height / 2 }) ??
    artboardAt(doc, at) ??
    findArtboard(doc, editor.getState().activeArtboardId) ??
    doc.artboards[0];
  if (!ab) return;
  const node = createImage({ ...b, assetId: '', name: t('name.image') });
  editor.apply('history.image', (d) => {
    node.assetId = addAsset(d, p);
    findArtboard(d, ab.id)!.children.push(node);
    return [node.id];
  });
  editor.setActiveArtboard(ab.id);
  setTool('select');
}
