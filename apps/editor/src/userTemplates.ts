import { PoulpeFileError } from '@poulpe/core';
import { materialize } from '@poulpe/render';
import { useEffect, useState } from 'react';
import { decodeFile, encodeFile } from './fileWorker';
import { t } from './i18n';
import { baseName, confirmDiscard, pickFile, saveBytes, thumbnail } from './io';
import { editor, toast, ui } from './store';

/*
 * Modèles personnels : un document enregistré comme modèle est gardé dans IndexedDB (au format
 * .poulpe, images comprises). On peut en créer un nouveau document, l'exporter dans un fichier
 * .poulpemodele (un document .poulpe sous une autre extension) et importer celui de quelqu'un d'autre.
 */

export interface UserTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Le document, encodé comme un fichier .poulpe. */
  bytes: Uint8Array;
  /** Vignette PNG. */
  thumb?: Uint8Array;
  createdAt: number;
}

const DB = 'poulpe-modeles';
const STORE = 'templates';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/* Petit abonnement pour que les listes se mettent à jour après un ajout ou une suppression. */
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

export async function listUserTemplates(): Promise<UserTemplate[]> {
  try {
    const all = (await run('readonly', (s) => s.getAll())) as UserTemplate[];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Liste des modèles personnels, rechargée à chaque changement. */
export function useUserTemplates(): UserTemplate[] | null {
  const [list, setList] = useState<UserTemplate[] | null>(null);
  const [v, setV] = useState(version);
  useEffect(() => {
    const l = () => setV(version);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    let live = true;
    void listUserTemplates().then((r) => live && setList(r));
    return () => {
      live = false;
    };
  }, [v]);
  return list;
}

async function store(tpl: UserTemplate): Promise<void> {
  await run('readwrite', (s) => s.put(tpl));
  changed();
}

/** Enregistre le document ouvert comme modèle personnel. */
export async function saveCurrentAsTemplate(name: string): Promise<boolean> {
  try {
    const live = editor.doc;
    const doc = await materialize(live);
    const thumb = await thumbnail(live);
    const bytes = await encodeFile(
      { ...doc, name },
      { thumbnail: thumb, generator: `Poulpe Design ${__APP_VERSION__}` },
    );
    const ab = live.artboards[0];
    await store({
      id: crypto.randomUUID(),
      name,
      width: ab?.width ?? 0,
      height: ab?.height ?? 0,
      bytes,
      thumb,
      createdAt: Date.now(),
    });
    toast(t('mytpl.saved', { name }));
    return true;
  } catch (e) {
    console.error(e);
    window.alert(t('mytpl.error'));
    return false;
  }
}

export async function deleteUserTemplate(tpl: UserTemplate): Promise<void> {
  if (!window.confirm(t('mytpl.deleteConfirm', { name: tpl.name }))) return;
  await run('readwrite', (s) => s.delete(tpl.id));
  changed();
}

export async function exportUserTemplate(tpl: UserTemplate): Promise<void> {
  await saveBytes(tpl.bytes, 'template', tpl.name);
}

/** Importe un fichier .poulpemodele (ou un document .poulpe) dans « Mes modèles ». */
export async function importUserTemplate(): Promise<void> {
  const file = await pickFile(['poulpemodele', 'poulpe'], '.poulpemodele,.poulpe');
  if (!file) return;
  try {
    const doc = await decodeFile(file.bytes);
    const name = baseName(file.name);
    const ab = doc.artboards[0];
    await store({
      id: crypto.randomUUID(),
      name,
      width: ab?.width ?? 0,
      height: ab?.height ?? 0,
      bytes: file.bytes,
      thumb: await thumbnail(doc),
      createdAt: Date.now(),
    });
    toast(t('mytpl.imported', { name }));
  } catch (e) {
    window.alert(e instanceof PoulpeFileError && e.code === 'tooNew' ? t('file.tooNew') : t('file.invalid'));
  }
}

/** Nouveau document (non enregistré) à partir d'un modèle personnel. */
export async function newFromUserTemplate(tpl: UserTemplate): Promise<void> {
  if (!confirmDiscard()) return;
  try {
    const doc = await decodeFile(tpl.bytes);
    editor.load({ ...doc, name: tpl.name });
    ui.set({ filePath: null, dialog: null });
    requestAnimationFrame(() => window.dispatchEvent(new Event('poulpe:fit')));
  } catch {
    window.alert(t('file.invalid'));
  }
}
