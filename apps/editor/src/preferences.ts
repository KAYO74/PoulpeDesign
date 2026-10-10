import { useSyncExternalStore } from 'react';
import { clearLayoutCache } from '@poulpe/render';
import { configureNativeEngine, type GpuBackend, type GpuDevice } from './engine';
import { isDesktop } from './io';
import { setPerformanceSettings } from './perf';
import { t } from './i18n';
import { editor, toast } from './store';

/*
 * Préférences de performance (Préférences > Performances), enregistrées sur l'ordinateur.
 *
 * Une appli web, même installée, ne peut pas réserver de mémoire ni choisir sa carte graphique
 * comme Photoshop. Ce qui est réellement appliqué :
 * - le budget mémoire : quand la mémoire utilisée le dépasse, les plus vieilles annulations et
 *   les caches sont libérés (mesure réelle sous Windows et dans Chrome ou Edge) ;
 * - la limite de l'historique, la taille du cache et la qualité d'aperçu (moteur de rendu) ;
 * - l'accélération matérielle et la carte graphique préférée : transmises au moteur web de l'appli
 *   de bureau au lancement suivant (Windows et Linux ; macOS choisit lui-même) ;
 * - les threads : nombre de cœurs utilisés par le détourage automatique ;
 * - la sauvegarde automatique des brouillons.
 * Les autres modules lisent ces valeurs avec `getPerf` et suivent leurs changements avec `subscribePerf`.
 */

/** Pendant un zoom ou un défilement : image étirée (`fast`, `balanced`) ou redessinée nette (`full`). */
export type PreviewQuality = 'fast' | 'balanced' | 'full';
/** Carte graphique : automatique, dédiée, intégrée, ou aucune (tout sur le processeur). */
export type GpuPreference = 'default' | 'high-performance' | 'low-power' | 'cpu';
export type { GpuBackend };

export interface PerfPrefs {
  /** Budget mémoire en Mo pour les caches et l'historique ; 0 : automatique (moitié de la RAM). */
  memoryBudgetMb: number;
  /** Taille du cache de rendu en Mo. */
  cacheMb: number;
  /** Nombre d'étapes d'annulation gardées ; 0 : illimité. */
  historyLimit: number;
  previewQuality: PreviewQuality;
  /** Accélération matérielle : vraie sauf si « processeur seulement » est choisi (`gpuPreference`). */
  hardwareAcceleration: boolean;
  /** Appli de bureau : carte graphique préférée (moteur Rust tout de suite, moteur web au redémarrage). */
  gpuPreference: GpuPreference;
  /** Appli de bureau : interface graphique (Vulkan, Metal, DirectX 12, OpenGL). */
  gpuBackend: GpuBackend;
  /** Appli de bureau : mémoire vidéo que le moteur Rust s'autorise, en Mo. */
  vramMb: number;
  /** Threads de calcul pour les traitements lourds ; 0 : automatique. */
  threads: number;
  /** Copie automatique du document non enregistré (brouillon), et délai après une modification. */
  autosave: boolean;
  autosaveDelaySec: number;
}

export const DEFAULT_PERF: PerfPrefs = {
  memoryBudgetMb: 0,
  cacheMb: 256,
  historyLimit: 500,
  previewQuality: 'balanced',
  hardwareAcceleration: true,
  gpuPreference: 'default',
  gpuBackend: 'auto',
  vramMb: 1024,
  threads: 0,
  autosave: true,
  autosaveDelaySec: 1.5,
};

/** Bornes des réglages, partagées par la fenêtre et la lecture des fichiers importés. */
export const PERF_LIMITS = {
  memoryBudgetMb: [0, 65536],
  cacheMb: [0, 8192],
  historyLimit: [0, 2000],
  threads: [0, 64],
  vramMb: [256, 16384],
  autosaveDelaySec: [0.5, 600],
} as const;

const KEY = 'poulpe.perf';

function sanitize(raw: unknown): PerfPrefs {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: PerfPrefs = { ...DEFAULT_PERF };
  for (const [k, [min, max]] of Object.entries(PERF_LIMITS) as [
    keyof typeof PERF_LIMITS,
    readonly number[],
  ][]) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(max, Math.max(min, v));
  }
  if (src.previewQuality === 'fast' || src.previewQuality === 'balanced' || src.previewQuality === 'full')
    out.previewQuality = src.previewQuality;
  if (['default', 'high-performance', 'low-power', 'cpu'].includes(src.gpuPreference as string))
    out.gpuPreference = src.gpuPreference as GpuPreference;
  // Avant la 1.1.1, l'accélération se coupait par une case à part : c'est maintenant « processeur ».
  if (src.hardwareAcceleration === false && !('gpuBackend' in src)) out.gpuPreference = 'cpu';
  if (['auto', 'vulkan', 'metal', 'dx12', 'gl'].includes(src.gpuBackend as string))
    out.gpuBackend = src.gpuBackend as GpuBackend;
  out.hardwareAcceleration = out.gpuPreference !== 'cpu';
  if (typeof src.autosave === 'boolean') out.autosave = src.autosave;
  return out;
}

function load(): PerfPrefs {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_PERF };
  }
}

let perf = load();
const listeners = new Set<() => void>();

export function getPerf(): PerfPrefs {
  return perf;
}

export function subscribePerf(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function usePerf(): PerfPrefs {
  return useSyncExternalStore(subscribePerf, getPerf);
}

export function setPerf(patch: Partial<PerfPrefs>): void {
  perf = sanitize({ ...perf, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(perf));
  } catch {
    /* stockage indisponible */
  }
  applyPerf();
  listeners.forEach((l) => l());
}

export function resetPerf(): void {
  setPerf(DEFAULT_PERF);
}

/* ——— Mémoire ——— */

interface SystemMemory {
  totalMb: number | null;
  availableMb: number | null;
}

let systemMemory: SystemMemory | null = null;

/** RAM de l'ordinateur : lue par l'appli de bureau, sinon estimée par le navigateur (Chrome, Edge). */
export async function readSystemMemory(): Promise<SystemMemory> {
  if (isDesktop()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const m = await invoke<{ total_mb: number | null; available_mb: number | null }>('system_memory');
      systemMemory = { totalMb: m.total_mb, availableMb: m.available_mb };
      return systemMemory;
    } catch {
      /* ancienne appli de bureau ou commande indisponible */
    }
  }
  const gb = (navigator as { deviceMemory?: number }).deviceMemory;
  systemMemory = { totalMb: gb ? gb * 1024 : null, availableMb: null };
  return systemMemory;
}

/** Mémoire JavaScript utilisée par l'appli, en Mo (Windows, Chrome et Edge seulement). */
export function usedMemoryMb(): number | null {
  const m = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize / 1048576 : null;
}

/** Budget effectif en Mo : le réglage, ou la moitié de la RAM, ou 4 Go si elle est inconnue. */
export function memoryBudgetMb(p: PerfPrefs = perf): number {
  if (p.memoryBudgetMb > 0) return p.memoryBudgetMb;
  const total = systemMemory?.totalMb;
  return total ? Math.max(1024, Math.round(total / 2)) : 4096;
}

const pressureListeners = new Set<() => void>();

/** Prévient quand la mémoire dépasse le budget : chaque cache doit alors libérer ce qu'il peut. */
export function onMemoryPressure(fn: () => void): () => void {
  pressureListeners.add(fn);
  return () => pressureListeners.delete(fn);
}

let lastWarning = 0;

/** Vérifie la mémoire utilisée et libère historique et caches au-delà du budget. */
export function checkMemory(): void {
  const used = usedMemoryMb();
  if (used === null || used < memoryBudgetMb() * 0.9) return;
  const steps = editor.getState().historyIndex;
  editor.dropOldHistory(Math.floor(steps / 2));
  clearLayoutCache();
  pressureListeners.forEach((l) => l());
  if (Date.now() - lastWarning > 60_000) {
    lastWarning = Date.now();
    toast(t('prefs.memoryFreed'));
  }
}

/* ——— Application des réglages ——— */

let launchSent = '';

const DEVICE: Record<GpuPreference, GpuDevice> = {
  default: 'auto',
  'high-performance': 'discrete',
  'low-power': 'integrated',
  cpu: 'cpu',
};

/** Réglages du moteur Rust natif (carte graphique, interface graphique, mémoire vidéo). */
export function engineSettings(p: PerfPrefs = perf) {
  return { device: DEVICE[p.gpuPreference], backend: p.gpuBackend, vramMb: p.vramMb };
}

/** Réglages lus par l'appli de bureau avant d'ouvrir sa fenêtre (accélération, carte graphique). */
async function sendLaunchPrefs(): Promise<void> {
  if (!isDesktop()) return;
  const body = JSON.stringify({
    hardware_acceleration: perf.hardwareAcceleration,
    gpu_preference: perf.gpuPreference === 'cpu' ? 'default' : perf.gpuPreference,
    gpu_backend: perf.gpuBackend,
    gpu_device: DEVICE[perf.gpuPreference],
    vram_mb: perf.vramMb,
  });
  if (body === launchSent) return;
  launchSent = body;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_launch_prefs', { prefs: body });
  } catch {
    launchSent = '';
  }
}

/** Réglages de lancement en vigueur depuis l'ouverture de l'appli : un redémarrage est-il nécessaire ? */
let launchAtStart: Pick<PerfPrefs, 'gpuPreference' | 'gpuBackend'> | null = null;

/** Le moteur web ne change de carte graphique qu'au lancement (le moteur Rust, lui, tout de suite). */
export function needsRestart(p: PerfPrefs = perf): boolean {
  return (
    isDesktop() &&
    launchAtStart !== null &&
    (launchAtStart.gpuPreference !== p.gpuPreference || launchAtStart.gpuBackend !== p.gpuBackend)
  );
}

/** Transmet les réglages au moteur (perf.ts : cache, aperçu, historique, threads). */
function applyPerf(): void {
  setPerformanceSettings({
    cacheMb: perf.cacheMb,
    historyLimit: perf.historyLimit,
    previewQuality: perf.previewQuality,
    hardwareAcceleration: perf.hardwareAcceleration,
    workerThreads: threadCount(perf),
  });
  void sendLaunchPrefs();
  void configureNativeEngine(engineSettings(perf));
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Au démarrage : applique les préférences et surveille la mémoire. */
export function startPreferences(): void {
  launchAtStart = { gpuPreference: perf.gpuPreference, gpuBackend: perf.gpuBackend };
  applyPerf();
  void readSystemMemory();
  clearInterval(timer);
  timer = setInterval(checkMemory, 5000);
}

/** Nombre de threads de calcul effectif. */
export function threadCount(p: PerfPrefs = perf): number {
  const cores = navigator.hardwareConcurrency || 1;
  return p.threads > 0 ? Math.min(p.threads, cores) : Math.max(1, Math.min(4, cores - 1));
}

/* ——— Import et export de toutes les préférences ——— */

/** Clés enregistrées sur l'ordinateur qui forment les préférences de l'utilisateur. */
const EXPORTED = [
  'poulpe.settings',
  'poulpe.perf',
  'poulpe.lang',
  'poulpe.shortcuts',
  'poulpe.panels',
  'poulpe.workspaces',
];

export function exportPreferences(): string {
  const out: Record<string, unknown> = { poulpePreferences: 1 };
  for (const k of EXPORTED) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = k === 'poulpe.lang' ? v : JSON.parse(v);
    } catch {
      /* clé illisible : ignorée */
    }
  }
  return JSON.stringify(out, null, 2);
}

/** Remplace les préférences par celles d'un fichier exporté ; l'appli se recharge ensuite. */
export function importPreferences(text: string): boolean {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return false;
  }
  if (!data || data.poulpePreferences !== 1) return false;
  try {
    for (const k of EXPORTED) {
      if (!(k in data)) continue;
      const v = data[k];
      if (k === 'poulpe.lang') {
        if (v === 'fr' || v === 'en') localStorage.setItem(k, v);
      } else if (v && typeof v === 'object')
        localStorage.setItem(k, JSON.stringify(k === 'poulpe.perf' ? sanitize(v) : v));
    }
  } catch {
    return false;
  }
  return true;
}

/** Efface toutes les préférences (réglages, raccourcis, langue, performances, panneaux, espaces de travail). */
export function resetAllPreferences(): void {
  for (const k of EXPORTED) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* stockage indisponible */
    }
  }
}
