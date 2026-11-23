/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

/*
 * Agrandissement par IA (Real-ESRGAN, ONNX Runtime en WebAssembly), hors du fil de l'interface :
 * chaque demande est une tuile (3 canaux de 0 à 1) ; la réponse est la tuile agrandie quatre fois.
 * Le modèle est chargé une fois puis gardé.
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
    const result = out[s.outputNames[0]].data as Float32Array;
    self.postMessage({ id, result }, { transfer: [result.buffer] });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
