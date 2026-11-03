/// <reference lib="webworker" />
// Import direct des modules : le reste de @poulpe/core (Paper.js…) n'a rien à faire dans le worker.
import { inpaint } from '@poulpe/core/src/inpaint';
import { engineInpaint, startInpaintEngine } from '@poulpe/engine/src/inpaint';
import wasmUrl from '@poulpe/engine/wasm/poulpe_engine.wasm?url';

/*
 * Gomme magique, hors du fil de l'interface : reçoit les pixels d'une zone et le masque du
 * trou, renvoie les pixels reconstruits. Calcul par le moteur Rust (WebAssembly) ; s'il ne se
 * charge pas, la version TypeScript fait exactement le même calcul.
 */
let engine: Promise<boolean> | null = null;

self.onmessage = async (
  e: MessageEvent<{
    id: number;
    data: Uint8ClampedArray;
    width: number;
    height: number;
    hole: Uint8Array;
    seed?: number;
    ts?: boolean;
  }>,
) => {
  const { id, data, width, height, hole, seed, ts } = e.data;
  engine ??= startInpaintEngine(fetch(wasmUrl)).catch(() => false);
  const rust = !ts && (await engine) && engineInpaint(data, width, height, hole, { seed });
  if (!rust)
    inpaint({ data, width, height }, hole, {
      seed,
      onProgress: (progress) => self.postMessage({ id, progress }),
    });
  self.postMessage({ id, data, rust }, { transfer: [data.buffer] });
};
