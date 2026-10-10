import type { AdjustOptions, Adjustment, Pixels } from '@poulpe/core';
import { engineAdjustment, engineStats, startEngine, type EngineStats } from '@poulpe/engine';
import wasmUrl from '@poulpe/engine/wasm/poulpe_engine.wasm?url';
import { isDesktop } from './io';

/*
 * Moteur Rust de Poulpe Design (crates/poulpe-engine), branché sur l'éditeur de deux façons :
 *
 * - compilé en WebAssembly, dans la page (navigateur et appli de bureau) : le rendu du canevas
 *   l'appelle directement pour les filtres lourds (flous, netteté, teinte) ;
 * - natif, dans l'appli de bureau : appliquer un filtre à une grande image se fait sur la carte
 *   graphique (wgpu) ou sur tous les cœurs du processeur, hors de l'interface, qui ne se fige pas.
 */

let started: Promise<boolean> | null = null;

/** Charge le moteur WebAssembly, sans retarder l'affichage de l'appli. */
export function startRustEngine(): Promise<boolean> {
  started ??= new Promise<boolean>((resolve) => {
    const go = () => void startEngine(fetch(wasmUrl)).then(resolve);
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 200);
  });
  return started;
}

/* ——— Moteur natif (appli de bureau) ——— */

export type GpuDevice = 'auto' | 'discrete' | 'integrated' | 'cpu';
export type GpuBackend = 'auto' | 'vulkan' | 'metal' | 'dx12' | 'gl';

export interface AdapterSummary {
  name: string;
  kind: 'discrete' | 'integrated' | 'cpu' | 'virtual' | 'other';
  backend: string;
  driver: string;
}

export interface NativeEngineInfo {
  adapters: AdapterSummary[];
  active: AdapterSummary | null;
  settings: { device: GpuDevice; backend: GpuBackend; vramMb: number };
  cores: number;
  timings: Record<string, { count: number; meanMs: number; maxMs: number; lastMs: number }>;
}

async function invoke<T>(cmd: string, args?: unknown, headers?: Record<string, string>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args as Record<string, unknown>, headers ? { headers } : undefined);
}

/** Moteur natif présent ? (appli de bureau 1.1.1 ou plus récente) */
let native: boolean | null = null;

/** État du moteur natif (cartes graphiques trouvées, carte utilisée, durées), ou null. */
export async function nativeEngineInfo(): Promise<NativeEngineInfo | null> {
  if (!isDesktop() || native === false) return null;
  try {
    const info = await invoke<NativeEngineInfo>('engine_info');
    native = true;
    return info;
  } catch {
    native = false;
    return null;
  }
}

/** Change la carte graphique, l'interface graphique et la mémoire vidéo du moteur natif. */
export async function configureNativeEngine(settings: {
  device: GpuDevice;
  backend: GpuBackend;
  vramMb: number;
}) {
  if (!isDesktop() || native === false) return;
  try {
    await invoke('engine_configure', { settings });
  } catch {
    native = false;
  }
}

/** En dessous, l'aller-retour vers le moteur natif coûte plus que le calcul dans la page. */
const NATIVE_MIN_PIXELS = 1 << 20;

/**
 * Applique un réglage avec le moteur natif, hors de l'interface. Faux si ce n'est pas possible
 * (navigateur, petite image, ancienne appli) : il faut alors calculer dans la page.
 */
export async function nativeApply(px: Pixels, adj: Adjustment, opts: AdjustOptions = {}): Promise<boolean> {
  if (!isDesktop() || native === false || px.width * px.height < NATIVE_MIN_PIXELS) return false;
  const request = {
    adjustment: engineAdjustment(adj),
    options: {
      scale: opts.scale ?? 1,
      origin: opts.origin ? [opts.origin.x, opts.origin.y] : [0, 0],
      frame: opts.frame ? [opts.frame.x, opts.frame.y, opts.frame.width, opts.frame.height] : null,
    },
  };
  // Corps : longueur du réglage (4 octets), le réglage en JSON, puis les pixels.
  const json = new TextEncoder().encode(JSON.stringify(request));
  const body = new Uint8Array(4 + json.length + px.data.length);
  new DataView(body.buffer).setUint32(0, json.length, true);
  body.set(json, 4);
  body.set(px.data, 4 + json.length);
  try {
    const out = await invoke<ArrayBuffer>('engine_apply', body, {
      'x-width': String(px.width),
      'x-height': String(px.height),
    });
    if (out.byteLength !== px.data.length) return false;
    px.data.set(new Uint8Array(out));
    native = true;
    return true;
  } catch (e) {
    console.warn('Moteur natif indisponible :', e);
    native = false;
    return false;
  }
}

export interface RustEngineStatus {
  wasm: EngineStats;
  native: NativeEngineInfo | null;
}

/** Pour la fenêtre Diagnostic. */
export async function rustEngineStatus(): Promise<RustEngineStatus> {
  return { wasm: engineStats(), native: await nativeEngineInfo() };
}
