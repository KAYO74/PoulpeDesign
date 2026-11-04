/// <reference lib="webworker" />
// Import direct des modules : le reste de @poulpe/core n'a rien à faire dans le worker.
import { fuseImages, type FusionOptions } from '@poulpe/core/src/fusion';
import { engineFuse, startFusionEngine } from '@poulpe/engine/src/fusion';
import wasmUrl from '@poulpe/engine/wasm/poulpe_engine.wasm?url';

/*
 * Fusion d'images hors du fil de l'interface ; annuler = fermer le worker. Le calcul passe par le
 * moteur Rust (WebAssembly) ; s'il ne se charge pas, le TypeScript fait le même calcul.
 */
let engine: Promise<boolean> | null = null;

self.onmessage = async (
  e: MessageEvent<{
    id: number;
    images: { data: Uint8ClampedArray; width: number; height: number }[];
    options: Omit<FusionOptions, 'progress'>;
    /** Forcer la version TypeScript (tests de comparaison). */
    ts?: boolean;
  }>,
) => {
  const { id, images, options, ts } = e.data;
  engine ??= startFusionEngine(fetch(wasmUrl)).catch(() => false);
  const ready = !ts && (await engine);
  const opts = { ...options, progress: (progress: number) => self.postMessage({ id, progress }) };
  try {
    let result = ready ? engineFuse(images, opts) : undefined;
    result ??= fuseImages(images, opts);
    self.postMessage({ id, result }, result ? [result.data.buffer] : []);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
