import { decodePoulpe, encodePoulpe, PoulpeFileError, type PoulpeDocument } from '@poulpe/core';
import { WorkerClient } from './smart/workers';

/*
 * Ouverture et enregistrement des `.poulpe` dans un Web Worker (file.worker.ts) pour les gros
 * fichiers ; les petits restent lus directement, c'est plus rapide que de lancer le worker.
 */

/** Au-delà, le fichier est lu ou écrit hors du fil de l'interface. */
const WORKER_BYTES = 4 << 20;

type Req =
  | { op: 'decode'; bytes: Uint8Array }
  | { op: 'encode'; doc: PoulpeDocument; thumbnail?: Uint8Array; generator: string };

const client = new WorkerClient<Req, { doc?: PoulpeDocument; bytes?: Uint8Array }>(
  () => new Worker(new URL('./file.worker.ts', import.meta.url), { type: 'module' }),
);

function rethrow(e: unknown): never {
  const code = e instanceof Error ? e.message : '';
  throw code === 'tooNew' || code === 'invalid' ? new PoulpeFileError(code, code) : e;
}

export async function decodeFile(bytes: Uint8Array): Promise<PoulpeDocument> {
  if (bytes.length < WORKER_BYTES || typeof Worker === 'undefined') return decodePoulpe(bytes);
  const r = await client.run({ op: 'decode', bytes }, () => true).catch(rethrow);
  return r.doc!;
}

/** Taille totale des images du document (en caractères de leurs données). */
function assetsSize(doc: PoulpeDocument): number {
  let n = 0;
  for (const a of Object.values(doc.assets)) n += a.data.length;
  return n;
}

export async function encodeFile(
  doc: PoulpeDocument,
  opts: { thumbnail?: Uint8Array; generator: string },
): Promise<Uint8Array> {
  if (assetsSize(doc) < WORKER_BYTES || typeof Worker === 'undefined') return encodePoulpe(doc, opts);
  const r = await client.run({ op: 'encode', doc, ...opts }, () => true).catch(rethrow);
  return r.bytes!;
}
