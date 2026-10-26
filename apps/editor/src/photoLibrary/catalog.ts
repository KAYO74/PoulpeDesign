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
  /** Photo laissée dans son dossier du disque (appli de bureau) : chemin du fichier. */
  path?: string;
  /** Photo laissée dans son dossier (navigateur) : le fichier est lu par sa poignée. */
  linked?: boolean;
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
const memoryFiles = new Map<string, Blob | FileSystemFileHandle>();

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

/** Fichier d'origine d'une photo : copie importée, ou fichier relu dans son dossier. */
export async function photoFile(id: string): Promise<Blob | undefined> {
  const p = library.get().photos.find((q) => q.id === id);
  if (p?.path) {
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      return new File([(await readFile(p.path)) as BlobPart], p.name);
    } catch {
      return undefined;
    }
  }
  const stored =
    memoryFiles.get(id) ??
    (await tx<Blob | FileSystemFileHandle>(['files'], 'readonly', (t) => t.objectStore('files').get(id)));
  if (stored && 'getFile' in stored) {
    try {
      const h = stored as FileSystemFileHandle & {
        requestPermission?: (o: { mode: 'read' }) => Promise<PermissionState>;
      };
      if (h.requestPermission && (await h.requestPermission({ mode: 'read' })) !== 'granted')
        return undefined;
      return await h.getFile();
    } catch {
      return undefined;
    }
  }
  return stored as Blob | undefined;
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

/** Photo à ajouter : le fichier se lit à la demande, `store` dit où le retrouver ensuite. */
interface Source {
  name: string;
  folder: string;
  size: number;
  lastModified: number;
  read: () => Promise<File>;
  link?: { path: string } | { handle: FileSystemFileHandle };
}

const sourceOf = (f: File): Source => ({
  name: f.name,
  folder: folderOf(f),
  size: f.size,
  lastModified: f.lastModified,
  read: async () => f,
});

/**
 * Importe des photos. Les fichiers déjà présents (même nom, même taille, même dossier) et ceux
 * qui ne sont pas des photos sont ignorés. Rend le nombre de photos ajoutées et de refusées.
 */
export async function importPhotos(files: File[]): Promise<{ added: LibraryPhoto[]; failed: number }> {
  return addSources(files.map(sourceOf), files.length);
}

async function addSources(
  all: Source[],
  total = all.length,
): Promise<{ added: LibraryPhoto[]; failed: number }> {
  await loadLibrary();
  const photos = all.filter((f) => isPhotoFile(f.name));
  const known = new Set(library.get().photos.map((p) => `${p.folder}/${p.name}/${p.size}`));
  const todo = photos.filter((f) => !known.has(`${f.folder}/${f.name}/${f.size}`));
  const added: LibraryPhoto[] = [];
  let failed = total - photos.length;
  library.set({ importing: { done: 0, total: todo.length } });
  for (const [i, src] of todo.entries()) {
    const f = await src.read().catch(() => null);
    const thumb = f && (await makeThumb(f).catch(() => null));
    if (f && thumb) {
      const head = new Uint8Array(await f.slice(0, 1 << 20).arrayBuffer());
      const exif = readExif(head);
      const p: LibraryPhoto = {
        id: newId(),
        name: src.name,
        folder: src.folder,
        size: src.size,
        date: exif.taken ?? src.lastModified ?? Date.now(),
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
      if (src.link && 'path' in src.link) p.path = src.link.path;
      else if (src.link) p.linked = true;
      const stored = await tx(['photos', 'files'], 'readwrite', (t) => {
        t.objectStore('photos').put(p);
        // Photo liée : seule la fiche est gardée (chemin) ou la poignée du fichier, pas une copie.
        if (!src.link) t.objectStore('files').put(f, p.id);
        else if ('handle' in src.link) t.objectStore('files').put(src.link.handle, p.id);
      });
      if (src.link && 'handle' in src.link) memoryFiles.set(p.id, src.link.handle);
      else if (stored === undefined && !(await db()) && !src.link) memoryFiles.set(p.id, f);
      added.push(p);
      library.set((s) => ({ photos: [...s.photos, p] }));
    } else failed++;
    library.set({ importing: { done: i + 1, total: todo.length } });
  }
  library.set({ importing: null });
  return { added, failed };
}

type DirHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterable<FileSystemHandle & { kind: 'file' | 'directory' }>;
};

/** Le navigateur sait-il ouvrir un dossier du disque sans le copier ? */
export const canLinkFolder = (): boolean =>
  isTauri() ||
  typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Ouvre un dossier du disque, sous-dossiers compris, sans copier les photos : la bibliothèque
 * retient où elles sont (chemin sur le bureau, poignée de fichier dans le navigateur) et les
 * relit quand on les ouvre. Rien n'est à importer pour travailler directement dans ses dossiers.
 */
export async function linkFolder(): Promise<{ added: LibraryPhoto[]; failed: number } | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readDir, readFile, stat } = await import('@tauri-apps/plugin-fs');
    const root = await open({ directory: true, multiple: false, recursive: true });
    if (!root || Array.isArray(root)) return null;
    const rootName = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
    const sources: Source[] = [];
    const walk = async (dir: string, rel: string) => {
      for (const e of await readDir(dir)) {
        const path = `${dir.replace(/[\\/]$/, '')}/${e.name}`;
        if (e.isDirectory) await walk(path, `${rel}/${e.name}`);
        else if (e.isFile && isPhotoFile(e.name)) {
          const info = await stat(path).catch(() => null);
          sources.push({
            name: e.name,
            folder: rel,
            size: info?.size ?? 0,
            lastModified: info?.mtime ? new Date(info.mtime).getTime() : Date.now(),
            read: async () => new File([(await readFile(path)) as BlobPart], e.name),
            link: { path },
          });
        }
      }
    };
    await walk(root, rootName);
    return addSources(sources);
  }
  const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<DirHandle> })
    .showDirectoryPicker;
  if (!picker) return null;
  const root = await picker.call(window, { mode: 'read' }).catch(() => null);
  if (!root) return null;
  const sources: Source[] = [];
  const walk = async (dir: DirHandle, rel: string) => {
    for await (const e of dir.values()) {
      if (e.kind === 'directory') await walk(e as DirHandle, `${rel}/${e.name}`);
      else if (isPhotoFile(e.name)) {
        const handle = e as FileSystemFileHandle;
        const f = await handle.getFile();
        sources.push({
          name: e.name,
          folder: rel,
          size: f.size,
          lastModified: f.lastModified,
          read: async () => handle.getFile(),
          link: { handle },
        });
      }
    }
  };
  await walk(root, root.name);
  return addSources(sources);
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
