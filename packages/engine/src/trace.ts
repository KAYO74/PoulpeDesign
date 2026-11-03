/*
 * Vectorisation avec le moteur Rust, pour le Web Worker de la vectorisation : ce fichier n'importe
 * rien d'autre. Étiquette chaque pixel avec la couleur la plus proche de la palette, exactement
 * comme la fin de `quantize` de @poulpe/core.
 */

interface TraceExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  label?(
    px: number,
    len: number,
    centers: number,
    nCenters: number,
    dim: number,
    ignoreWhite: number,
    labels: number,
    sums: number,
  ): number;
}

let mod: TraceExports | null = null;

/** Charge le moteur pour la vectorisation. Faux s'il est absent ou trop ancien. */
export async function startTraceEngine(
  source: BufferSource | Response | Promise<Response>,
): Promise<boolean> {
  try {
    const res = await source;
    const bytes = res instanceof Response ? await res.arrayBuffer() : res;
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const ex = instance.exports as unknown as TraceExports;
    mod = ex.label ? ex : null;
  } catch (e) {
    console.warn('Moteur Rust indisponible pour la vectorisation :', e);
    mod = null;
  }
  return !!mod;
}

/**
 * Étiquettes (−1 : ignoré) et totaux des groupes (nombre, Σr, Σg, Σb par centre), ou null si le
 * moteur n'est pas là : il faut alors le faire en TypeScript.
 */
export function engineLabel(
  data: Uint8ClampedArray,
  centers: ArrayLike<number>,
  dim: number,
  ignoreWhite: boolean,
): { labels: Int32Array; sums: Float64Array } | null {
  if (!mod?.label) return null;
  const n = data.length / 4;
  const k = centers.length / dim;
  // Une seule zone, découpée en parties alignées sur 8 octets.
  const align = (v: number) => (v + 7) & ~7;
  const oCenters = 0,
    oSums = align(centers.length * 8),
    oLabels = oSums + align(k * 32),
    oPx = oLabels + align(n * 4),
    total = oPx + data.length + 8;
  let base = 0;
  try {
    base = mod.alloc(total);
    const p = align(base);
    const mem = mod.memory.buffer;
    new Float64Array(mem, p + oCenters, centers.length).set(centers);
    new Uint8Array(mem, p + oPx, data.length).set(data);
    const status = mod.label(
      p + oPx,
      data.length,
      p + oCenters,
      centers.length,
      dim,
      ignoreWhite ? 1 : 0,
      p + oLabels,
      p + oSums,
    );
    if (status !== 0) return null;
    return {
      labels: new Int32Array(mod.memory.buffer.slice(p + oLabels, p + oLabels + n * 4)),
      sums: new Float64Array(mod.memory.buffer.slice(p + oSums, p + oSums + k * 32)),
    };
  } catch (e) {
    console.warn('Moteur Rust débranché (vectorisation) :', e);
    mod = null;
    return null;
  } finally {
    if (mod && base) mod.dealloc(base, total);
  }
}
