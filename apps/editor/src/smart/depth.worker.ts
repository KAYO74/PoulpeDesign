/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

/*
 * Profondeur d'une image (Depth Anything V2 Small, ONNX Runtime en WebAssembly), hors du fil de
 * l'interface : la demande est l'image normalisée, la réponse est la profondeur inverse relative
 * (grand = proche). Le modèle est chargé une fois puis gardé.
 */

ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

let session: Promise<ort.InferenceSession> | null = null;

async function load(modelUrl: string): Promise<ort.InferenceSession> {
  const res = await fetch(modelUrl);
  // Sans le fichier, un serveur peut répondre par sa page d'accueil (HTML) avec un code 200.
  if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error('model-missing');
  const bytes = new Uint8Array(await res.arrayBuffer());
  return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

self.onmessage = async (
  e: MessageEvent<{
    id: number;
    modelUrl: string;
    input: Float32Array;
    width: number;
    height: number;
    threads: number;
  }>,
) => {
  const { id, modelUrl, input, width, height, threads } = e.data;
  try {
    if (!session) ort.env.wasm.numThreads = self.crossOriginIsolated ? threads : 1;
    session ??= load(modelUrl).catch((err) => {
      session = null;
      throw err;
    });
    const s = await session;
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, height, width]) });
    const t = out[s.outputNames[0]];
    const result = t.data as Float32Array;
    // Sortie [1, h, w] (ou [1, 1, h, w]) : les deux derniers nombres sont la taille.
    const dims = t.dims;
    self.postMessage(
      { id, result, width: dims[dims.length - 1], height: dims[dims.length - 2] },
      { transfer: [result.buffer] },
    );
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
