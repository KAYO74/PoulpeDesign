/*
 * Remplissage d'après le contenu (gomme magique) avec le moteur Rust, pour le Web Worker de la
 * gomme magique : ce fichier n'importe rien d'autre (le reste de @poulpe/core n'a rien à faire
 * dans le worker). Même calcul que `inpaint` de @poulpe/core, avec le même tirage aléatoire.
 */

interface InpaintExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  inpaint?(px: number, hole: number, len: number, w: number, h: number, patch: number, seed: number): number;
}

let mod: InpaintExports | null = null;

/** Charge le moteur pour la gomme magique. Faux s'il est absent ou trop ancien. */
export async function startInpaintEngine(
  source: BufferSource | Response | Promise<Response>,
): Promise<boolean> {
  try {
    const res = await source;
    const bytes = res instanceof Response ? await res.arrayBuffer() : res;
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const ex = instance.exports as unknown as InpaintExports;
    mod = ex.inpaint ? ex : null;
  } catch (e) {
    console.warn('Moteur Rust indisponible pour la gomme magique :', e);
    mod = null;
  }
  return !!mod;
}

export function inpaintEngineActive(): boolean {
  return !!mod;
}

/**
 * Reconstruit le trou sur place avec le moteur Rust. Faux si le moteur n'est pas là ou si le
 * calcul a échoué (rien n'est modifié) : il faut alors le faire en TypeScript.
 */
export function engineInpaint(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  hole: Uint8Array,
  opts: { patch?: number; seed?: number } = {},
): boolean {
  if (!mod?.inpaint || data.length !== width * height * 4 || hole.length !== width * height) return false;
  const len = data.length;
  let px = 0,
    m = 0;
  try {
    px = mod.alloc(len);
    m = mod.alloc(hole.length);
    new Uint8Array(mod.memory.buffer, px, len).set(data);
    new Uint8Array(mod.memory.buffer, m, hole.length).set(hole);
    const status = mod.inpaint(px, m, len, width, height, opts.patch ?? 7, (opts.seed ?? 1234567) >>> 0);
    if (status !== 0) return false;
    data.set(new Uint8Array(mod.memory.buffer, px, len));
    return true;
  } catch (e) {
    console.warn('Moteur Rust débranché (gomme magique) :', e);
    mod = null;
    return false;
  } finally {
    if (mod) {
      if (px) mod.dealloc(px, len);
      if (m) mod.dealloc(m, hole.length);
    }
  }
}
