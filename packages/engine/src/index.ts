import {
  parseColor,
  sampleStops,
  setAdjustmentEngine,
  type AdjustOptions,
  type Adjustment,
  type Pixels,
} from '@poulpe/core';

/*
 * Moteur Rust de Poulpe Design (crates/poulpe-engine), compilé en WebAssembly.
 *
 * Il calcule les réglages d'image et les filtres à la place du code TypeScript, avec exactement
 * le même résultat, plus vite. Il tourne dans la page (navigateur et vue web de l'appli de
 * bureau), sans aller-retour avec le reste de l'appli : le rendu peut donc l'appeler image par
 * image. Tant qu'il n'est pas chargé, ou si un calcul échoue, le code TypeScript prend le relais.
 */

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  apply(px: number, len: number, w: number, h: number, json: number, jsonLen: number): number;
  blur(px: number, len: number, w: number, h: number, sigma: number): number;
  version(): number;
}

let wasm: Exports | null = null;

/** Zone de travail réservée dans la mémoire du moteur, agrandie au besoin. */
const scratch = { ptr: 0, len: 0 };
const text = { ptr: 0, len: 0 };

function reserve(zone: { ptr: number; len: number }, len: number): number {
  if (zone.len < len) {
    if (zone.len) wasm!.dealloc(zone.ptr, zone.len);
    zone.len = Math.max(len, zone.len * 2);
    zone.ptr = wasm!.alloc(zone.len);
  }
  return zone.ptr;
}

/** Temps passé dans le moteur, pour la fenêtre Diagnostic. */
const stats = { calls: 0, ms: 0, fallbacks: 0, pixels: 0 };

export interface EngineStats {
  /** Moteur Rust chargé et utilisé. */
  active: boolean;
  version: string | null;
  calls: number;
  /** Durée moyenne d'un calcul, en millisecondes. */
  meanMs: number;
  /** Calculs refusés par le moteur et faits en TypeScript. */
  fallbacks: number;
  /** Mémoire du moteur, en Mo. */
  memoryMb: number;
}

export function engineStats(): EngineStats {
  const v = wasm?.version();
  return {
    active: !!wasm,
    version: v ? `${Math.floor(v / 10000)}.${Math.floor(v / 100) % 100}.${v % 100}` : null,
    calls: stats.calls,
    meanMs: stats.calls ? stats.ms / stats.calls : 0,
    fallbacks: stats.fallbacks,
    memoryMb: wasm ? wasm.memory.buffer.byteLength / 1048576 : 0,
  };
}

/** Le réglage tel que le moteur le comprend : les couleurs du document sont converties en nombres. */
export function engineAdjustment(adj: Adjustment): Record<string, unknown> {
  switch (adj.kind) {
    case 'photoFilter': {
      const c = parseColor(adj.color);
      return { kind: adj.kind, rgb: [c.r, c.g, c.b], density: adj.density };
    }
    case 'gradientMap': {
      const gradient: number[] = new Array(768);
      for (let i = 0; i < 256; i++) {
        const col = parseColor(sampleStops(adj.stops, i / 255));
        gradient[i * 3] = col.r;
        gradient[i * 3 + 1] = col.g;
        gradient[i * 3 + 2] = col.b;
      }
      return { kind: adj.kind, gradient };
    }
    default:
      return adj as unknown as Record<string, unknown>;
  }
}

/** Le moteur a planté (mémoire épuisée) : on le débranche, le TypeScript prend le relais. */
function crash(e: unknown): false {
  console.warn('Moteur Rust débranché :', e);
  stopEngine();
  return false;
}

function run(px: Pixels, call: (ptr: number, len: number) => number): boolean {
  if (!wasm) return false;
  const t0 = performance.now();
  try {
    const len = px.data.length;
    const ptr = reserve(scratch, len);
    new Uint8Array(wasm.memory.buffer, ptr, len).set(px.data);
    const status = call(ptr, len);
    if (status !== 0) {
      stats.fallbacks++;
      return false;
    }
    px.data.set(new Uint8Array(wasm.memory.buffer, ptr, len));
  } catch (e) {
    return crash(e);
  }
  stats.calls++;
  stats.pixels += px.width * px.height;
  stats.ms += performance.now() - t0;
  return true;
}

const encoder = new TextEncoder();

/*
 * Réglages confiés au moteur WebAssembly : ceux où il est nettement plus rapide (mesuré sur une
 * photo de 12 Mpx : flous 3 fois plus rapides, teinte et seuil 2 fois). Pour les réglages
 * simples (une table par canal), le moteur JavaScript du navigateur est déjà aussi rapide, et
 * la copie des pixels vers le moteur coûterait plus qu'elle ne rapporte.
 */
const WASM_KINDS = new Set<Adjustment['kind']>([
  'gaussianBlur',
  'unsharpMask',
  'clarity',
  'hsl',
  'threshold',
]);

/** Le moteur WebAssembly prend-il ce réglage en charge ? */
export function engineHandles(kind: Adjustment['kind']): boolean {
  return WASM_KINDS.has(kind);
}

/** Applique un réglage avec le moteur Rust. Faux si le moteur n'est pas là (rien n'est modifié). */
export function engineApply(px: Pixels, adj: Adjustment, opts: AdjustOptions = {}): boolean {
  if (!wasm || !WASM_KINDS.has(adj.kind)) return false;
  return engineApplyAny(px, adj, opts);
}

/** Comme `engineApply`, pour n'importe quel réglage (tests, comparaisons). */
export function engineApplyAny(px: Pixels, adj: Adjustment, opts: AdjustOptions = {}): boolean {
  if (!wasm) return false;
  const options = {
    scale: opts.scale ?? 1,
    origin: opts.origin ? [opts.origin.x, opts.origin.y] : [0, 0],
    frame: opts.frame ? [opts.frame.x, opts.frame.y, opts.frame.width, opts.frame.height] : null,
  };
  const json = encoder.encode(JSON.stringify({ adjustment: engineAdjustment(adj), options }));
  return run(px, (ptr, len) => {
    const j = reserve(text, json.length);
    new Uint8Array(wasm!.memory.buffer, j, json.length).set(json);
    return wasm!.apply(ptr, len, px.width, px.height, j, json.length);
  });
}

/** Flou gaussien (sur place) avec le moteur Rust. */
export function engineBlur(px: Pixels, sigma: number): boolean {
  return run(px, (ptr, len) => wasm!.blur(ptr, len, px.width, px.height, sigma));
}

/**
 * Charge le moteur (le fichier `wasm/poulpe_engine.wasm`) et le branche sur les réglages
 * d'image. Renvoie faux si le navigateur ne peut pas le charger : le TypeScript reste utilisé.
 */
export async function startEngine(source: BufferSource | Response | Promise<Response>): Promise<boolean> {
  try {
    const res = await source;
    const bytes = res instanceof Response ? await res.arrayBuffer() : res;
    const { instance } = await WebAssembly.instantiate(bytes, {});
    wasm = instance.exports as unknown as Exports;
    scratch.len = text.len = 0;
    setAdjustmentEngine({ apply: engineApply, blur: engineBlur });
    return true;
  } catch (e) {
    console.warn('Moteur Rust indisponible, calcul en TypeScript :', e);
    stopEngine();
    return false;
  }
}

/** Débranche le moteur : les réglages sont de nouveau calculés en TypeScript. */
export function stopEngine(): void {
  wasm = null;
  setAdjustmentEngine(null);
}

export function engineActive(): boolean {
  return !!wasm;
}
