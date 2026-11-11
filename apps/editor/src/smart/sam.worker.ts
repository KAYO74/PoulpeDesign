/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { SAM_MASK, samBest, samInput, samPrompt, type SamClick } from '@poulpe/core/src/sam';

/*
 * Sélection d'objet par clic (SlimSAM, ONNX Runtime en WebAssembly), hors du fil de l'interface.
 * L'encodeur analyse l'image une fois (quelques secondes) ; chaque clic ne passe plus que par le
 * décodeur (une fraction de seconde). Les modèles et la dernière analyse restent en mémoire.
 */

ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

type Sessions = { encoder: ort.InferenceSession; decoder: ort.InferenceSession };
let sessions: Promise<Sessions> | null = null;

async function open(url: string): Promise<ort.InferenceSession> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('model-missing');
  const bytes = new Uint8Array(await res.arrayBuffer());
  return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

/** Analyse de la dernière image. */
let analysed: {
  key: string;
  scale: number;
  embeddings: ort.Tensor;
  positional: ort.Tensor;
} | null = null;

type Request =
  | {
      id: number;
      kind: 'encode';
      key: string;
      encoderUrl: string;
      decoderUrl: string;
      data: Uint8ClampedArray;
      width: number;
      height: number;
      threads: number;
    }
  | { id: number; kind: 'decode'; key: string; clicks: SamClick[] };

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  const { id } = req;
  try {
    if (req.kind === 'encode') {
      if (analysed?.key === req.key) {
        self.postMessage({ id, ready: true, scale: analysed.scale });
        return;
      }
      if (!sessions) ort.env.wasm.numThreads = self.crossOriginIsolated ? req.threads : 1;
      self.postMessage({ id, progress: 0.05 });
      sessions ??= Promise.all([open(req.encoderUrl), open(req.decoderUrl)])
        .then(([encoder, decoder]) => ({ encoder, decoder }))
        .catch((err) => {
          sessions = null;
          throw err;
        });
      const { encoder } = await sessions;
      self.postMessage({ id, progress: 0.2 });
      const input = samInput({ data: req.data, width: req.width, height: req.height });
      const pixels = new ort.Tensor('float32', input.tensor, [1, 3, 1024, 1024]);
      const out = await encoder.run({ pixel_values: pixels });
      analysed = {
        key: req.key,
        scale: input.scale,
        embeddings: out.image_embeddings,
        positional: out.image_positional_embeddings,
      };
      self.postMessage({ id, ready: true, scale: input.scale });
    } else {
      if (!analysed || analysed.key !== req.key || !sessions) throw new Error('not-analysed');
      const { decoder } = await sessions;
      const { points, labels } = samPrompt(req.clicks, analysed.scale);
      const n = req.clicks.length;
      const out = await decoder.run({
        image_embeddings: analysed.embeddings,
        image_positional_embeddings: analysed.positional,
        input_points: new ort.Tensor('float32', points, [1, 1, n, 2]),
        input_labels: new ort.Tensor('int64', labels, [1, 1, n]),
      });
      // Trois masques proposés : on garde celui que le modèle note le mieux.
      const scores = out.iou_scores.data as Float32Array;
      const best = samBest(scores);
      const all = out.pred_masks.data as Float32Array;
      const logits = all.slice(best * SAM_MASK * SAM_MASK, (best + 1) * SAM_MASK * SAM_MASK);
      self.postMessage({ id, logits, score: scores[best] }, { transfer: [logits.buffer] });
    }
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
