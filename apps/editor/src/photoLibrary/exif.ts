/*
 * Lecture des infos de prise de vue (EXIF) d'une photo JPEG ou RAW (TIFF, DNG, CR2, NEF, ARW…),
 * pour la Bibliothèque photo. Seules les valeurs affichées sont lues.
 */

export interface Exif {
  make?: string;
  model?: string;
  lens?: string;
  /** Durée d'exposition en secondes. */
  exposure?: number;
  fNumber?: number;
  iso?: number;
  /** Focale en millimètres. */
  focal?: number;
  /** Date de prise de vue (ms depuis 1970, heure locale de l'appareil). */
  taken?: number;
  orientation?: number;
}

const TAGS = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  dateTime: 0x0132,
  exifIfd: 0x8769,
  exposure: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  dateOriginal: 0x9003,
  focal: 0x920a,
  lens: 0xa434,
};

/** Lit les infos EXIF ; objet vide si le fichier n'en a pas. */
export function readExif(bytes: Uint8Array): Exif {
  try {
    const tiff = findTiff(bytes);
    return tiff ? parseTiff(new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)) : {};
  } catch {
    return {};
  }
}

/** Début de l'en-tête TIFF : le fichier lui-même (RAW) ou le segment APP1 d'un JPEG. */
function findTiff(b: Uint8Array): Uint8Array | null {
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return b;
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    // « Exif\0\0 » puis l'en-tête TIFF.
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66)
      return b.subarray(i + 10, i + 2 + len);
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return null;
}

function parseTiff(v: DataView): Exif {
  const le = v.getUint16(0) === 0x4949;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const out: Exif = {};
  const raw: Record<number, number | string> = {};

  const readIfd = (offset: number) => {
    if (offset <= 0 || offset + 2 > v.byteLength) return;
    const n = u16(offset);
    for (let k = 0; k < n; k++) {
      const e = offset + 2 + k * 12;
      if (e + 12 > v.byteLength) return;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 1;
      const at = size * count > 4 ? u32(e + 8) : e + 8;
      if (at + size * count > v.byteLength) continue;
      if (type === 2) {
        let s = '';
        for (let c = 0; c < count; c++) {
          const ch = v.getUint8(at + c);
          if (!ch) break;
          s += String.fromCharCode(ch);
        }
        raw[tag] = s.trim();
      } else if (type === 3) raw[tag] = u16(at);
      else if (type === 4) raw[tag] = u32(at);
      else if (type === 5 || type === 10) {
        const den = u32(at + 4);
        raw[tag] = den ? (type === 10 ? v.getInt32(at, le) / v.getInt32(at + 4, le) : u32(at) / den) : 0;
      }
    }
  };

  readIfd(u32(4));
  if (typeof raw[TAGS.exifIfd] === 'number') readIfd(raw[TAGS.exifIfd] as number);

  const str = (tag: number) => (typeof raw[tag] === 'string' && raw[tag] ? (raw[tag] as string) : undefined);
  const num = (tag: number) => (typeof raw[tag] === 'number' && raw[tag] ? (raw[tag] as number) : undefined);
  out.make = str(TAGS.make);
  out.model = str(TAGS.model);
  out.lens = str(TAGS.lens);
  out.exposure = num(TAGS.exposure);
  out.fNumber = num(TAGS.fNumber);
  out.iso = num(TAGS.iso);
  out.focal = num(TAGS.focal);
  out.orientation = num(TAGS.orientation);
  out.taken = parseDate(str(TAGS.dateOriginal) ?? str(TAGS.dateTime));
  for (const k of Object.keys(out) as (keyof Exif)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** « 2026:10:26 19:15:00 » → date locale. */
function parseDate(s?: string): number | undefined {
  const m = s?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number.isFinite(d) ? d : undefined;
}

/** « 1/250 s », « 2 s ». */
export function formatExposure(s: number): string {
  if (s >= 1) return `${Math.round(s * 10) / 10} s`;
  return `1/${Math.round(1 / s)} s`;
}
