import type { PreviewQuality, RenderCacheStats } from '@poulpe/render';
import { editor } from './store';

/*
 * Réglages de performance, comme dans les préférences d'Affinity ou de Photoshop. Ce module les
 * applique au moteur ; la fenêtre Préférences les affiche et les enregistre, puis appelle
 * `setPerformanceSettings` (au démarrage aussi, avec les valeurs enregistrées).
 */

export interface PerformanceSettings {
  /** Mémoire maximale du cache d'images du canevas, en Mo (0 : pas de cache). */
  cacheMb: number;
  /** Nombre maximal d'étapes d'annulation (0 : illimité). */
  historyLimit: number;
  /**
   * Pendant un zoom ou un défilement : `fast` réutilise toujours l'image déjà calculée, étirée ;
   * `balanced` aussi, tant qu'elle couvre l'écran ; `full` redessine net à chaque image.
   * Dans les deux premiers cas, l'image est redessinée nette dès que le geste s'arrête.
   */
  previewQuality: PreviewQuality;
  /** Accélération matérielle des images du cache (toiles hors écran gérées par la carte graphique). */
  hardwareAcceleration: boolean;
  /** Fils de calcul pour les traitements lourds (détourage par IA). */
  workerThreads: number;
  /** Gros redessins découpés en bandes dessinées en même temps sur plusieurs cœurs. */
  parallelDrawing: boolean;
}

export const MAX_THREADS = 16;

export function defaultThreads(): number {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  return Math.max(1, Math.min(MAX_THREADS, cores - 1));
}

export function defaultPerformanceSettings(): PerformanceSettings {
  return {
    cacheMb: 256,
    historyLimit: 500,
    previewQuality: 'balanced',
    hardwareAcceleration: true,
    workerThreads: defaultThreads(),
    parallelDrawing: true,
  };
}

let current = defaultPerformanceSettings();
editor.setHistoryLimit(current.historyLimit);
const listeners = new Set<(s: PerformanceSettings) => void>();

export function getPerformanceSettings(): PerformanceSettings {
  return current;
}

/** Valeurs bornées : un réglage enregistré abîmé ne doit pas bloquer l'appli. */
function sanitize(s: PerformanceSettings): PerformanceSettings {
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : fallback;
  const d = defaultPerformanceSettings();
  return {
    cacheMb: num(s.cacheMb, d.cacheMb, 0, 8192),
    historyLimit: num(s.historyLimit, d.historyLimit, 0, 100000),
    previewQuality: ['fast', 'balanced', 'full'].includes(s.previewQuality)
      ? s.previewQuality
      : d.previewQuality,
    hardwareAcceleration: typeof s.hardwareAcceleration === 'boolean' ? s.hardwareAcceleration : true,
    workerThreads: num(s.workerThreads, d.workerThreads, 1, MAX_THREADS),
    parallelDrawing: typeof s.parallelDrawing === 'boolean' ? s.parallelDrawing : true,
  };
}

/** Applique des réglages de performance (ceux qui manquent gardent leur valeur). */
export function setPerformanceSettings(patch: Partial<PerformanceSettings>): PerformanceSettings {
  current = sanitize({ ...current, ...patch });
  editor.setHistoryLimit(current.historyLimit);
  listeners.forEach((l) => l(current));
  return current;
}

/** Prévient quand les réglages changent (le canevas s'en sert pour régler son cache). */
export function onPerformanceSettings(fn: (s: PerformanceSettings) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

export interface RenderStats extends RenderCacheStats {
  /** Durée des dernières images du canevas, en ms (moyenne et pire des 60 dernières). */
  frameAvgMs: number;
  frameMaxMs: number;
  /** Mémoire JavaScript occupée, en Mo (navigateurs Chromium seulement). */
  heapMb: number | null;
  heapLimitMb: number | null;
}

const frames: number[] = [];

/** Le canevas note la durée de chaque image. */
export function recordFrame(ms: number): void {
  frames.push(ms);
  if (frames.length > 60) frames.shift();
}

let statsSource: (() => RenderCacheStats) | null = null;
export function setRenderStatsSource(fn: (() => RenderCacheStats) | null): void {
  statsSource = fn;
}

/** Chiffres pour la fenêtre Diagnostic. */
export function renderStats(): RenderStats {
  const cache = statsSource?.() ?? {
    usedMb: 0,
    budgetMb: current.cacheMb,
    entries: 0,
    hits: 0,
    misses: 0,
  };
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } })
    .memory;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    ...cache,
    frameAvgMs: frames.length ? r(frames.reduce((a, b) => a + b, 0) / frames.length) : 0,
    frameMaxMs: frames.length ? r(Math.max(...frames)) : 0,
    heapMb: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
    heapLimitMb: memory ? Math.round(memory.jsHeapSizeLimit / 1048576) : null,
  };
}
