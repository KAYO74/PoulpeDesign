import { useEffect, useState, useSyncExternalStore } from 'react';
import { ui } from '../store';

/**
 * Disposition des panneaux, comme dans Photoshop : chaque fenêtre d'outils (colonne d'outils,
 * groupes du Studio) peut être détachée, déplacée librement et redimensionnée, puis ré-ancrée en
 * la ramenant contre son bord. Les panneaux ancrés gardent une largeur réglable.
 *
 * Magasin séparé des réglages pour que le déplacement d'une fenêtre ne redessine pas tout l'éditeur.
 */

/**
 * Fenêtres déplaçables : la colonne d'outils, les deux groupes du Studio, et chaque panneau
 * (Calques, Pinceau, Historique…) détaché seul de son groupe (`tab:<onglet>`).
 */
export type PanelId =
  'tools' | 'studio-top' | 'studio-bottom' | 'color-picker' | 'brush-editor' | `tab:${string}`;

/** Fenêtre d'un panneau détaché seul de son groupe. */
export const tabPanel = (tab: string): PanelId => `tab:${tab}`;

export interface PanelFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelLayout {
  /** Largeur du Studio ancré. */
  studioW: number;
  /** Largeur de la Bibliothèque / du panneau Pages. */
  libraryW: number;
  /** Hauteur du premier groupe du Studio ancré (null : automatique). */
  topH: number | null;
  /** Fenêtres flottantes, par panneau. */
  floating: Partial<Record<PanelId, PanelFrame>>;
  /** Ordre d'empilement des fenêtres flottantes (la dernière au premier plan). */
  order: PanelId[];
}

export const PANEL_LIMITS = {
  studioW: [240, 560],
  libraryW: [220, 520],
  minW: 44,
  minH: 80,
} as const;

const KEY = 'poulpe.panels';

export const DEFAULT_PANELS: PanelLayout = {
  studioW: 320,
  libraryW: 300,
  topH: null,
  floating: {},
  order: [],
};

function load(): PanelLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PanelLayout>;
    return { ...DEFAULT_PANELS, ...saved, floating: { ...saved.floating } };
  } catch {
    return DEFAULT_PANELS;
  }
}

let state: PanelLayout = load();
const listeners = new Set<() => void>();

export const panels = {
  get: () => state,
  /** Met à jour la disposition ; `persist: false` pendant un glissement, enregistré au relâchement. */
  set(patch: Partial<PanelLayout>, persist = true) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
    if (persist) save();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Appelé à chaque enregistrement (fin d'un glissement, ancrage…). */
  onSave(fn: () => void) {
    saveListeners.add(fn);
  },
};

const saveListeners = new Set<() => void>();

function save(): void {
  saveListeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* stockage indisponible : la disposition reste valable pour la session */
  }
}

export function usePanels<T>(select: (s: PanelLayout) => T): T {
  return useSyncExternalStore(panels.subscribe, () => select(state));
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Garde au moins une poignée de la fenêtre visible, même après un redimensionnement de l'écran. */
export function clampFrame(f: PanelFrame): PanelFrame {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const w = clamp(f.w, PANEL_LIMITS.minW, Math.max(PANEL_LIMITS.minW, W - 16));
  const h = clamp(f.h, PANEL_LIMITS.minH, Math.max(PANEL_LIMITS.minH, H - 16));
  return { w, h, x: clamp(f.x, 60 - w, W - 60), y: clamp(f.y, 0, H - 28) };
}

export function floatPanel(id: PanelId, frame: PanelFrame, persist = true): void {
  const s = panels.get();
  panels.set(
    {
      floating: { ...s.floating, [id]: clampFrame(frame) },
      order: [...s.order.filter((o) => o !== id), id],
    },
    persist,
  );
}

export function dockPanel(id: PanelId): void {
  const s = panels.get();
  const floating = { ...s.floating };
  delete floating[id];
  panels.set({ floating, order: s.order.filter((o) => o !== id) });
}

export function raisePanel(id: PanelId): void {
  const s = panels.get();
  if (s.order[s.order.length - 1] !== id) panels.set({ order: [...s.order.filter((o) => o !== id), id] });
}

export function resetPanels(): void {
  panels.set({ ...DEFAULT_PANELS, floating: {}, order: [] });
}

/** Redessine les fenêtres flottantes quand la fenêtre de l'appli change de taille. */
export function useWindowSize(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
}

/** Zone d'ancrage d'un panneau : le Studio ancré s'il est affiché, sinon une bande au bord. */
function dockRect(id: PanelId): DOMRect | null {
  const side = id === 'tools' ? ui.get().settings.toolsSide : ui.get().settings.studioSide;
  const ws = document.querySelector('.workspace')?.getBoundingClientRect();
  if (!ws) return null;
  if (id !== 'tools') {
    const studio = document.querySelector('.studio')?.getBoundingClientRect();
    if (studio && studio.width > 0) return studio;
  }
  const band = id === 'tools' ? 64 : 96;
  return new DOMRect(side === 'left' ? ws.left : ws.right - band, ws.top, band, ws.height);
}

const inRect = (r: DOMRect, x: number, y: number) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export interface DragOptions {
  /** Taille de la fenêtre créée (par défaut : celle de l'élément glissé). */
  size?: { w: number; h: number };
  /** Autre zone où le lâcher ancre le panneau (le groupe d'origine d'un panneau détaché). */
  home?: () => DOMRect | null;
}

function overDock(id: PanelId, opts: DragOptions, x: number, y: number): boolean {
  // Le sélecteur de couleur et la création de pinceau restent toujours flottants.
  if (id === 'color-picker' || id === 'brush-editor') return false;
  const zone = dockRect(id);
  if (zone && inRect(zone, x, y)) return true;
  const home = opts.home?.();
  return !!home && inRect(home, x, y);
}

/** Distance (px) à parcourir avant qu'un panneau ancré se détache. */
const TEAR_OFF = 10;

/**
 * Glissement d'un panneau par sa barre de titre : détache le panneau ancré après quelques pixels,
 * déplace la fenêtre flottante, et la ré-ancre si elle est lâchée sur sa zone d'ancrage.
 * Un simple clic (sans déplacement) n'est pas intercepté : les onglets restent cliquables.
 */
export function startPanelDrag(
  e: React.PointerEvent,
  id: PanelId,
  el: HTMLElement | null,
  opts: DragOptions = {},
): void {
  if (e.button !== 0 || !el) return;
  const target = e.target as HTMLElement;
  if (target.closest('[data-no-drag]')) return;
  const start = { x: e.clientX, y: e.clientY };
  const r = el.getBoundingClientRect();
  const off = { x: e.clientX - r.left, y: e.clientY - r.top };
  const initial = panels.get().floating[id];
  let moved = false;

  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < TEAR_OFF) return;
    if (!moved) {
      moved = true;
      document.body.classList.add('panel-dragging');
    }
    const cur = panels.get().floating[id];
    const w = cur?.w ?? initial?.w ?? opts.size?.w ?? Math.max(r.width, id === 'tools' ? 44 : 280);
    const h = cur?.h ?? initial?.h ?? opts.size?.h ?? Math.max(r.height, PANEL_LIMITS.minH);
    // Un panneau ancré très large : on garde la poignée sous le pointeur.
    const ox = Math.min(off.x, w - 20);
    floatPanel(id, { x: ev.clientX - ox, y: ev.clientY - off.y, w, h }, false);
    ui.set({ panelDock: overDock(id, opts, ev.clientX, ev.clientY) ? id : null });
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.classList.remove('panel-dragging');
    if (!moved) return;
    ui.set({ panelDock: null });
    if (ev.type === 'pointerup' && overDock(id, opts, ev.clientX, ev.clientY)) dockPanel(id);
    else panels.set({}, true);
    // Le clic qui suit un glissement (s'il a lieu) ne doit pas changer d'onglet.
    const swallow = (c: MouseEvent) => c.stopPropagation();
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Redimensionne une fenêtre flottante par un bord ou un coin. */
export function startPanelResize(e: React.PointerEvent, id: PanelId, edge: Edge): void {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const f0 = panels.get().floating[id];
  if (!f0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  const { minW, minH } = PANEL_LIMITS;
  document.body.classList.add('panel-dragging');
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    let { x, y, w, h } = f0;
    if (edge.includes('e')) w = Math.max(minW, f0.w + dx);
    if (edge.includes('s')) h = Math.max(minH, f0.h + dy);
    if (edge.includes('w')) {
      w = Math.max(minW, f0.w - dx);
      x = f0.x + f0.w - w;
    }
    if (edge.includes('n')) {
      h = Math.max(minH, f0.h - dy);
      y = f0.y + f0.h - h;
    }
    floatPanel(id, { x, y, w, h }, false);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('panel-dragging');
    panels.set({}, true);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/**
 * Séparateur d'un panneau ancré : `dir` vaut 1 si glisser vers la droite (ou le bas) agrandit.
 * Le double-clic rend la taille par défaut.
 */
export function startSplitter(
  e: React.PointerEvent,
  key: 'studioW' | 'libraryW' | 'topH',
  dir: 1 | -1,
  bounds: [number, number],
  current: number,
): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const axis = key === 'topH' ? 'clientY' : 'clientX';
  const s0 = e[axis];
  document.body.classList.add(key === 'topH' ? 'panel-resizing-v' : 'panel-resizing-h');
  const move = (ev: PointerEvent) => {
    panels.set({ [key]: Math.round(clamp(current + (ev[axis] - s0) * dir, ...bounds)) }, false);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('panel-resizing-v', 'panel-resizing-h');
    panels.set({}, true);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
