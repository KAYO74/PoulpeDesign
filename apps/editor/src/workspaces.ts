import { useSyncExternalStore } from 'react';
import { setPersona } from './photo/persona';
import { DEFAULT_PANELS, panels, type PanelLayout } from './panels/panelLayout';
import {
  setSettings,
  ui,
  type Persona,
  type Side,
  type ToolId,
  type ToolsColumns,
  type ToolsLayout,
} from './store';
import { toolPersona } from './toolCatalog';
import { brushOptions } from './tools/brushes/state';

/**
 * Espaces de travail personnalisés, comme dans Affinity : on part d'une base (vectoriel, pixel ou
 * présentation), on choisit les outils et les panneaux affichés, et l'espace retient la disposition
 * des panneaux (ancrés ou flottants, positions et tailles). Tant qu'un espace personnalisé est
 * actif, chaque changement de disposition y est enregistré.
 */
export interface Workspace {
  id: string;
  name: string;
  base: Persona;
  /**
   * Outils de la colonne (null : ceux de la base). Ils peuvent mélanger vectoriel et pixel : choisir
   * un outil pixel passe en mode Photo, un outil vectoriel revient à la base.
   */
  tools: ToolId[] | null;
  /** Onglets du Studio affichés (null : tous). */
  tabs: string[] | null;
  library: boolean;
  toolsSide: Side;
  toolsColumns?: ToolsColumns;
  toolsLayout?: ToolsLayout;
  toolsLocked?: boolean;
  studioSide: Side;
  panels: PanelLayout;
}

interface WorkspaceState {
  list: Workspace[];
  /** Espace personnalisé actif (null : une des Personas intégrées). */
  active: string | null;
  /** Disposition des panneaux des Personas intégrées, rendue en quittant un espace personnalisé. */
  builtinPanels: PanelLayout | null;
}

const KEY = 'poulpe.workspaces';

/**
 * Espaces enregistrés avant la version 1.2 : l'ancien Lasso polygonal est devenu un mode du lasso.
 * La colonne garde le lasso à sa place (réglé en mode polygonal s'il n'y avait que lui).
 */
function migrate(list: Workspace[]): Workspace[] {
  let polygonal = false;
  const out = list.map((w) => {
    if (!Array.isArray(w.tools) || !w.tools.includes('polyLasso')) return w;
    if (!w.tools.includes('lasso')) polygonal = true;
    return { ...w, tools: [...new Set(w.tools.map((id): ToolId => (id === 'polyLasso' ? 'lasso' : id)))] };
  });
  if (polygonal) brushOptions.set({ lassoMode: 'polygonal' });
  return out;
}

function load(): WorkspaceState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<WorkspaceState>;
    const list = Array.isArray(s.list) ? s.list : [];
    const next = migrate(list);
    const loaded = { list: next, active: s.active ?? null, builtinPanels: s.builtinPanels ?? null };
    // La conversion est enregistrée tout de suite : elle ne se fait qu'une fois.
    if (next.some((w, i) => w !== list[i])) localStorage.setItem(KEY, JSON.stringify(loaded));
    return loaded;
  } catch {
    return { list: [], active: null, builtinPanels: null };
  }
}

let state = load();
if (state.active && !state.list.some((w) => w.id === state.active)) state = { ...state, active: null };
const listeners = new Set<() => void>();

function set(patch: Partial<WorkspaceState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* stockage indisponible */
  }
}

export const workspaces = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useWorkspaces<T>(select: (s: WorkspaceState) => T): T {
  return useSyncExternalStore(workspaces.subscribe, () => select(state));
}

export function activeWorkspace(): Workspace | null {
  return state.list.find((w) => w.id === state.active) ?? null;
}

export function useActiveWorkspace(): Workspace | null {
  return useWorkspaces((s) => s.list.find((w) => w.id === s.active) ?? null);
}

const clonePanels = (p: PanelLayout): PanelLayout => JSON.parse(JSON.stringify(p)) as PanelLayout;

function update(id: string, patch: Partial<Workspace>): void {
  set({ list: state.list.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
}

/** Ouvre un espace personnalisé : sa base, ses réglages de côté et sa disposition de panneaux. */
export function applyWorkspace(id: string): void {
  const ws = state.list.find((w) => w.id === id);
  if (!ws) return;
  const builtinPanels = state.active ? state.builtinPanels : clonePanels(panels.get());
  set({ active: null, builtinPanels });
  setPersona(ws.base, ws.tools);
  setSettings({
    library: ws.library,
    toolsSide: ws.toolsSide,
    toolsColumns: ws.toolsColumns ?? 'auto',
    toolsLayout: ws.toolsLayout ?? 'all',
    toolsLocked: ws.toolsLocked ?? false,
    studioSide: ws.studioSide,
  });
  // Espace enregistré avant le rangement libre des panneaux : groupes d'origine.
  panels.set({ ...clonePanels(ws.panels), tabs: ws.panels.tabs ?? {} });
  set({ active: id });
}

/** Personas qu'un espace peut traverser : sa base, plus celles dont ses outils ont besoin. */
export function personasOf(ws: Workspace): Persona[] {
  const list: Persona[] = [ws.base];
  for (const id of ws.tools ?? []) {
    const need = toolPersona(id);
    if (need === 'photo' && !list.includes('photo')) list.push('photo');
    if (need === 'draw' && ws.base === 'photo' && !list.includes('draw')) list.push('draw');
  }
  return list;
}

/** Revient à une Persona intégrée (Dessin, Photo, Mise en page) et à sa disposition. */
export function openPersona(persona: Persona): void {
  if (state.active) {
    const back = state.builtinPanels;
    set({ active: null, builtinPanels: null });
    panels.set(back ? clonePanels(back) : { ...DEFAULT_PANELS, floating: {}, order: [] });
  }
  setPersona(persona);
}

export interface WorkspaceDraft {
  name: string;
  base: Persona;
  tools: ToolId[] | null;
  tabs: string[] | null;
  toolsColumns: ToolsColumns;
}

/** Crée un espace à partir de la disposition actuelle et l'ouvre. */
export function createWorkspace(draft: WorkspaceDraft): string {
  const s = ui.get().settings;
  const id = `ws-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ws: Workspace = {
    id,
    ...draft,
    library: s.library,
    toolsSide: s.toolsSide,
    toolsLayout: s.toolsLayout,
    toolsLocked: s.toolsLocked,
    studioSide: s.studioSide,
    panels: clonePanels(panels.get()),
  };
  set({ list: [...state.list, ws] });
  applyWorkspace(id);
  return id;
}

/** Modifie le nom, la base, les outils ou les panneaux d'un espace. */
export function editWorkspace(id: string, draft: WorkspaceDraft): void {
  update(id, draft);
  if (state.active === id) {
    setPersona(draft.base, draft.tools);
    setSettings({ toolsColumns: draft.toolsColumns });
  }
}

export function deleteWorkspace(id: string): void {
  const wasActive = state.active === id;
  const base = state.list.find((w) => w.id === id)?.base ?? 'draw';
  set({ list: state.list.filter((w) => w.id !== id) });
  if (wasActive) openPersona(base);
}

// Tant qu'un espace personnalisé est actif, sa disposition suit les changements de l'utilisateur.
panels.onSave(() => {
  if (state.active) update(state.active, { panels: clonePanels(panels.get()) });
});
ui.subscribe(() => {
  const ws = activeWorkspace();
  if (!ws) return;
  // Changer de Persona (raccourci, menu) quitte l'espace personnalisé, sauf vers une Persona dont
  // ses outils ont besoin (espace mixte vectoriel + pixel).
  if (!personasOf(ws).includes(ui.get().persona)) {
    const persona = ui.get().persona;
    queueMicrotask(() => state.active === ws.id && openPersona(persona));
    return;
  }
  const s = ui.get().settings;
  if (
    s.library !== ws.library ||
    s.toolsSide !== ws.toolsSide ||
    s.studioSide !== ws.studioSide ||
    s.toolsColumns !== (ws.toolsColumns ?? 'auto') ||
    s.toolsLayout !== (ws.toolsLayout ?? 'all') ||
    s.toolsLocked !== (ws.toolsLocked ?? false)
  )
    update(ws.id, {
      library: s.library,
      toolsSide: s.toolsSide,
      studioSide: s.studioSide,
      toolsColumns: s.toolsColumns,
      toolsLayout: s.toolsLayout,
      toolsLocked: s.toolsLocked,
    });
});
