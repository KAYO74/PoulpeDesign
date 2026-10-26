import { useSyncExternalStore } from 'react';
import type { PoulpeDocument } from '@poulpe/core';
import { t } from './i18n';
import { editor } from './store';

/*
 * Instantanés de l'historique (Photoshop et Affinity) : l'état du document mis de côté sous un
 * nom, pour y revenir plus tard même après de nombreuses étapes. Revenir à un instantané est
 * une étape annulable. Comme dans Photoshop, ils durent le temps de la session.
 */

export interface Snapshot {
  id: number;
  name: string;
  /** Document au moment de l'instantané (les documents ne sont jamais modifiés sur place). */
  doc: PoulpeDocument;
  time: number;
}

let list: Snapshot[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Instantanés du document ouvert. */
function current(): Snapshot[] {
  const id = editor.doc.id;
  return list.filter((s) => s.doc.id === id);
}

let cache: { from: Snapshot[]; docId: string; out: Snapshot[] } | null = null;
function snapshotList(): Snapshot[] {
  const docId = editor.doc.id;
  if (!cache || cache.from !== list || cache.docId !== docId) cache = { from: list, docId, out: current() };
  return cache.out;
}

export function useSnapshots(): Snapshot[] {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    const off = editor.subscribe(l);
    return () => {
      listeners.delete(l);
      off();
    };
  }, snapshotList);
}

export function takeSnapshot(name?: string): void {
  const n = current().length + 1;
  list = [
    ...list,
    { id: nextId++, name: name ?? t('snapshot.name', { n }), doc: editor.doc, time: Date.now() },
  ];
  notify();
}

export function restoreSnapshot(id: number): void {
  const s = list.find((x) => x.id === id);
  if (s) editor.replaceDocument('history.restoreSnapshot', s.doc);
}

export function renameSnapshot(id: number, name: string): void {
  list = list.map((s) => (s.id === id ? { ...s, name } : s));
  notify();
}

export function deleteSnapshot(id: number): void {
  list = list.filter((s) => s.id !== id);
  notify();
}
