import type { FusionOptions, Pixels } from '@poulpe/core';

/*
 * Fusion d'images avec le moteur Rust, pour le Web Worker de la fusion : ce fichier n'importe rien
 * d'autre. Même calcul que `fuseImages` de @poulpe/core, en deux passes (poids, puis mélange) pour
 * suivre l'avancement et pouvoir annuler.
 */

interface FusionExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  fusion_begin?(w: number, h: number, focus: number, wc: number, ws: number, we: number): number;
  fusion_weight(px: number, len: number): number;
  fusion_normalize(): number;
  fusion_blend(k: number, px: number, len: number): number;
  fusion_finish(out: number, len: number): number;
  fusion_reset(): void;
}

let mod: FusionExports | null = null;

/** Charge le moteur pour la fusion. Faux s'il est absent ou trop ancien. */
export async function startFusionEngine(
  source: BufferSource | Response | Promise<Response>,
): Promise<boolean> {
  try {
    const res = await source;
    const bytes = res instanceof Response ? await res.arrayBuffer() : res;
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const ex = instance.exports as unknown as FusionExports;
    mod = ex.fusion_begin ? ex : null;
  } catch (e) {
    console.warn('Moteur Rust indisponible pour la fusion :', e);
    mod = null;
  }
  return !!mod;
}

/**
 * Fusionne des images de même taille. Renvoie null si `progress` demande d'annuler, et undefined si
 * le moteur n'est pas là ou échoue : il faut alors le faire en TypeScript.
 */
export function engineFuse(images: Pixels[], opts: FusionOptions): Pixels | null | undefined {
  const m = mod;
  if (!m || !images.length) return undefined;
  const { width: w, height: h } = images[0];
  if (images.some((im) => im.width !== w || im.height !== h)) return undefined;
  const len = w * h * 4;
  const total = images.length * 2 + 1;
  let step = 0;
  const tick = (): boolean => !(opts.progress?.(++step / total) === true);
  let buf = 0,
    out = 0;
  try {
    // Une zone pour les pixels d'entrée, une pour ceux de sortie (réservées avant les calculs).
    buf = m.alloc(len);
    out = m.alloc(len);
    const load = (im: Pixels) => new Uint8Array(m.memory.buffer, buf, len).set(im.data);
    const ok = (status: number) => {
      if (status !== 0) throw new Error(`fusion Rust : code ${status}`);
    };
    ok(
      m.fusion_begin!(
        w,
        h,
        opts.mode === 'focus' ? 1 : 0,
        opts.contrast ?? 1,
        opts.saturation ?? 1,
        opts.exposure ?? 1,
      ),
    );
    for (const im of images) {
      load(im);
      ok(m.fusion_weight(buf, len));
      if (!tick()) {
        m.fusion_reset();
        return null;
      }
    }
    ok(m.fusion_normalize());
    for (let k = 0; k < images.length; k++) {
      load(images[k]);
      ok(m.fusion_blend(k, buf, len));
      if (!tick()) {
        m.fusion_reset();
        return null;
      }
    }
    ok(m.fusion_finish(out, len));
    const data = new Uint8ClampedArray(m.memory.buffer.slice(out, out + len));
    tick();
    return { data, width: w, height: h };
  } catch (e) {
    console.warn('Moteur Rust débranché (fusion) :', e);
    m.fusion_reset();
    mod = null;
    return undefined;
  } finally {
    if (mod && buf) m.dealloc(buf, len);
    if (mod && out) m.dealloc(out, len);
  }
}
