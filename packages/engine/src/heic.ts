/*
 * Photos HEIC / HEIF (celles des iPhone et de nombreux appareils), lues par crates/poulpe-heic-wasm
 * (décodeur Rust « heifer », compilé en WebAssembly et chargé seulement pour un fichier HEIC).
 */

/** Extensions des fichiers HEIC lus. */
export const HEIC_EXTENSIONS = ['heic', 'heif'];

/** Marques « ftyp » des fichiers HEIC / HEIF (pas AVIF, que le navigateur lit lui-même). */
const BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** Les octets forment-ils un fichier HEIC / HEIF (reconnu à sa marque, pas à son nom) ? */
export function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(4) !== 'ftyp') return false;
  const end = Math.min(bytes.length, 4 + 4 + 4 + 4 * 16);
  if (BRANDS.has(tag(8))) return true;
  for (let at = 16; at + 4 <= end; at += 4) if (BRANDS.has(tag(at))) return true;
  return false;
}

/** Pourquoi un fichier HEIC n'a pas été lu. */
export type HeicFailure = 'unreadable' | 'tooBig' | 'unsupported';

const FAILURES: Record<number, HeicFailure> = { 1: 'unreadable', 2: 'tooBig', 3: 'unsupported' };

export class HeicError extends Error {
  constructor(readonly reason: HeicFailure) {
    super(`HEIC illisible : ${reason}`);
  }
}

interface HeicExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  decode(ptr: number, len: number): number;
  width(): number;
  height(): number;
  pixels(): number;
  clear(): void;
}

/** Pixels RGBA 8 bits d'une photo HEIC (compatible `ImageData`). */
export interface HeicImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** Décode une photo HEIC en pixels RGBA 8 bits (sRGB). Lève une `HeicError` si elle n'est pas lisible. */
export async function decodeHeic(
  module: BufferSource | Response | Promise<Response>,
  bytes: Uint8Array,
): Promise<HeicImage> {
  const res = await module;
  const code = res instanceof Response ? await res.arrayBuffer() : res;
  const { instance } = await WebAssembly.instantiate(code, {});
  const wasm = instance.exports as unknown as HeicExports;
  const ptr = wasm.alloc(bytes.length);
  try {
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    const status = wasm.decode(ptr, bytes.length);
    wasm.dealloc(ptr, bytes.length);
    if (status !== 0) throw new HeicError(FAILURES[status] ?? 'unreadable');
    const w = wasm.width(),
      h = wasm.height();
    if (!w || !h) throw new HeicError('unreadable');
    const out = wasm.pixels();
    // Copie : le module est libéré juste après.
    return {
      data: new Uint8ClampedArray(wasm.memory.buffer.slice(out, out + w * h * 4)),
      width: w,
      height: h,
    };
  } finally {
    wasm.clear();
  }
}
