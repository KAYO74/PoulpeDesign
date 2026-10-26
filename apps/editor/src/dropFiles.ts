/*
 * Fichiers glissés dans la fenêtre (appli de bureau et navigateur).
 * Un document (Poulpe Design, PSD, PDF, Illustrator, modèle) s'ouvre. Une image ou un SVG se
 * place dans le document ouvert, là où on le lâche ; sur l'écran d'accueil, il ouvre un document.
 */
import { makeRoomForDocument } from './docTabs';
import { createDocument, createGroup, importSvg, translateNode } from '@poulpe/core';
import { t } from './i18n';
import { OPEN_EXTENSIONS, baseName, loadBytes, openBytes, openPhotoBytes, placeImageBytes } from './io';
import { editor, toast, ui } from './store';
import { placeSvg } from './vectorActions';

const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
const isDocument = (ext: string) => OPEN_EXTENSIONS.includes(ext) || ext === 'poulpemodele';
const isVisual = (ext: string) => ext === 'svg' || ext in IMAGE_MIMES;

/** Vrai si le glissement contient des fichiers (et pas un élément de la bibliothèque, par ex.). */
export const hasFiles = (e: DragEvent | React.DragEvent) => !!e.dataTransfer?.types.includes('Files');

/** `at` : point du document sous la souris, quand on lâche sur la zone de travail. */
export async function dropFiles(files: File[], at?: { x: number; y: number }): Promise<void> {
  const home = ui.get().dialog === 'new';
  const doc = files.find((f) => isDocument(extOf(f.name)));
  const visuals = files.filter((f) => isVisual(extOf(f.name)));
  for (const f of files) {
    const ext = extOf(f.name);
    if (!isDocument(ext) && !isVisual(ext)) toast(t('file.dropUnsupported', { name: f.name }));
  }
  if (doc) {
    makeRoomForDocument();
    const bytes = new Uint8Array(await doc.arrayBuffer());
    // Un modèle s'ouvre comme un nouveau document, sans écraser le fichier du modèle.
    if (extOf(doc.name) === 'poulpemodele') {
      await loadBytes(doc.name, bytes);
      ui.set({ filePath: null });
    } else await openBytes(doc.name, bytes);
    return;
  }
  if (!visuals.length) return;
  let rest = visuals;
  if (home) {
    makeRoomForDocument();
    if (!(await openVisual(visuals[0]))) return;
    rest = visuals.slice(1);
    at = undefined;
  }
  for (const [i, f] of rest.entries()) {
    // Plusieurs fichiers lâchés ensemble : légèrement décalés pour qu'on les voie tous.
    const p = at && { x: at.x + i * 24, y: at.y + i * 24 };
    await placeVisual(f, p);
  }
}

async function placeVisual(f: File, at?: { x: number; y: number }): Promise<void> {
  const ext = extOf(f.name);
  if (ext === 'svg' && placeSvg(await f.text(), baseName(f.name), at)) return;
  await placeImageBytes(new Uint8Array(await f.arrayBuffer()), IMAGE_MIMES[ext] ?? 'image/svg+xml', at);
}

/** Ouvre une image (Persona Photo) ou un SVG (Persona Dessin) dans un nouveau document à sa taille. */
async function openVisual(f: File): Promise<boolean> {
  const ext = extOf(f.name);
  const name = baseName(f.name);
  if (ext !== 'svg') {
    await openPhotoBytes(new Uint8Array(await f.arrayBuffer()), IMAGE_MIMES[ext], name);
    return true;
  }
  const r = importSvg(await f.text());
  if (!r || !r.nodes.length) {
    window.alert(t('file.importError'));
    return false;
  }
  const doc = createDocument({
    name,
    width: Math.round(r.width) || 512,
    height: Math.round(r.height) || 512,
  });
  const ab = doc.artboards[0];
  const group = r.nodes.length === 1 ? r.nodes[0] : createGroup(r.nodes, name);
  translateNode(group, ab.x, ab.y);
  Object.assign(doc.assets, r.assets);
  ab.children.push(group);
  editor.load(doc, { unsaved: true });
  ui.set({ filePath: null, dialog: null, persona: 'draw', tool: 'select' });
  requestAnimationFrame(() => window.dispatchEvent(new Event('poulpe:fit')));
  return true;
}
