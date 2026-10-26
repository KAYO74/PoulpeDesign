import { useSyncExternalStore } from 'react';
import { DEFAULT_DEVELOP, RAW_EXTENSIONS, RawPhoto } from '@poulpe/engine';
import rawUrl from '@poulpe/engine/wasm/poulpe_raw.wasm?url';
import { readExif, type Exif } from './exif';
import { Store } from '../store';

/*
 * Bibliothèque photo (comme le module Bibliothèque de Lightroom) : les photos importées, avec
 * leur vignette, leur note, leur drapeau, leur couleur et leurs mots-clés. Les fiches et les
 * fichiers sont gardés dans IndexedDB : la bibliothèque est retrouvée au prochain lancement.
 */

export type Flag = 'pick' | 'reject' | null;
export const LABELS = ['red', 'yellow', 'green', 'blue', 'purple'] as const;
export type Label = (typeof LABELS)[number] | null;

export interface LibraryPhoto {
  id: string;
  name: string;
  /** Dossier d'origine (chemin relatif au dossier importé), ou vide. */
  folder: string;
  size: number;
  /** Date de prise de vue, sinon date du fichier (ms). */
  date: number;
  added: number;
  width: number;
  height: number;
  /** Note de 0 à 5 étoiles. */
  rating: number;
  flag: Flag;
  label: Label;
  keywords: string[];
  exif: Exif;
  /** Vignette JPEG (data URL). */
  thumb: string;
}

export interface LibraryState {
  photos: LibraryPhoto[];
  /** Fiches lues depuis IndexedDB. */
  loaded: boolean;
  /** Import en cours : photos traitées et total. */
  importing: { done: number; total: number } | null;
}

export const library = new Store<LibraryState>({ photos: [], loaded: false, importing: null });

export function useLibrary<T>(pick: (s: LibraryState) => T): T {
  return useSyncExternalStore(library.subscribe, () => pick(library.get()));
}

const IMAGE_MIMES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export const isRaw = (name: string) => RAW_EXTENSIONS.includes(extOf(name));
export const mimeOf = (name: string) => IMAGE_MIMES[extOf(name)] ?? 'image/png';
export const isPhotoFile = (name: string) => isRaw(name) || extOf(name) in IMAGE_MIMES;
/** Extensions acceptées par la fenêtre d'import. */
export const PHOTO_ACCEPT = [...Object.keys(IMAGE_MIMES), ...RAW_EXTENSIONS].map((e) => `.${e}`).join(',');

// --- IndexedDB -------------------------------------------------------------------------------

const DB_NAME = 'poulpe-photo-library';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('photos', { keyPath: 'id' });
        req.result.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      // Navigation privée ou stockage bloqué : la bibliothèque reste en mémoire.
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const t = d.transaction(stores, mode);
      const req = run(t);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Fichiers gardés en mémoire quand IndexedDB n'est pas disponible. */
const memoryFiles = new Map<string, Blob>();

/** Lit la bibliothèque enregistrée (une seule fois). */
export async function loadLibrary(): Promise<void> {
  if (library.get().loaded) return;
  const photos =
    (await tx<LibraryPhoto[]>(['photos'], 'readonly', (t) => t.objectStore('photos').getAll())) ?? [];
  library.set((s) => ({
    loaded: true,
    photos: [...s.photos, ...photos.filter((p) => !s.photos.some((q) => q.id === p.id))],
  }));
}

async function savePhotos(photos: LibraryPhoto[]): Promise<void> {
  await tx(['photos'], 'readwrite', (t) => {
    const st = t.objectStore('photos');
    for (const p of photos) st.put(p);
  });
}

/** Fichier d'origine d'une photo. */
export async function photoFile(id: string): Promise<Blob | undefined> {
  return (
    memoryFiles.get(id) ?? (await tx<Blob>(['files'], 'readonly', (t) => t.objectStore('files').get(id)))
  );
}

// --- Import ----------------------------------------------------------------------------------

const THUMB = 320;

async function makeThumb(file: File): Promise<{ thumb: string; width: number; height: number } | null> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  if (isRaw(file.name)) {
    const raw = await RawPhoto.open(fetch(rawUrl), new Uint8Array(await file.arrayBuffer())).catch(
      () => null,
    );
    if (!raw) return null;
    try {
      const img = raw.render(DEFAULT_DEVELOP, THUMB);
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.putImageData(img, 0, 0);
      return { thumb: canvas.toDataURL('image/jpeg', 0.82), width: raw.width, height: raw.height };
    } finally {
      raw.dispose();
    }
  }
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return null;
  const k = Math.min(1, THUMB / Math.max(bmp.width, bmp.height));
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const out = { thumb: canvas.toDataURL('image/jpeg', 0.82), width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}

const newId = () => `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Dossier d'un fichier choisi avec « Importer un dossier » (chemin sans le nom du fichier). */
const folderOf = (f: File) => {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
};

/**
 * Importe des photos. Les fichiers déjà présents (même nom, même taille, même dossier) et ceux
 * qui ne sont pas des photos sont ignorés. Rend le nombre de photos ajoutées et de refusées.
 */
export async function importPhotos(files: File[]): Promise<{ added: LibraryPhoto[]; failed: number }> {
  await loadLibrary();
  const photos = files.filter((f) => isPhotoFile(f.name));
  const known = new Set(library.get().photos.map((p) => `${p.folder}/${p.name}/${p.size}`));
  const todo = photos.filter((f) => !known.has(`${folderOf(f)}/${f.name}/${f.size}`));
  const added: LibraryPhoto[] = [];
  let failed = files.length - photos.length;
  library.set({ importing: { done: 0, total: todo.length } });
  for (const [i, f] of todo.entries()) {
    const thumb = await makeThumb(f);
    if (thumb) {
      const head = new Uint8Array(await f.slice(0, 1 << 20).arrayBuffer());
      const exif = readExif(head);
      const p: LibraryPhoto = {
        id: newId(),
        name: f.name,
        folder: folderOf(f),
        size: f.size,
        date: exif.taken ?? f.lastModified ?? Date.now(),
        added: Date.now(),
        width: thumb.width,
        height: thumb.height,
        rating: 0,
        flag: null,
        label: null,
        keywords: [],
        exif,
        thumb: thumb.thumb,
      };
      const stored = await tx(['photos', 'files'], 'readwrite', (t) => {
        t.objectStore('photos').put(p);
        t.objectStore('files').put(f, p.id);
      });
      if (stored === undefined && !(await db())) memoryFiles.set(p.id, f);
      added.push(p);
      library.set((s) => ({ photos: [...s.photos, p] }));
    } else failed++;
    library.set({ importing: { done: i + 1, total: todo.length } });
  }
  library.set({ importing: null });
  return { added, failed };
}

// --- Modifications ---------------------------------------------------------------------------

/** Change les fiches `ids` (note, drapeau, couleur, mots-clés). */
export function updatePhotos(ids: string[], patch: (p: LibraryPhoto) => Partial<LibraryPhoto>): void {
  const set = new Set(ids);
  const changed: LibraryPhoto[] = [];
  library.set((s) => ({
    photos: s.photos.map((p) => {
      if (!set.has(p.id)) return p;
      const next = { ...p, ...patch(p) };
      changed.push(next);
      return next;
    }),
  }));
  void savePhotos(changed);
}

/** Retire des photos de la bibliothèque (les fichiers d'origine sur le disque ne sont pas touchés). */
export async function removePhotos(ids: string[]): Promise<void> {
  const set = new Set(ids);
  library.set((s) => ({ photos: s.photos.filter((p) => !set.has(p.id)) }));
  ids.forEach((id) => memoryFiles.delete(id));
  await tx(['photos', 'files'], 'readwrite', (t) => {
    for (const id of ids) {
      t.objectStore('photos').delete(id);
      t.objectStore('files').delete(id);
    }
  });
}

/** Mot-clé nettoyé (espaces en trop retirés) ; vide s'il n'y a rien. */
export const cleanKeyword = (k: string) => k.trim().replace(/\s+/g, ' ');

// --- Filtres ---------------------------------------------------------------------------------

export type SortKey = 'date' | 'name' | 'rating' | 'added';

export interface LibraryFilter {
  /** Dossier choisi dans la barre de gauche (null : toutes les photos). */
  folder: string | null;
  /** Mot-clé choisi dans la barre de gauche. */
  keyword: string | null;
  /** Recherche libre : nom, mot-clé, appareil, objectif. */
  text: string;
  minRating: number;
  flag: 'all' | 'pick' | 'none' | 'reject';
  label: Label | 'all';
  sort: SortKey;
}

export const DEFAULT_FILTER: LibraryFilter = {
  folder: null,
  keyword: null,
  text: '',
  minRating: 0,
  flag: 'all',
  label: 'all',
  sort: 'date',
};

export function filterPhotos(photos: LibraryPhoto[], f: LibraryFilter): LibraryPhoto[] {
  const q = f.text.trim().toLowerCase();
  const list = photos.filter((p) => {
    if (f.folder !== null && p.folder !== f.folder) return false;
    if (f.keyword !== null && !p.keywords.includes(f.keyword)) return false;
    if (p.rating < f.minRating) return false;
    if (f.flag === 'pick' && p.flag !== 'pick') return false;
    if (f.flag === 'reject' && p.flag !== 'reject') return false;
    if (f.flag === 'none' && p.flag !== null) return false;
    if (f.label !== 'all' && p.label !== f.label) return false;
    if (q) {
      const hay = [p.name, p.folder, ...p.keywords, p.exif.make, p.exif.model, p.exif.lens]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by: Record<SortKey, (a: LibraryPhoto, b: LibraryPhoto) => number> = {
    date: (a, b) => a.date - b.date || a.name.localeCompare(b.name),
    added: (a, b) => b.added - a.added,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    rating: (a, b) => b.rating - a.rating || a.date - b.date,
  };
  return list.sort(by[f.sort]);
}

/** Dossiers et mots-clés de la bibliothèque, avec leur nombre de photos. */
export function groups(photos: LibraryPhoto[]): {
  folders: [string, number][];
  keywords: [string, number][];
} {
  const folders = new Map<string, number>();
  const keywords = new Map<string, number>();
  for (const p of photos) {
    folders.set(p.folder, (folders.get(p.folder) ?? 0) + 1);
    for (const k of p.keywords) keywords.set(k, (keywords.get(k) ?? 0) + 1);
  }
  const sort = (m: Map<string, number>) => [...m].sort((a, b) => a[0].localeCompare(b[0]));
  return { folders: sort(folders), keywords: sort(keywords) };
}
