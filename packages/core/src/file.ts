import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { FORMAT_VERSION } from './factory';
import type { Asset, PoulpeDocument } from './types';

/*
 * Format de fichier `.poulpe` : une archive ZIP.
 *
 *   manifest.json   version du format, appli d'origine, liste des fichiers
 *   document.json   le document ; les images y sont référencées par leur chemin
 *   assets/images/  images d'origine, jamais recompressées
 *   thumbnail.png   aperçu (facultatif)
 */

export const POULPE_MIME = 'application/x-poulpe';
export const POULPE_EXTENSION = 'poulpe';

export interface Manifest {
  format: 'poulpe';
  version: number;
  generator: string;
  created: string;
  files: string[];
}

export class PoulpeFileError extends Error {
  constructor(
    /** `invalid` : pas un fichier Poulpe ; `tooNew` : créé par une version plus récente. */
    readonly code: 'invalid' | 'tooNew',
    message: string,
  ) {
    super(message);
  }
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new PoulpeFileError('invalid', 'URL de données invalide');
  const mime = m[1] ?? 'application/octet-stream';
  if (!m[2]) return { mime, bytes: strToU8(decodeURIComponent(m[3])) };
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${mime};base64,${btoa(bin)}`;
}

type StoredAsset = Omit<Asset, 'data'> & { path: string };

export function encodePoulpe(
  doc: PoulpeDocument,
  opts: { thumbnail?: Uint8Array; generator?: string } = {},
): Uint8Array {
  const files: Zippable = {};
  const assets: Record<string, StoredAsset> = {};
  for (const asset of Object.values(doc.assets)) {
    const { mime, bytes } = dataUrlToBytes(asset.data);
    const path = `assets/images/${asset.id}.${EXT[mime] ?? 'bin'}`;
    // Les images sont déjà compressées : on les stocke telles quelles.
    files[path] = [bytes, { level: 0 }];
    assets[asset.id] = { id: asset.id, mime, width: asset.width, height: asset.height, path };
  }
  const stored = { ...doc, version: FORMAT_VERSION, assets };
  files['document.json'] = strToU8(JSON.stringify(stored));
  if (opts.thumbnail) files['thumbnail.png'] = [opts.thumbnail, { level: 0 }];
  const manifest: Manifest = {
    format: 'poulpe',
    version: FORMAT_VERSION,
    generator: opts.generator ?? 'Poulpe',
    created: new Date().toISOString(),
    files: ['document.json', ...Object.keys(files).filter((f) => f !== 'document.json')],
  };
  // Le manifeste en premier, non compressé, pour qu'on puisse reconnaître le fichier facilement.
  return zipSync({ 'manifest.json': [strToU8(JSON.stringify(manifest, null, 2)), { level: 0 }], ...files });
}

/** Migrations d'un document d'une version du format à la suivante (`MIGRATIONS[v]` passe de v à v+1). */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // Version 2 : ajout des tracés libres (`path`). Rien à convertir, mais une ancienne version de
  // Poulpe refuse ainsi proprement un document qui en contient.
  1: (doc) => doc,
  // Version 3 : contours avancés (pointillés, extrémités, flèches), effets de calque, texte sur
  // tracé. Tous facultatifs : rien à convertir.
  2: (doc) => doc,
  // Version 4 : retouche photo (calques de réglage et filtres dynamiques, masques de calque).
  // Tout est nouveau ou facultatif : rien à convertir.
  3: (doc) => doc,
  // Version 5 : mise en page (pages maîtres, cadres de texte liés, numéros de page, fond perdu,
  // marges, résolution). Tous facultatifs : rien à convertir.
  4: (doc) => doc,
  // Version 6 : impression (mode colorimétrique `colorMode` et valeurs CMJN exactes `cmyk` de
  // `layout`). Facultatifs : rien à convertir.
  5: (doc) => doc,
  // Version 7 : outils photo et vectoriels avancés (tables LUT, modes de fusion des calques de
  // réglage…). Tout est nouveau ou facultatif : rien à convertir.
  6: (doc) => doc,
  // Version 8 : filtres en direct des calques (`filters`), images liées (`link`), plages de
  // fusion (`blendRanges`). Facultatifs : rien à convertir.
  7: (doc) => doc,
};

export function migrate(raw: Record<string, unknown>): PoulpeDocument {
  let doc = raw;
  let v = Number(doc.version);
  if (doc.format !== 'poulpe' || !Number.isInteger(v) || v < 1)
    throw new PoulpeFileError('invalid', "Ce n'est pas un document Poulpe");
  if (v > FORMAT_VERSION)
    throw new PoulpeFileError(
      'tooNew',
      `Document au format ${v}, cette version lit jusqu'au format ${FORMAT_VERSION}`,
    );
  while (v < FORMAT_VERSION) {
    doc = MIGRATIONS[v](doc);
    v += 1;
    doc.version = v;
  }
  if (!Array.isArray(doc.artboards)) throw new PoulpeFileError('invalid', 'Document sans plan de travail');
  return doc as unknown as PoulpeDocument;
}

export function decodePoulpe(bytes: Uint8Array): PoulpeDocument {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new PoulpeFileError('invalid', "Ce n'est pas une archive Poulpe");
  }
  const docFile = files['document.json'];
  if (!docFile) throw new PoulpeFileError('invalid', 'document.json manquant');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(strFromU8(docFile));
  } catch {
    throw new PoulpeFileError('invalid', 'document.json illisible');
  }
  const doc = migrate(raw);
  const assets: Record<string, Asset> = {};
  for (const stored of Object.values(doc.assets as unknown as Record<string, StoredAsset>)) {
    const data = files[stored.path];
    if (!data) continue;
    assets[stored.id] = {
      id: stored.id,
      mime: stored.mime,
      width: stored.width,
      height: stored.height,
      data: bytesToDataUrl(data, stored.mime),
    };
  }
  return { ...doc, assets };
}

export function readThumbnail(bytes: Uint8Array): Uint8Array | null {
  try {
    return unzipSync(bytes, { filter: (f) => f.name === 'thumbnail.png' })['thumbnail.png'] ?? null;
  } catch {
    return null;
  }
}
