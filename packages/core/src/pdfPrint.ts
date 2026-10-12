import { unzlibSync, zlibSync } from 'fflate';
import { PRINT_CONDITION, rgbToInkFast } from './cmyk';
import { formatColor } from './color';
import { ICC_DESCRIPTION, cmykIccProfile } from './icc';
import type { PoulpeDocument } from './types';

/*
 * Préparation d'un PDF pour l'imprimeur : conversion en CMJN et norme PDF/X-4.
 *
 * Le PDF produit par jsPDF est relu objet par objet : les couleurs des tracés (opérateurs rg/RG),
 * des dégradés et des images passent de RVB en CMJN, les polices inutilisées disparaissent, et
 * pour le PDF/X on ajoute le profil de sortie (OutputIntent), les métadonnées XMP et les entrées
 * exigées par la norme ISO 15930-7. Le fichier est ensuite réécrit avec une nouvelle table xref.
 */

export interface PrintPdfOptions {
  /** Norme PDF/X-4 (sinon : simple PDF en CMJN). */
  pdfx?: boolean;
  title?: string;
  creator?: string;
  /** Pour les couleurs choisies directement en CMJN. */
  doc?: Pick<PoulpeDocument, 'layout'>;
  /** Date du document (pour des fichiers reproductibles dans les tests). */
  date?: Date;
}

export interface PrintPdfResult {
  bytes: Uint8Array;
  /** Ce qui empêche la conformité stricte : images JPEG restées en RVB, polices non incorporées. */
  warnings: { rgbImages: number; unembeddedFonts: string[] };
}

interface PdfObject {
  num: number;
  /** Texte de l'objet (dictionnaire ou autre valeur), sans le flux. */
  text: string;
  /** Contenu brut du flux (une lettre par octet), ou null. */
  stream: string | null;
}

const WS = ' \t\r\n\f\0';
const DELIM = '()<>[]{}/%';
const isWs = (c: string) => WS.includes(c);

function bytesToLatin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}

function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

/** Fin (exclue) de la valeur PDF qui commence à `i`. */
function skipValue(s: string, i: number): number {
  const c = s[i];
  if (c === '<' && s[i + 1] === '<') {
    let depth = 0;
    while (i < s.length) {
      if (s[i] === '(') i = skipValue(s, i);
      else if (s[i] === '<' && s[i + 1] === '<') {
        depth++;
        i += 2;
      } else if (s[i] === '>' && s[i + 1] === '>') {
        depth--;
        i += 2;
        if (!depth) return i;
      } else if (s[i] === '<') i = s.indexOf('>', i) + 1;
      else i++;
    }
    return i;
  }
  if (c === '[') {
    i++;
    while (i < s.length && s[i] !== ']') {
      if (isWs(s[i])) i++;
      else i = skipValue(s, i);
    }
    return i + 1;
  }
  if (c === '(') {
    let depth = 0;
    for (; i < s.length; i++) {
      if (s[i] === '\\') i++;
      else if (s[i] === '(') depth++;
      else if (s[i] === ')' && !--depth) return i + 1;
    }
    return i;
  }
  if (c === '<') return s.indexOf('>', i) + 1;
  // Nom, nombre, mot-clé ; une référence « 12 0 R » forme une seule valeur.
  let j = i + 1;
  while (j < s.length && !isWs(s[j]) && !DELIM.includes(s[j])) j++;
  const ref = /^\s+\d+\s+R(?![^\s<>[\]()/%])/.exec(s.slice(j, j + 20));
  if (/^\d+$/.test(s.slice(i, j)) && ref) return j + ref[0].length;
  return j;
}

/** Entrées d'un dictionnaire `<< … >>`, dans l'ordre. */
function dictEntries(d: string): [string, string][] {
  const out: [string, string][] = [];
  let i = d.indexOf('<<') + 2;
  while (i < d.length) {
    while (i < d.length && isWs(d[i])) i++;
    if (d[i] === '>' && d[i + 1] === '>') break;
    if (d[i] !== '/') {
      i = skipValue(d, i);
      continue;
    }
    const k = skipValue(d, i);
    const key = d.slice(i + 1, k);
    i = k;
    while (i < d.length && isWs(d[i])) i++;
    const e = skipValue(d, i);
    out.push([key, d.slice(i, e)]);
    i = e;
  }
  return out;
}

const dictText = (entries: [string, string][]) =>
  `<<\n${entries.map(([k, v]) => `/${k} ${v}`).join('\n')}\n>>`;

function get(d: string, key: string): string | undefined {
  return d.startsWith('<<') ? dictEntries(d).find(([k]) => k === key)?.[1] : undefined;
}

function set(d: string, key: string, value: string | null): string {
  const entries = dictEntries(d).filter(([k]) => k !== key);
  if (value !== null) entries.push([key, value]);
  return dictText(entries);
}

const refNum = (v: string | undefined) => {
  const m = v && /^(\d+)\s+\d+\s+R$/.exec(v.trim());
  return m ? Number(m[1]) : null;
};
const refsIn = (v: string) => [...v.matchAll(/(\d+)\s+\d+\s+R(?![^\s<>[\]()/%])/g)].map((m) => Number(m[1]));

function parsePdf(s: string): { objects: Map<number, PdfObject>; trailer: string } {
  const objects = new Map<number, PdfObject>();
  const head = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(s))) {
    let i = m.index + m[0].length;
    while (isWs(s[i])) i++;
    const start = i;
    let text: string;
    let stream: string | null = null;
    if (s.startsWith('<<', i)) {
      i = skipValue(s, i);
      text = s.slice(start, i);
      let j = i;
      while (isWs(s[j])) j++;
      if (s.startsWith('stream', j)) {
        j += 6;
        if (s[j] === '\r') j++;
        if (s[j] === '\n') j++;
        const len = get(text, 'Length');
        let end = len && /^\d+$/.test(len.trim()) ? j + Number(len) : -1;
        if (end < 0 || !/^\s*endstream/.test(s.slice(end, end + 20))) {
          end = s.indexOf('endstream', j);
          while (end > j && (s[end - 1] === '\n' || s[end - 1] === '\r')) end--;
        }
        stream = s.slice(j, end);
        i = s.indexOf('endstream', end) + 9;
      }
    } else {
      i = s.indexOf('endobj', i);
      text = s.slice(start, i).trim();
    }
    const e = s.indexOf('endobj', i);
    objects.set(Number(m[1]), { num: Number(m[1]), text, stream });
    head.lastIndex = e + 6;
  }
  const t = s.lastIndexOf('trailer');
  const trailer = t >= 0 ? s.slice(s.indexOf('<<', t), skipValue(s, s.indexOf('<<', t))) : '<<>>';
  return { objects, trailer };
}

// ————— Couleurs —————

const fmt = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return r === Math.trunc(r) ? r.toFixed(0) : String(r);
};

function makeConverter(doc?: Pick<PoulpeDocument, 'layout'>) {
  const exact = Object.entries(doc?.layout?.cmyk ?? {}).map(([hex, v]) => {
    const n = parseInt(hex.slice(1, 7), 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, v };
  });
  const cache = new Map<string, number[]>();
  return (r: number, g: number, b: number): number[] => {
    const R = Math.round(Math.max(0, Math.min(1, r)) * 255),
      G = Math.round(Math.max(0, Math.min(1, g)) * 255),
      B = Math.round(Math.max(0, Math.min(1, b)) * 255);
    const key = formatColor({ r: R, g: G, b: B, a: 1 });
    let out = cache.get(key);
    if (!out) {
      // Les valeurs du PDF sont arrondies : on retrouve une couleur CMJN exacte à 2 niveaux près.
      const hit = exact.find(
        (e) => Math.abs(e.r - R) <= 2 && Math.abs(e.g - G) <= 2 && Math.abs(e.b - B) <= 2,
      );
      out = hit ? hit.v.map((x) => x / 100) : [...rgbToInkFast(R, G, B, new Float32Array(4))];
      cache.set(key, out);
    }
    return out;
  };
}

/** Passe les opérateurs de couleur RVB d'un flux de contenu en CMJN. */
function convertContent(s: string, cmyk: (r: number, g: number, b: number) => number[]): string {
  const out: string[] = [];
  let operands: string[] = [];
  let fillRgb = false,
    strokeRgb = false;
  let i = 0;
  // Chaque opérateur sur sa ligne, après ses opérandes.
  const emit = (op: string) => {
    out.push([...operands, op].join(' '));
    operands = [];
  };
  while (i < s.length) {
    const c = s[i];
    if (isWs(c)) {
      i++;
      continue;
    }
    if (c === '%') {
      const e = s.indexOf('\n', i);
      i = e < 0 ? s.length : e + 1;
      continue;
    }
    if (c === '(' || c === '<' || c === '[' || c === '/') {
      const e = skipValue(s, i);
      operands.push(s.slice(i, e));
      i = e;
      continue;
    }
    let j = i + 1;
    while (j < s.length && !isWs(s[j]) && !DELIM.includes(s[j])) j++;
    const tok = s.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      operands.push(tok);
      continue;
    }
    // Opérateur.
    const nums = operands.map(Number);
    const rgb3 = operands.length >= 3 && nums.slice(-3).every((n) => Number.isFinite(n));
    if ((tok === 'rg' || tok === 'RG') && rgb3) {
      const v = cmyk(nums.at(-3)!, nums.at(-2)!, nums.at(-1)!);
      operands = [...operands.slice(0, -3), ...v.map(fmt)];
      emit(tok === 'rg' ? 'k' : 'K');
    } else if ((tok === 'cs' || tok === 'CS') && operands.at(-1) === '/DeviceRGB') {
      operands[operands.length - 1] = '/DeviceCMYK';
      if (tok === 'cs') fillRgb = true;
      else strokeRgb = true;
      emit(tok);
    } else if (
      (tok === 'sc' || tok === 'scn' || tok === 'SC' || tok === 'SCN') &&
      rgb3 &&
      (tok === 'sc' || tok === 'scn' ? fillRgb : strokeRgb)
    ) {
      const v = cmyk(nums.at(-3)!, nums.at(-2)!, nums.at(-1)!);
      operands = [...operands.slice(0, -3), ...v.map(fmt)];
      emit(tok);
    } else {
      if (tok === 'cs') fillRgb = false;
      if (tok === 'CS') strokeRgb = false;
      emit(tok);
      // Image en ligne : on recopie ses données telles quelles.
      if (tok === 'ID') {
        const e = s.indexOf('EI', i);
        out.push(s.slice(i + 1, e) + 'EI');
        i = e + 2;
      }
    }
  }
  if (operands.length) out.push(operands.join(' '));
  return out.join('\n') + '\n';
}

function convertColorArrays(text: string, cmyk: (r: number, g: number, b: number) => number[]): string {
  return text.replace(
    /\/(C0|C1)\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g,
    (_, k: string, r: string, g: string, b: string) =>
      `/${k} [${cmyk(Number(r), Number(g), Number(b)).map(fmt).join(' ')}]`,
  );
}

function unpredict(data: Uint8Array, colors: number, columns: number): Uint8Array {
  const bpp = colors;
  const row = columns * bpp;
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let y = 0; y < rows; y++) {
    const f = data[y * (row + 1)];
    const src = y * (row + 1) + 1;
    const dst = y * row;
    for (let x = 0; x < row; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y ? out[dst - row + x] : 0;
      const c = x >= bpp && y ? out[dst - row + x - bpp] : 0;
      let v = data[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + x] = v & 255;
    }
  }
  return out;
}

/** Données décodées d'un flux (sans filtre, Flate avec ou sans prédicteur PNG, hexadécimal), ou null. */
function decodeStream(o: PdfObject, colors: number, columns: number): Uint8Array | null {
  const f = get(o.text, 'Filter');
  const filters = f ? [...f.matchAll(/\/(\w+)/g)].map((m) => m[1]) : [];
  let data = latin1ToBytes(o.stream!);
  try {
    for (const name of filters) {
      if (name === 'FlateDecode') data = unzlibSync(data);
      else if (name === 'ASCIIHexDecode') {
        const hex = bytesToLatin1(data).replace(/[^0-9a-fA-F]/g, '');
        const out = new Uint8Array(hex.length >> 1);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        data = out;
      } else return null;
    }
  } catch {
    return null;
  }
  const parms = get(o.text, 'DecodeParms');
  const predictor = parms ? Number(get(parms, 'Predictor')) : 1;
  if (filters.includes('FlateDecode') && predictor >= 10) data = unpredict(data, colors, columns);
  return data;
}

/** Replace le flux par des données brutes (compressées à l'écriture). */
function setRawStream(o: PdfObject, data: Uint8Array): void {
  o.text = set(set(o.text, 'Filter', null), 'DecodeParms', null);
  o.stream = bytesToLatin1(data);
}

/** Pixels RVB (3 octets) → CMJN (4 octets). */
function rgbBytesToCmyk(raw: Uint8Array, cmyk: (r: number, g: number, b: number) => number[]): Uint8Array {
  const n = Math.floor(raw.length / 3);
  const out = new Uint8Array(n * 4);
  const cache = new Map<number, number[]>();
  for (let p = 0; p < n; p++) {
    const key = (raw[p * 3] << 16) | (raw[p * 3 + 1] << 8) | raw[p * 3 + 2];
    let v = cache.get(key);
    if (!v) {
      v = cmyk(raw[p * 3] / 255, raw[p * 3 + 1] / 255, raw[p * 3 + 2] / 255).map((x) => Math.round(x * 255));
      if (cache.size < 100000) cache.set(key, v);
    }
    out.set(v, p * 4);
  }
  return out;
}

/** Image RVB 8 bits → image CMJN. Renvoie false si son codage n'est pas géré (JPEG). */
function convertImage(o: PdfObject, cmyk: (r: number, g: number, b: number) => number[]): boolean {
  if (get(o.text, 'BitsPerComponent')?.trim() !== '8') return false;
  const raw = decodeStream(o, 3, Number(get(o.text, 'Width')));
  if (!raw) return false;
  setRawStream(o, rgbBytesToCmyk(raw, cmyk));
  o.text = set(o.text, 'ColorSpace', '/DeviceCMYK');
  if (get(o.text, 'Decode')) o.text = set(o.text, 'Decode', null);
  return true;
}

/** Fonction échantillonnée (dégradé) à 3 sorties RVB → 4 sorties CMJN. */
function convertSampledFunction(o: PdfObject, cmyk: (r: number, g: number, b: number) => number[]): void {
  const range = (get(o.text, 'Range') ?? '').replace(/[[\]]/g, ' ').trim().split(/\s+/);
  if (range.length !== 6 || get(o.text, 'BitsPerSample')?.trim() !== '8' || o.stream === null) return;
  const raw = decodeStream(o, 3, 1);
  if (!raw) return;
  setRawStream(o, rgbBytesToCmyk(raw, cmyk));
  o.text = set(o.text, 'Range', '[0 1 0 1 0 1 0 1]');
  o.text = set(o.text, 'Decode', '[0 1 0 1 0 1 0 1]');
}

/** Palette d'une image indexée `[/Indexed /DeviceRGB n <…>]` → CMJN. */
function convertIndexed(cs: string, cmyk: (r: number, g: number, b: number) => number[]): string | null {
  const m = /^\[\s*\/Indexed\s+\/DeviceRGB\s+(\d+)\s+(<[0-9a-fA-F\s]*>|\([\s\S]*\))\s*\]$/.exec(cs.trim());
  if (!m) return null;
  let bytes: number[];
  if (m[2].startsWith('<')) {
    const hex = m[2].slice(1, -1).replace(/\s/g, '');
    bytes = [];
    for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  } else {
    const body = m[2].slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e: string) => {
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      return /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : (map[e] ?? e);
    });
    bytes = [...body].map((ch) => ch.charCodeAt(0));
  }
  let hex = '';
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    for (const v of cmyk(bytes[i] / 255, bytes[i + 1] / 255, bytes[i + 2] / 255))
      hex += Math.round(v * 255)
        .toString(16)
        .padStart(2, '0');
  }
  return `[/Indexed /DeviceCMYK ${m[1]} <${hex}>]`;
}

// ————— Réécriture —————

const STANDARD_FONTS = /^\/(Helvetica|Courier|Times|Symbol|ZapfDingbats)/;

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function xmpDate(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

const pdfString = (s: string) => {
  // Texte en UTF-16BE (avec BOM) pour les accents, codé en hexadécimal.
  let hex = 'FEFF';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c > 0xffff) {
      const v = c - 0x10000;
      hex +=
        (0xd800 + (v >> 10)).toString(16).padStart(4, '0') +
        (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += c.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
};

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function uuid(seed: string): string {
  let h = 2166136261;
  const hex: string[] = [];
  for (let k = 0; k < 4; k++) {
    for (const ch of seed + k) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    hex.push(h.toString(16).padStart(8, '0'));
  }
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/** Convertit en CMJN (et en PDF/X-4 si demandé) un PDF produit par jsPDF. */
export function preparePrintPdf(input: Uint8Array, opts: PrintPdfOptions = {}): PrintPdfResult {
  const src = bytesToLatin1(input);
  const { objects, trailer } = parsePdf(src);
  const cmyk = makeConverter(opts.doc);
  const warnings = { rgbImages: 0, unembeddedFonts: [] as string[] };

  // Flux de contenu : pages, formes (groupes) et motifs.
  const contents = new Set<number>();
  for (const o of objects.values()) {
    const type = get(o.text, 'Type')?.trim();
    if (type === '/Page') for (const r of refsIn(get(o.text, 'Contents') ?? '')) contents.add(r);
    if (
      o.stream !== null &&
      (get(o.text, 'Subtype')?.trim() === '/Form' || get(o.text, 'PatternType')?.trim() === '1')
    )
      contents.add(o.num);
  }
  const usedFonts = new Set<string>();
  for (const num of contents) {
    const o = objects.get(num);
    if (!o || o.stream === null) continue;
    const data = decodeStream(o, 1, 1);
    if (!data) continue;
    const plain = bytesToLatin1(data);
    for (const m of plain.matchAll(/\/([^\s/[\]<>(){}%]+)\s+[-\d.]+\s+Tf/g)) usedFonts.add(m[1]);
    o.stream = convertContent(plain, cmyk);
    o.text = set(set(o.text, 'Filter', null), 'DecodeParms', null);
  }

  // Dégradés, images, groupes de transparence.
  const fnRefs = new Set<number>();
  for (const o of objects.values()) {
    if (/\/ShadingType/.test(o.text) && /\/ColorSpace\s*\/DeviceRGB/.test(o.text)) {
      o.text = convertColorArrays(
        o.text.replace(/\/ColorSpace\s*\/DeviceRGB/g, '/ColorSpace /DeviceCMYK'),
        cmyk,
      );
      const fn = /\/Function\s*(\d+\s+\d+\s+R|\[[^\]]*\]|<<[\s\S]*?>>)/.exec(o.text);
      if (fn) for (const r of refsIn(fn[1])) fnRefs.add(r);
    }
    if (get(o.text, 'Subtype')?.trim() === '/Image' && o.stream !== null) {
      const cs = get(o.text, 'ColorSpace')?.trim();
      if (cs === '/DeviceRGB') {
        if (!convertImage(o, cmyk)) warnings.rgbImages++;
      } else if (cs?.startsWith('[') && /\/DeviceRGB/.test(cs)) {
        const conv = convertIndexed(cs, cmyk);
        if (conv) o.text = set(o.text, 'ColorSpace', conv);
        else warnings.rgbImages++;
      }
    }
    o.text = o.text.replace(/\/CS\s*\/DeviceRGB/g, '/CS /DeviceCMYK');
  }
  const seenFn = new Set<number>();
  const visitFn = (num: number) => {
    if (seenFn.has(num)) return;
    seenFn.add(num);
    const o = objects.get(num);
    if (!o) return;
    o.text = convertColorArrays(o.text, cmyk);
    if (get(o.text, 'FunctionType')?.trim() === '0') convertSampledFunction(o, cmyk);
    const fns = get(o.text, 'Functions');
    if (fns) for (const r of refsIn(fns)) visitFn(r);
  };
  fnRefs.forEach(visitFn);

  // Polices inutilisées : jsPDF déclare toujours les 14 polices standard.
  for (const o of objects.values()) {
    const fonts = get(o.text, 'Font');
    if (!fonts || !fonts.startsWith('<<') || !/\/(Resources|ProcSet|XObject|Font)/.test(o.text)) continue;
    const kept = dictEntries(fonts).filter(([k]) => usedFonts.has(k));
    o.text = set(o.text, 'Font', dictText(kept));
    for (const [name, v] of kept) {
      const f = objects.get(refNum(v) ?? -1);
      const base = f && get(f.text, 'BaseFont');
      if (
        f &&
        base &&
        !get(f.text, 'FontDescriptor') &&
        !get(f.text, 'DescendantFonts') &&
        STANDARD_FONTS.test(base)
      )
        warnings.unembeddedFonts.push(base.slice(1) || name);
    }
  }

  // PDF/X-4 : profil de sortie, métadonnées, dates et identifiant.
  const rootNum = refNum(get(trailer, 'Root'));
  let infoNum = refNum(get(trailer, 'Info'));
  let next = Math.max(...objects.keys()) + 1;
  const date = opts.date ?? new Date();
  const title = opts.title ?? 'Poulpe';
  let id = get(trailer, 'ID');
  if (!id) {
    const h = uuid(title + date.toISOString()).replace(/-/g, '');
    id = `[<${h}> <${h}>]`;
  }
  if (opts.pdfx && rootNum !== null) {
    const icc = zlibSync(cmykIccProfile(), { level: 9 });
    const iccNum = next++;
    objects.set(iccNum, {
      num: iccNum,
      text: dictText([
        ['N', '4'],
        ['Alternate', '/DeviceCMYK'],
        ['Filter', '/FlateDecode'],
        ['Length', String(icc.length)],
      ]),
      stream: bytesToLatin1(icc),
    });
    const intentNum = next++;
    objects.set(intentNum, {
      num: intentNum,
      text: dictText([
        ['Type', '/OutputIntent'],
        ['S', '/GTS_PDFX'],
        ['OutputConditionIdentifier', `(${PRINT_CONDITION.identifier})`],
        ['OutputCondition', `(${PRINT_CONDITION.info})`],
        ['RegistryName', `(${PRINT_CONDITION.registry})`],
        ['Info', `(${ICC_DESCRIPTION})`],
        ['DestOutputProfile', `${iccNum} 0 R`],
      ]),
      stream: null,
    });
    const docId = uuid(title + 'doc' + date.getTime());
    const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
 xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
 xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title>
<xmp:CreateDate>${xmpDate(date)}</xmp:CreateDate>
<xmp:ModifyDate>${xmpDate(date)}</xmp:ModifyDate>
<xmp:MetadataDate>${xmpDate(date)}</xmp:MetadataDate>
<xmp:CreatorTool>${xmlEscape(opts.creator ?? 'Poulpe')}</xmp:CreatorTool>
<pdf:Producer>${xmlEscape(opts.creator ?? 'Poulpe')}</pdf:Producer>
<pdf:Trapped>False</pdf:Trapped>
<xmpMM:DocumentID>uuid:${docId}</xmpMM:DocumentID>
<xmpMM:InstanceID>uuid:${uuid(docId)}</xmpMM:InstanceID>
<xmpMM:VersionID>1</xmpMM:VersionID>
<xmpMM:RenditionClass>default</xmpMM:RenditionClass>
<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    // Les métadonnées sont en UTF-8, non compressées.
    const xmpBytes = bytesToLatin1(new TextEncoder().encode(xmp));
    const metaNum = next++;
    objects.set(metaNum, {
      num: metaNum,
      text: dictText([
        ['Type', '/Metadata'],
        ['Subtype', '/XML'],
        ['Length', String(xmpBytes.length)],
      ]),
      stream: xmpBytes,
    });
    const root = objects.get(rootNum)!;
    root.text = set(set(root.text, 'OutputIntents', `[${intentNum} 0 R]`), 'Metadata', `${metaNum} 0 R`);
    if (infoNum === null) {
      // Le compteur avance comme pour les autres objets : un objet ajouté plus loin prendra le suivant.
      // eslint-disable-next-line no-useless-assignment
      infoNum = next++;
      objects.set(infoNum, { num: infoNum, text: '<<>>', stream: null });
    }
    const info = objects.get(infoNum)!;
    let it = info.text.startsWith('<<') ? info.text : '<<>>';
    it = set(it, 'Title', pdfString(title));
    it = set(it, 'Creator', pdfString(opts.creator ?? 'Poulpe'));
    it = set(it, 'Producer', pdfString(opts.creator ?? 'Poulpe'));
    it = set(it, 'CreationDate', `(${pdfDate(date)})`);
    it = set(it, 'ModDate', `(${pdfDate(date)})`);
    it = set(it, 'Trapped', '/False');
    it = set(it, 'GTS_PDFXVersion', '(PDF/X-4)');
    info.text = it;
    // Chaque page indique où couper (TrimBox) ; à défaut, la page entière.
    for (const o of objects.values()) {
      if (get(o.text, 'Type')?.trim() !== '/Page') continue;
      const media = get(o.text, 'MediaBox');
      if (!get(o.text, 'TrimBox') && media) o.text = set(o.text, 'TrimBox', media);
      if (!get(o.text, 'BleedBox')) o.text = set(o.text, 'BleedBox', get(o.text, 'TrimBox') ?? media ?? null);
    }
  }

  // Ne garder que les objets encore utilisés.
  const live = new Set<number>();
  const stack = [rootNum, infoNum].filter((n): n is number => n !== null);
  while (stack.length) {
    const n = stack.pop()!;
    if (live.has(n)) continue;
    const o = objects.get(n);
    if (!o) continue;
    live.add(n);
    stack.push(...refsIn(o.text));
  }

  // Écriture, flux compressés.
  const parts: string[] = [];
  let pos = 0;
  const push = (s: string) => {
    parts.push(s);
    pos += s.length;
  };
  push(`%PDF-${opts.pdfx ? '1.6' : '1.4'}\n%\xE2\xE3\xCF\xD3\n`);
  const offsets = new Map<number, number>();
  const nums = [...live].sort((a, b) => a - b);
  for (const n of nums) {
    const o = objects.get(n)!;
    offsets.set(n, pos);
    let text = o.text;
    let stream = o.stream;
    if (stream !== null) {
      const isMeta = get(text, 'Type')?.trim() === '/Metadata';
      if (!get(text, 'Filter') && !isMeta) {
        const packed = zlibSync(latin1ToBytes(stream), { level: 6 });
        stream = bytesToLatin1(packed);
        text = set(text, 'Filter', '/FlateDecode');
      }
      text = set(text, 'Length', String(stream.length));
      push(`${n} 0 obj\n${text}\nstream\n${stream}\nendstream\nendobj\n`);
    } else push(`${n} 0 obj\n${text}\nendobj\n`);
  }
  const size = Math.max(...nums) + 1;
  const xref = pos;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const off = offsets.get(n);
    table += off === undefined ? '0000000000 00001 f \n' : `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  push(table);
  const tr: [string, string][] = [
    ['Size', String(size)],
    ['Root', `${rootNum} 0 R`],
  ];
  if (infoNum !== null) tr.push(['Info', `${infoNum} 0 R`]);
  tr.push(['ID', id]);
  push(`trailer\n${dictText(tr)}\nstartxref\n${xref}\n%%EOF\n`);
  return { bytes: latin1ToBytes(parts.join('')), warnings };
}
