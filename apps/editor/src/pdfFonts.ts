import type { jsPDF } from 'jspdf';
import { styleAt, walkDocument, type Artboard, type PoulpeDocument } from '@poulpe/core';
import { isDesktop } from './io';

/*
 * Polices intégrées dans le PDF. jsPDF n'accepte que les polices TrueType : les polices fournies
 * avec Poulpe sont lues dans leurs fichiers WOFF (convertis ici), les polices installées sont
 * lues par l'appli de bureau ou, dans le navigateur, par l'API Local Font Access quand elle est permise.
 */

import f0 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import f1 from '@fontsource/inter/files/inter-latin-400-italic.woff?url';
import f2 from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import f3 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import f4 from '@fontsource/inter/files/inter-latin-700-italic.woff?url';
import f5 from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff?url';
import f6 from '@fontsource/montserrat/files/montserrat-latin-400-italic.woff?url';
import f7 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff?url';
import f8 from '@fontsource/montserrat/files/montserrat-latin-800-normal.woff?url';
import f9 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff?url';
import f10 from '@fontsource/playfair-display/files/playfair-display-latin-400-italic.woff?url';
import f11 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff?url';
import f12 from '@fontsource/lora/files/lora-latin-400-normal.woff?url';
import f13 from '@fontsource/lora/files/lora-latin-400-italic.woff?url';
import f14 from '@fontsource/lora/files/lora-latin-700-normal.woff?url';
import f15 from '@fontsource/oswald/files/oswald-latin-400-normal.woff?url';
import f16 from '@fontsource/oswald/files/oswald-latin-700-normal.woff?url';
import f17 from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-400-normal.woff?url';
import f18 from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff?url';
import f19 from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';

/** Fichiers des polices fournies (ceux que charge `fonts.ts`). */
const BUNDLED: { family: string; weight: number; italic: boolean; url: string }[] = [
  { family: 'Inter', weight: 400, italic: false, url: f0 },
  { family: 'Inter', weight: 400, italic: true, url: f1 },
  { family: 'Inter', weight: 600, italic: false, url: f2 },
  { family: 'Inter', weight: 700, italic: false, url: f3 },
  { family: 'Inter', weight: 700, italic: true, url: f4 },
  { family: 'Montserrat', weight: 400, italic: false, url: f5 },
  { family: 'Montserrat', weight: 400, italic: true, url: f6 },
  { family: 'Montserrat', weight: 700, italic: false, url: f7 },
  { family: 'Montserrat', weight: 800, italic: false, url: f8 },
  { family: 'Playfair Display', weight: 400, italic: false, url: f9 },
  { family: 'Playfair Display', weight: 400, italic: true, url: f10 },
  { family: 'Playfair Display', weight: 700, italic: false, url: f11 },
  { family: 'Lora', weight: 400, italic: false, url: f12 },
  { family: 'Lora', weight: 400, italic: true, url: f13 },
  { family: 'Lora', weight: 700, italic: false, url: f14 },
  { family: 'Oswald', weight: 400, italic: false, url: f15 },
  { family: 'Oswald', weight: 700, italic: false, url: f16 },
  { family: 'Bricolage Grotesque', weight: 400, italic: false, url: f17 },
  { family: 'Bricolage Grotesque', weight: 700, italic: false, url: f18 },
  { family: 'Pacifico', weight: 400, italic: false, url: f19 },
];

interface Face {
  family: string;
  weight: number;
  italic: boolean;
}

/** Nom de style attendu par svg2pdf pour une graisse et un style donnés. */
export function pdfStyleKey(weight: number, italic: boolean): string {
  if (weight === 400) return italic ? 'italic' : 'normal';
  if (weight === 700 && !italic) return 'bold';
  return `${weight === 700 ? 'bold' : weight}${italic ? 'italic' : 'normal'}`;
}

/** Convertit une police WOFF (1.0) en police SFNT (TrueType ou OpenType). */
export async function woffToSfnt(woff: Uint8Array): Promise<Uint8Array> {
  const { unzlibSync } = await import('fflate');
  const v = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (v.getUint32(0) !== 0x774f4646) throw new Error('pas un fichier WOFF');
  const flavor = v.getUint32(4);
  const numTables = v.getUint16(12);
  const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const p = 44 + i * 20;
    const offset = v.getUint32(p + 4);
    const compLength = v.getUint32(p + 8);
    const origLength = v.getUint32(p + 12);
    const raw = woff.subarray(offset, offset + compLength);
    tables.push({
      tag: v.getUint32(p),
      checksum: v.getUint32(p + 16),
      data: compLength < origLength ? unzlibSync(raw) : raw,
    });
  }
  const headerSize = 12 + numTables * 16;
  const size = tables.reduce((s, t) => s + ((t.data.length + 3) & ~3), headerSize);
  const out = new Uint8Array(size);
  const o = new DataView(out.buffer);
  let pow = 1;
  while (pow * 2 <= numTables) pow *= 2;
  o.setUint32(0, flavor);
  o.setUint16(4, numTables);
  o.setUint16(6, pow * 16);
  o.setUint16(8, Math.log2(pow));
  o.setUint16(10, numTables * 16 - pow * 16);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const p = 12 + i * 16;
    o.setUint32(p, t.tag);
    o.setUint32(p + 4, t.checksum);
    o.setUint32(p + 8, offset);
    o.setUint32(p + 12, t.data.length);
    out.set(t.data, offset);
    offset += (t.data.length + 3) & ~3;
  });
  return out;
}

function isTrueType(b: Uint8Array): boolean {
  return (
    b.length > 4 &&
    ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) ||
      String.fromCharCode(...b.subarray(0, 4)) === 'true')
  );
}

async function bundledFace(f: Face): Promise<Uint8Array | null> {
  const files = BUNDLED.filter((b) => b.family === f.family);
  if (!files.length) return null;
  // Même style si possible, puis la graisse la plus proche.
  const sameStyle = files.filter((b) => b.italic === f.italic);
  const pool = sameStyle.length ? sameStyle : files;
  const best = pool.reduce((a, b) => (Math.abs(b.weight - f.weight) < Math.abs(a.weight - f.weight) ? b : a));
  const res = await fetch(best.url);
  return woffToSfnt(new Uint8Array(await res.arrayBuffer()));
}

async function systemFace(f: Face): Promise<Uint8Array | null> {
  if (isDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const data = await invoke<ArrayBuffer>('font_data', {
      family: f.family,
      weight: f.weight,
      italic: f.italic,
    }).catch(() => null);
    return data ? new Uint8Array(data) : null;
  }
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
  if (!query) return null;
  try {
    const all = (await query()).filter((x) => x.family === f.family);
    const italic = (x: LocalFont) => /italic|oblique/i.test(x.style);
    const weightOf = (x: LocalFont) => {
      const s = x.style.toLowerCase();
      const table: [RegExp, number][] = [
        [/thin|hairline/, 100],
        [/extra ?light|ultra ?light/, 200],
        [/light/, 300],
        [/medium/, 500],
        [/semi ?bold|demi ?bold/, 600],
        [/extra ?bold|ultra ?bold/, 800],
        [/black|heavy/, 900],
        [/bold/, 700],
      ];
      return table.find(([re]) => re.test(s))?.[1] ?? 400;
    };
    const pool = all.filter((x) => italic(x) === f.italic);
    const list = pool.length ? pool : all;
    if (!list.length) return null;
    const best = list.reduce((a, b) =>
      Math.abs(weightOf(b) - f.weight) < Math.abs(weightOf(a) - f.weight) ? b : a,
    );
    return new Uint8Array(await (await best.blob()).arrayBuffer());
  } catch {
    return null;
  }
}

interface LocalFont {
  family: string;
  style: string;
  blob(): Promise<Blob>;
}

/** Fichier d'une police (fournie avec Poulpe ou installée), au format TrueType ou OpenType. */
export async function fontFaceBytes(face: Face): Promise<Uint8Array | null> {
  try {
    return (await bundledFace(face)) ?? (await systemFace(face));
  } catch {
    return null;
  }
}

/** Polices (famille, graisse, style) utilisées par les textes des plans de travail. */
export function usedFaces(doc: PoulpeDocument, artboards: Artboard[]): Face[] {
  const ids = new Set(artboards.map((a) => a.id));
  const faces = new Map<string, Face>();
  for (const { node: n, artboard } of walkDocument(doc)) {
    if (n.type !== 'text' || !n.visible || !ids.has(artboard.id)) continue;
    const styles = [n.style, ...(n.runs ?? []).map((r) => styleAt(n, r.start))];
    for (const st of styles) {
      const face = { family: st.fontFamily, weight: st.fontWeight, italic: st.italic };
      faces.set(`${face.family}|${face.weight}|${face.italic}`, face);
    }
  }
  return [...faces.values()];
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Ajoute au PDF les polices utilisées. Renvoie les familles qu'il a fallu remplacer par une
 * police standard (introuvables ou au format PostScript).
 */
export async function embedFonts(pdf: jsPDF, doc: PoulpeDocument, artboards: Artboard[]): Promise<string[]> {
  const missing = new Set<string>();
  const cache = new Map<string, Uint8Array | null>();
  for (const face of usedFaces(doc, artboards)) {
    let bytes: Uint8Array | null;
    try {
      bytes = (await bundledFace(face)) ?? (await systemFace(face));
    } catch {
      bytes = null;
    }
    if (!bytes || !isTrueType(bytes)) {
      missing.add(face.family);
      continue;
    }
    const file = `${face.family}-${face.weight}${face.italic ? 'i' : ''}.ttf`.replace(/\s+/g, '_');
    if (!cache.has(file)) {
      pdf.addFileToVFS(file, toBase64(bytes));
      cache.set(file, bytes);
    }
    pdf.addFont(file, face.family, pdfStyleKey(face.weight, face.italic), undefined, 'Identity-H');
  }
  return [...missing];
}
