/// <reference lib="webworker" />
// Import direct du module : le reste de @poulpe/core (Paper.js…) n'a rien à faire dans le worker.
import { decodePoulpe, encodePoulpe, PoulpeFileError } from '@poulpe/core/src/file';
import type { PoulpeDocument } from '@poulpe/core';

/*
 * Lecture et écriture des fichiers `.poulpe`, hors du fil de l'interface : décompresser une
 * archive de plusieurs centaines de Mo et convertir ses images prend plusieurs secondes, pendant
 * lesquelles l'appli resterait figée.
 */
type Request =
  | { id: number; op: 'decode'; bytes: Uint8Array }
  | { id: number; op: 'encode'; doc: PoulpeDocument; thumbnail?: Uint8Array; generator: string };

self.onmessage = (e: MessageEvent<Request>) => {
  const r = e.data;
  try {
    if (r.op === 'decode') self.postMessage({ id: r.id, doc: decodePoulpe(r.bytes) });
    else {
      const bytes = encodePoulpe(r.doc, { thumbnail: r.thumbnail, generator: r.generator });
      self.postMessage({ id: r.id, bytes }, [bytes.buffer]);
    }
  } catch (err) {
    // Le code (`invalid`, `tooNew`) suffit à l'interface pour choisir son message.
    self.postMessage({ id: r.id, error: err instanceof PoulpeFileError ? err.code : 'invalid' });
  }
};
