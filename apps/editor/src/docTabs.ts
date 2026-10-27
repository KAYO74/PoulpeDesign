import type { EditorSnapshot } from '@poulpe/core';
import { t } from './i18n';
import { editor, Store, starterDocument, ui, useStore, type View } from './store';

/*
 * Plusieurs documents à la fois, comme les onglets d'Affinity. L'éditeur n'en garde qu'un en direct :
 * les autres sont rangés avec leur historique, leur fichier et leur vue, puis remis tels quels.
 */

interface Tab {
  id: string;
  /** Document rangé (onglet non actif) ; null pour l'onglet actif, qui vit dans l'éditeur. */
  snap: EditorSnapshot | null;
  filePath: string | null;
  view: View | null;
}

interface TabsState {
  tabs: Tab[];
  activeId: string;
}

let counter = 1;
const tabsStore = new Store<TabsState>({
  tabs: [{ id: 't1', snap: null, filePath: null, view: null }],
  activeId: 't1',
});

export function useTabs(): TabsState {
  return useStore(tabsStore, (s) => s);
}

/** Nom, état « modifié » et fichier d'un onglet, lus en direct pour l'actif. */
export function tabInfo(tab: Tab): { name: string; dirty: boolean; filePath: string | null } {
  if (!tab.snap) {
    const { doc, dirty } = editor.getState();
    return { name: doc.name, dirty, filePath: ui.get().filePath };
  }
  return { name: tab.snap.doc.name, dirty: tab.snap.doc !== tab.snap.savedDoc, filePath: tab.filePath };
}

function parkActive(): void {
  const { tabs, activeId } = tabsStore.get();
  const snap = editor.snapshot();
  const filePath = ui.get().filePath;
  const view = ui.get().view;
  tabsStore.set({ tabs: tabs.map((x) => (x.id === activeId ? { ...x, snap, filePath, view } : x)) });
}

/** Remet l'interface à zéro pour le document qui devient actif. */
function resetViewState(filePath: string | null, view: View | null): void {
  ui.set({
    filePath,
    ...(view ? { view } : {}),
    maskEditId: null,
    editingTextId: null,
    nodeSelection: [],
    cropId: null,
    perspectiveId: null,
    dialog: null,
  });
  if (!view) requestAnimationFrame(() => window.dispatchEvent(new Event('poulpe:fit')));
}

function activate(tab: Tab): void {
  tabsStore.set({ activeId: tab.id });
  if (tab.snap) editor.restore(tab.snap);
  resetViewState(tab.filePath, tab.view);
  tabsStore.set((s) => ({ tabs: s.tabs.map((x) => (x.id === tab.id ? { ...x, snap: null } : x)) }));
}

/** Nouvel onglet avec un document vide, rendu actif. */
export function openTab(): void {
  parkActive();
  const tab: Tab = { id: `t${++counter}`, snap: null, filePath: null, view: null };
  tabsStore.set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  editor.load(starterDocument(), { unsaved: false });
  resetViewState(null, null);
}

export function switchTab(id: string): void {
  const { tabs, activeId } = tabsStore.get();
  if (id === activeId) return;
  const tab = tabs.find((x) => x.id === id);
  if (!tab) return;
  parkActive();
  activate(tabsStore.get().tabs.find((x) => x.id === id)!);
}

export function closeTab(id: string): void {
  const { tabs, activeId } = tabsStore.get();
  const tab = tabs.find((x) => x.id === id);
  if (!tab) return;
  if (tabInfo(tab).dirty && !window.confirm(t('file.unsaved'))) return;
  if (tabs.length === 1) {
    editor.load(starterDocument());
    resetViewState(null, null);
    return;
  }
  const rest = tabs.filter((x) => x.id !== id);
  if (id !== activeId) {
    tabsStore.set({ tabs: rest });
    return;
  }
  const next = rest[Math.min(tabs.indexOf(tab), rest.length - 1)];
  tabsStore.set({ tabs: rest });
  activate(next);
}

/** Vrai s'il n'y a rien à perdre dans le document actif : vide, jamais modifié, sans fichier. */
function activeIsPristine(): boolean {
  const s = editor.getState();
  return !s.dirty && !s.canUndo && !ui.get().filePath;
}

/**
 * Appelé avant d'ouvrir ou de créer un document : le document actif reste dans son onglet et le
 * nouveau prend un onglet à lui, sauf si l'actif est encore vierge (il est alors réutilisé).
 */
export function makeRoomForDocument(): void {
  if (!activeIsPristine()) openTab();
}

/** Avant de quitter ou de se mettre à jour : confirmer s'il reste des modifications dans un onglet. */
export function confirmQuit(): boolean {
  const anyDirty = tabsStore.get().tabs.some((x) => tabInfo(x).dirty);
  return !anyDirty || window.confirm(t('file.unsavedAll'));
}

export function anyDirty(): boolean {
  return tabsStore.get().tabs.some((x) => tabInfo(x).dirty);
}
