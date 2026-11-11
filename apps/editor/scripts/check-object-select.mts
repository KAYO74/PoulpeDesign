// Vérifie la sélection d'objet sur une vraie photo, hors navigateur (Node) : même préparation et même
// traitement du masque que l'éditeur (packages/core/src/sam.ts), mêmes modèles ONNX.
//
//   npm i sharp tsx onnxruntime-web@1.30      (dans un dossier de travail)
//   npx tsx check-object-select.mts <dossier des modèles> <photo> <x> <y> [sortie.png]
//
// x et y : position du clic, de 0 à 1 (0,5 0,5 = centre). Écrit la photo avec l'objet teinté en rouge.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import * as ort from 'onnxruntime-web/wasm';
import { SAM_MASK, samBest, samInput, samMask, samPrompt } from '../../../packages/core/src/sam';

const [dir, photo, fx, fy, out = 'object-select.png'] = process.argv.slice(2);
if (!dir || !photo || fx === undefined || fy === undefined) {
  console.error('usage : check-object-select.mts <dossier modèles> <photo> <x 0-1> <y 0-1> [sortie.png]');
  process.exit(1);
}
const SIDE = 1024;
const meta = await sharp(photo).metadata();
const k = Math.min(1, SIDE / Math.max(meta.width!, meta.height!));
const { data, info } = await sharp(photo)
  .resize(Math.round(meta.width! * k), Math.round(meta.height! * k))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const px = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };

const open = (f: string) =>
  ort.InferenceSession.create(new Uint8Array(readFileSync(`${dir}/${f}`)), { executionProviders: ['wasm'] });
const [encoder, decoder] = await Promise.all([open('slimsam-encoder.onnx'), open('slimsam-decoder.onnx')]);

let t = Date.now();
const input = samInput(px);
const enc = await encoder.run({ pixel_values: new ort.Tensor('float32', input.tensor, [1, 3, 1024, 1024]) });
console.log(`encodeur : ${Date.now() - t} ms`);

t = Date.now();
const click = { x: Number(fx) * px.width, y: Number(fy) * px.height, positive: true };
const { points, labels } = samPrompt([click], input.scale);
const res = await decoder.run({
  image_embeddings: enc.image_embeddings,
  image_positional_embeddings: enc.image_positional_embeddings,
  input_points: new ort.Tensor('float32', points, [1, 1, 1, 2]),
  input_labels: new ort.Tensor('int64', labels, [1, 1, 1]),
});
const scores = res.iou_scores.data as Float32Array;
const best = samBest(scores);
console.log(
  `décodeur : ${Date.now() - t} ms, notes ${Array.from(scores).map((s) => s.toFixed(3))}, retenu ${best}`,
);
const logits = (res.pred_masks.data as Float32Array).slice(
  best * SAM_MASK * SAM_MASK,
  (best + 1) * SAM_MASK * SAM_MASK,
);
const alpha = samMask(logits, input.scale, px.width, px.height);

let covered = 0;
const tinted = Buffer.from(px.data);
for (let i = 0; i < alpha.length; i++) {
  covered += alpha[i] / 255;
  const a = alpha[i] / 255;
  tinted[i * 4] = tinted[i * 4] * (1 - 0.6 * a) + 255 * 0.6 * a;
  tinted[i * 4 + 1] *= 1 - 0.6 * a;
  tinted[i * 4 + 2] *= 1 - 0.6 * a;
}
console.log(`objet : ${((100 * covered) / alpha.length).toFixed(1)} % de l'image`);
await sharp(tinted, { raw: { width: px.width, height: px.height, channels: 4 } })
  .png()
  .toFile(out);
console.log(`écrit : ${out}`);
