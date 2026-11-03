import { inpaint } from '@poulpe/core';
import { nativeInpaint } from '../engine';

/*
 * Lance la gomme magique : sur le moteur natif dans l'appli de bureau, sinon dans un Web Worker
 * (l'interface reste fluide pendant le calcul), ou directement si les workers ne sont pas
 * disponibles.
 */

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./inpaint.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

export async function inpaintAsync(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  hole: Uint8Array,
  onProgress?: (f: number) => void,
  seed?: number,
  /** Forcer la version TypeScript (tests de comparaison). */
  ts = false,
): Promise<Uint8ClampedArray> {
  if (!ts && (await nativeInpaint(data, width, height, hole, seed ?? 1234567))) {
    onProgress?.(1);
    return data;
  }
  return inpaintInPage(data, width, height, hole, onProgress, seed, ts);
}

function inpaintInPage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  hole: Uint8Array,
  onProgress: ((f: number) => void) | undefined,
  seed: number | undefined,
  ts: boolean,
): Promise<Uint8ClampedArray> {
  const w = getWorker();
  if (!w) {
    inpaint({ data, width, height }, hole, { onProgress, seed });
    return Promise.resolve(data);
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<{ id: number; progress?: number; data?: Uint8ClampedArray }>) => {
      if (e.data.id !== id) return;
      if (e.data.data) {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        resolve(e.data.data);
      } else if (e.data.progress !== undefined) onProgress?.(e.data.progress);
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      worker = null;
      reject(e.error ?? new Error(e.message));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, data, width, height, hole, seed, ts }, [data.buffer]);
  });
}
