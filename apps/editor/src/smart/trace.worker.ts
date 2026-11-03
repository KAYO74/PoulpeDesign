/// <reference lib="webworker" />
// Import direct des modules : le reste de @poulpe/core (Paper.js…) n'a rien à faire dans le worker.
import { setTraceLabeler, traceImage, type TraceOptions } from '@poulpe/core/src/trace';
import { engineLabel, startTraceEngine } from '@poulpe/engine/src/trace';
import wasmUrl from '@poulpe/engine/wasm/poulpe_engine.wasm?url';

/*
 * Vectorisation d'image, hors du fil de l'interface. L'étiquetage des couleurs passe par le moteur
 * Rust (WebAssembly) ; s'il ne se charge pas, le TypeScript fait le même calcul.
 */
let engine: Promise<boolean> | null = null;

self.onmessage = async (
  e: MessageEvent<{
    id: number;
    data: Uint8ClampedArray;
    width: number;
    height: number;
    options: TraceOptions;
    ts?: boolean;
  }>,
) => {
  const { id, data, width, height, options, ts } = e.data;
  engine ??= startTraceEngine(fetch(wasmUrl)).catch(() => false);
  setTraceLabeler(!ts && (await engine) ? engineLabel : null);
  try {
    const result = traceImage({ data, width, height }, options, (progress) =>
      self.postMessage({ id, progress }),
    );
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
