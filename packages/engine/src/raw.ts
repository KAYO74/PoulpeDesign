/*
 * Développement des photos RAW (crates/poulpe-raw-wasm, compilé en WebAssembly) : le fichier est
 * lu et dématricé une fois, puis développé autant de fois que les réglages changent, en aperçu
 * réduit ou en taille réelle. Chaque photo a son propre module, libéré avec `dispose`.
 */

/** Réglages du développement : de -100 à 100, l'exposition en IL (de -5 à 5). */
export interface DevelopSettings {
  exposure: number;
  temperature: number;
  tint: number;
  contrast: number;
  highlights: number;
  shadows: number;
  vibrance: number;
  saturation: number;
}

export const DEFAULT_DEVELOP: DevelopSettings = {
  exposure: 0,
  temperature: 0,
  tint: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  vibrance: 0,
  saturation: 0,
};

/** Extensions des fichiers RAW lus (celles que rawloader reconnaît). */
export const RAW_EXTENSIONS = [
  'dng',
  'cr2',
  'crw',
  'nef',
  'nrw',
  'arw',
  'srf',
  'sr2',
  'orf',
  'rw2',
  'raf',
  'pef',
  'srw',
  '3fr',
  'erf',
  'kdc',
  'dcr',
  'mrw',
  'mef',
  'mos',
  'iiq',
  'ari',
];

interface RawExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  decode(ptr: number, len: number): number;
  width(): number;
  height(): number;
  render(json: number, len: number, maxSide: number): number;
  out_width(): number;
  out_height(): number;
  clear(): void;
}

const encoder = new TextEncoder();

export class RawPhoto {
  private constructor(
    private wasm: RawExports | null,
    readonly width: number,
    readonly height: number,
  ) {}

  /** Lit un fichier RAW. Null si son format n'est pas reconnu. */
  static async open(
    module: BufferSource | Response | Promise<Response>,
    bytes: Uint8Array,
  ): Promise<RawPhoto | null> {
    const res = await module;
    const code = res instanceof Response ? await res.arrayBuffer() : res;
    const { instance } = await WebAssembly.instantiate(code, {});
    const wasm = instance.exports as unknown as RawExports;
    const ptr = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    const status = wasm.decode(ptr, bytes.length);
    wasm.dealloc(ptr, bytes.length);
    if (status !== 0 || !wasm.width()) return null;
    return new RawPhoto(wasm, wasm.width(), wasm.height());
  }

  /** Photo développée, réduite pour tenir dans `maxSide` pixels (0 : taille réelle). */
  render(settings: DevelopSettings, maxSide = 0): ImageData {
    const wasm = this.wasm;
    if (!wasm) throw new Error('Photo RAW fermée');
    const json = encoder.encode(JSON.stringify(settings));
    const j = wasm.alloc(json.length);
    new Uint8Array(wasm.memory.buffer, j, json.length).set(json);
    const ptr = wasm.render(j, json.length, maxSide);
    wasm.dealloc(j, json.length);
    if (!ptr) throw new Error('Développement impossible');
    const w = wasm.out_width(),
      h = wasm.out_height();
    // Copie : la mémoire du module peut grandir (et se déplacer) au calcul suivant.
    const data = new Uint8ClampedArray(wasm.memory.buffer.slice(ptr, ptr + w * h * 4));
    return new ImageData(data, w, h);
  }

  dispose(): void {
    this.wasm?.clear();
    this.wasm = null;
  }
}
