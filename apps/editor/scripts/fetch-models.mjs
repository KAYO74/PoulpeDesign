// Télécharge les modèles d'IA (détourage U²-Net « silueta », 44 Mo ; sélection d'objet SlimSAM, 14 Mo) dans public/models/, une seule
// fois. Il n'est pas gardé dans le dépôt Git ; il est embarqué dans l'appli et le site compilés, et
// le détourage fonctionne ensuite sans connexion. Sans réseau, la compilation continue : le
// détourage affiche alors un message.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = [
  {
    file: 'silueta.onnx',
    // Version figée du modèle publié par le projet rembg (licence MIT), dérivé de U²-Net (Apache 2.0).
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx',
    sha256: '75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb',
  },
  {
    // Sélection d'objet : SlimSAM-77 quantifié (Apache 2.0), conversion ONNX de Xenova, version figée.
    file: 'slimsam-encoder.onnx',
    url: 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/vision_encoder_quantized.onnx',
    sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971',
  },
  {
    file: 'slimsam-decoder.onnx',
    url: 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/prompt_encoder_mask_decoder_quantized.onnx',
    sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2',
  },
];

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
mkdirSync(dir, { recursive: true });
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

for (const m of MODELS) {
  const path = join(dir, m.file);
  if (existsSync(path) && sha(readFileSync(path)) === m.sha256) continue;
  try {
    console.log(`Téléchargement du modèle ${m.file}…`);
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== m.sha256) throw new Error('empreinte SHA-256 inattendue');
    writeFileSync(path, buf);
  } catch (e) {
    console.warn(
      `Modèle ${m.file} indisponible (${e.message}) : la fonction d'IA correspondante sera désactivée.`,
    );
    if (process.env.POULPE_REQUIRE_MODELS) process.exit(1);
  }
}
