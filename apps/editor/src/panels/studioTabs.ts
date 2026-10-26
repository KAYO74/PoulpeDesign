import type { MessageKey } from '../i18n';
import type { Persona } from '../store';
import { activeWorkspace } from '../workspaces';
import { clampFrame, panels, tabPanel, type StudioGroupId, type StudioTabs } from './panelLayout';

/*
 * Panneaux du Studio (Couleur, Calques, Historique…) et leur place, comme dans Photoshop et
 * Affinity : chacun peut passer d'un groupe à l'autre, changer d'ordre, être fermé ou rouvert
 * depuis le menu Fenêtre. Sans changement de l'utilisateur, chaque Persona garde ses groupes.
 */

export const STUDIO_TABS: { id: string; label: MessageKey }[] = [
  { id: 'color', label: 'studio.color' },
  { id: 'stroke', label: 'studio.stroke' },
  { id: 'effects', label: 'studio.effects' },
  { id: 'transform', label: 'studio.transform' },
  { id: 'character', label: 'studio.character' },
  { id: 'brush', label: 'studio.brush' },
  { id: 'adjustment', label: 'studio.adjustment' },
  { id: 'histogram', label: 'studio.histogram' },
  { id: 'layers', label: 'studio.layers' },
  { id: 'channels', label: 'studio.channels' },
  { id: 'history', label: 'studio.history' },
  { id: 'macros', label: 'macro.title' },
];

const TOP_DRAW = ['color', 'stroke', 'effects', 'transform', 'character'];
const TOP_PHOTO = ['color', 'brush', 'adjustment', 'histogram', 'effects'];
const BOTTOM = ['layers', 'history'];
const BOTTOM_PHOTO = ['layers', 'channels', 'history'];
const BOTTOM_DRAW = [...BOTTOM, 'macros'];

export type TabsKind = 'draw' | 'photo';
export const tabsKind = (persona: Persona): TabsKind => (persona === 'photo' ? 'photo' : 'draw');

/** Groupes d'origine d'une Persona. */
export function defaultTabs(kind: TabsKind): StudioTabs {
  return kind === 'photo' ? { top: TOP_PHOTO, bottom: BOTTOM_PHOTO } : { top: TOP_DRAW, bottom: BOTTOM_DRAW };
}

/** Groupe où un panneau va par défaut (celui de la Persona, sinon celui de l'autre Persona). */
function homeGroup(kind: TabsKind, tab: string): StudioGroupId {
  const own = defaultTabs(kind);
  if (own.top.includes(tab)) return 'studio-top';
  if (own.bottom.includes(tab)) return 'studio-bottom';
  return defaultTabs(kind === 'photo' ? 'draw' : 'photo').bottom.includes(tab)
    ? 'studio-bottom'
    : 'studio-top';
}

/**
 * Panneaux de chaque groupe, dans l'ordre : ceux choisis par l'utilisateur, sinon ceux de la
 * Persona (limités aux panneaux de l'espace de travail personnalisé ouvert).
 */
export function currentTabs(kind: TabsKind): StudioTabs {
  const custom = panels.get().tabs[kind];
  if (custom) return custom;
  const def = defaultTabs(kind);
  const allowed = activeWorkspace()?.tabs ?? null;
  if (!allowed) return def;
  return {
    top: def.top.filter((id) => allowed.includes(id)),
    bottom: def.bottom.filter((id) => allowed.includes(id)),
  };
}

export function isTabShown(kind: TabsKind, tab: string): boolean {
  const cur = currentTabs(kind);
  return cur.top.includes(tab) || cur.bottom.includes(tab);
}

const key = (group: StudioGroupId) => (group === 'studio-top' ? 'top' : 'bottom');

function without(cur: StudioTabs, tab: string): StudioTabs {
  return { top: cur.top.filter((id) => id !== tab), bottom: cur.bottom.filter((id) => id !== tab) };
}

function store(
  kind: TabsKind,
  next: StudioTabs,
  floating = panels.get().floating,
  order = panels.get().order,
) {
  panels.set({ tabs: { ...panels.get().tabs, [kind]: next }, floating, order });
}

/** Range un panneau dans un groupe, avant l'onglet `before` (ou à la fin), et l'y ancre. */
export function moveTab(kind: TabsKind, tab: string, group: StudioGroupId, before: string | null): void {
  const next = without(currentTabs(kind), tab);
  const list = [...next[key(group)]];
  const at = before ? list.indexOf(before) : -1;
  list.splice(at >= 0 ? at : list.length, 0, tab);
  next[key(group)] = list;
  const { floating, order } = panels.get();
  const f = { ...floating };
  delete f[tabPanel(tab)];
  store(
    kind,
    next,
    f,
    order.filter((o) => o !== tabPanel(tab)),
  );
}

/** Ferme un panneau (il se rouvre depuis le menu Fenêtre). */
export function hideTab(kind: TabsKind, tab: string): void {
  const { floating, order } = panels.get();
  const f = { ...floating };
  delete f[tabPanel(tab)];
  store(
    kind,
    without(currentTabs(kind), tab),
    f,
    order.filter((o) => o !== tabPanel(tab)),
  );
}

/** Rouvre un panneau fermé dans sa propre fenêtre, au milieu de l'écran. */
export function showTab(kind: TabsKind, tab: string): void {
  const next = without(currentTabs(kind), tab);
  const group = key(homeGroup(kind, tab));
  next[group] = [...next[group], tab];
  const id = tabPanel(tab);
  const w = 300;
  const h = 360;
  const frame = clampFrame({
    x: (window.innerWidth - w) / 2,
    y: Math.max(60, (window.innerHeight - h) / 3),
    w,
    h,
  });
  const { floating, order } = panels.get();
  store(kind, next, { ...floating, [id]: frame }, [...order.filter((o) => o !== id), id]);
}

export function toggleTab(kind: TabsKind, tab: string): void {
  if (isTabShown(kind, tab)) hideTab(kind, tab);
  else showTab(kind, tab);
}
