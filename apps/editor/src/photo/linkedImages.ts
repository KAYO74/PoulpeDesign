import { bytesToDataUrl, findNode, newId, walkDocument, type ImageNode } from '@poulpe/core';
import { placeImage } from '../actions';
import { t } from '../i18n';
import { isDesktop, pickFile } from '../io';
import { editor, toast } from '../store';
import { pruneAssets } from './pixels';

/*
 * Objets dynamiques liés (Photoshop : objets dynamiques liés ; Affinity : documents liés) : une
 * image placée avec un lien vers son fichier. L'image reste incorporée au document (il s'ouvre
 * partout), et elle est relue quand le fichier change sur le disque : au retour dans l'appli, ou
 * avec Calque › Objet dynamique › Mettre à jour les images liées. Seule l'appli de bureau lit
 * les fichiers par leur chemin.
 */

/** Accès aux fichiers : celui de l'appli de bureau, ou un faux pour les tests. */
export interface LinkFs {
  modified(path: string): Promise<number | null>;
  readFile(path: string): Promise<Uint8Array>;
}

let testFs: LinkFs | null = null;
/** Pour les tests de bout en bout : fichiers simulés. */
export function setLinkFs(fs: LinkFs | null): void {
  testFs = fs;
}

async function linkFs(): Promise<LinkFs | null> {
  if (testFs) return testFs;
  if (!isDesktop()) return null;
  const fs = await import('@tauri-apps/plugin-fs');
  return {
    async modified(path) {
      try {
        return (await fs.stat(path)).mtime?.getTime() ?? 0;
      } catch {
        return null;
      }
    },
    readFile: (path) => fs.readFile(path),
  };
}

const MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
const EXTS = Object.keys(MIMES);
const mimeOf = (path: string) => MIMES[path.split('.').pop()!.toLowerCase()] ?? 'image/png';

/** Image décodée : son adresse de données et sa taille. */
async function decode(bytes: Uint8Array, mime: string) {
  const data = bytesToDataUrl(bytes, mime);
  const img = new Image();
  img.src = data;
  await img.decode();
  return { data, width: img.naturalWidth || 512, height: img.naturalHeight || 512 };
}

export function canPlaceLinked(): boolean {
  return isDesktop() || testFs !== null;
}

/** Fichier › Placer une image liée… */
export async function placeLinkedImage(): Promise<void> {
  if (!isDesktop()) return;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, filters: [{ name: EXTS.join(', '), extensions: EXTS }] });
  if (path && !Array.isArray(path)) await placeLinkedPath(path);
}

/** Place l'image du fichier `path`, liée à lui. */
export async function placeLinkedPath(path: string): Promise<void> {
  const fs = await linkFs();
  if (!fs) return;
  const mime = mimeOf(path);
  try {
    const modified = (await fs.modified(path)) ?? undefined;
    const img = await decode(await fs.readFile(path), mime);
    placeImage(img.data, mime, img.width, img.height, undefined, { path, modified });
  } catch {
    window.alert(t('file.imageError'));
  }
}

const linkedImages = (): ImageNode[] => {
  const out: ImageNode[] = [];
  for (const { node } of walkDocument(editor.doc)) if (node.type === 'image' && node.link) out.push(node);
  return out;
};

/**
 * Relit les images liées dont le fichier a changé (toutes avec `force`). Une seule étape
 * d'historique ; renvoie le nombre d'images mises à jour.
 */
export async function updateLinkedImages(force = false): Promise<number> {
  const fs = await linkFs();
  const nodes = linkedImages();
  if (!fs || !nodes.length) return 0;
  const fresh = new Map<
    string,
    { modified: number; mime: string; data: string; width: number; height: number }
  >();
  let missing = 0;
  for (const path of new Set(nodes.map((n) => n.link!.path))) {
    const modified = await fs.modified(path);
    if (modified === null) {
      missing++;
      continue;
    }
    const known = nodes.find((n) => n.link!.path === path)!.link!.modified;
    if (!force && known !== undefined && modified <= known) continue;
    try {
      const mime = mimeOf(path);
      fresh.set(path, { modified, mime, ...(await decode(await fs.readFile(path), mime)) });
    } catch {
      missing++;
    }
  }
  if (missing) toast(t('link.missing', { n: missing }));
  if (!fresh.size) return 0;
  let count = 0;
  editor.apply('history.updateLinks', (d) => {
    const assets = new Map<string, string>();
    for (const { node } of walkDocument(d)) {
      const f = node.type === 'image' && node.link ? fresh.get(node.link.path) : undefined;
      if (!f || node.type !== 'image') continue;
      let id = assets.get(node.link!.path);
      if (!id) {
        id = newId('img');
        assets.set(node.link!.path, id);
        d.assets[id] = { id, mime: f.mime, width: f.width, height: f.height, data: f.data };
      }
      node.assetId = id;
      node.link!.modified = f.modified;
      count++;
    }
    pruneAssets(d);
  });
  return count;
}

const selectedImages = (): ImageNode[] =>
  editor.selection
    .map((id) => findNode(editor.doc, id)?.node)
    .filter((n): n is ImageNode => n?.type === 'image');

export const canReplaceImage = (): boolean => selectedImages().length > 0;
export const canEmbedImage = (): boolean => selectedImages().some((n) => !!n.link);
export const hasLinkedImages = (): boolean => canPlaceLinked() && linkedImages().length > 0;

/** Calque › Objet dynamique › Incorporer : l'image ne suit plus son fichier. */
export function embedImages(): void {
  const ids = new Set(selectedImages().map((n) => n.id));
  editor.apply('history.embedImage', (d) => {
    for (const { node } of walkDocument(d)) if (ids.has(node.id) && node.type === 'image') delete node.link;
  });
}

/**
 * Calque › Objet dynamique › Remplacer l'image… : nouvelle image dans la même boîte (même place,
 * même taille, mêmes filtres et effets). Dans l'appli de bureau, une image liée suit son nouveau fichier.
 */
export async function replaceImage(): Promise<void> {
  const ids = new Set(selectedImages().map((n) => n.id));
  if (!ids.size) return;
  const file = await pickFile(EXTS, 'image/png,image/jpeg,image/webp,image/gif');
  if (!file) return;
  const mime = mimeOf(file.name);
  let img: Awaited<ReturnType<typeof decode>>;
  try {
    img = await decode(file.bytes, mime);
  } catch {
    window.alert(t('file.imageError'));
    return;
  }
  const fs = await linkFs();
  const modified = isDesktop() && fs ? ((await fs.modified(file.name)) ?? undefined) : undefined;
  const id = newId('img');
  editor.apply('history.replaceImage', (d) => {
    d.assets[id] = { id, mime, width: img.width, height: img.height, data: img.data };
    for (const { node } of walkDocument(d)) {
      if (!ids.has(node.id) || node.type !== 'image') continue;
      node.assetId = id;
      delete node.crop;
      if (node.link && isDesktop()) node.link = { path: file.name, modified };
    }
    pruneAssets(d);
  });
}

/** Appli de bureau : vérifie les images liées à chaque retour dans la fenêtre. */
export function watchLinkedImages(): void {
  if (!isDesktop()) return;
  window.addEventListener('focus', () => void updateLinkedImages());
}
