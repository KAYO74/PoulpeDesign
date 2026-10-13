import { useSyncExternalStore } from 'react';

/*
 * Raccourcis clavier personnalisés (Aide > Raccourcis clavier) : ils remplacent ceux par défaut,
 * pour les commandes des menus, les macros et les extensions. Gardés dans le navigateur ou l'appli.
 */

const KEY = 'poulpe.shortcuts';
/** Raccourci choisi par commande ; une chaîne vide retire le raccourci par défaut. */
let overrides: Record<string, string> = load();
const listeners = new Set<() => void>();

function load(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    /* stockage indisponible */
  }
  listeners.forEach((l) => l());
}

/** Raccourci en vigueur d'une commande (`fallback` : celui par défaut). */
export function shortcutOf(id: string, fallback?: string): string | undefined {
  if (id in overrides) return overrides[id] || undefined;
  return fallback;
}

export function isCustomized(id: string): boolean {
  return id in overrides;
}

/** Donne un raccourci à une commande ; null : retire le raccourci. */
export function setShortcut(id: string, shortcut: string | null): void {
  overrides = { ...overrides, [id]: shortcut ?? '' };
  save();
}

/** Revient au raccourci par défaut d'une commande, ou de toutes. */
export function resetShortcut(id?: string): void {
  if (id) {
    const { [id]: _, ...rest } = overrides;
    overrides = rest;
  } else overrides = {};
  save();
}

/** Prévient quand un raccourci change. */
export function subscribeShortcuts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useShortcuts(): Record<string, string> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => overrides,
  );
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Slash: '/',
  Quote: "'",
};

/**
 * Raccourci d'une touche pressée, au format des commandes (« Mod+Shift+K »), ou null pour une
 * touche de modification seule. Ctrl et Cmd donnent tous deux « Mod ».
 */
export function eventToShortcut(e: KeyboardEvent): string | null {
  if (['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
  let key: string;
  if (e.key === 'Delete' || e.key === 'Backspace') key = 'Delete';
  // Lettres d'après la touche affichée (AZERTY comme QWERTY), chiffres d'après la position.
  else if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else if (
    /^F\d{1,2}$/.test(e.key) ||
    ['Enter', 'Tab', 'Home', 'End', 'PageUp', 'PageDown', 'Insert'].includes(e.key)
  )
    key = e.key;
  else if (e.key.length === 1) key = e.key.toUpperCase();
  else return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
