import { inpaint } from '@poulpe/core';

/*
 * Lance la gomme magique dans un Web Worker (l'interface reste fluide pendant le calcul), ou
 * directement si les workers ne sont pas disponibles.
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

export function inpaintAsync(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  hole: Uint8Array,
  onProgress?: (f: number) => void,
  seed?: number,
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
    w.postMessage({ id, data, width, height, hole, seed }, [data.buffer]);
  });
}
