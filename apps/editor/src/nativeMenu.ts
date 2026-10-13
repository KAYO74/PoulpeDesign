import type { CheckMenuItem, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import {
  allCommands,
  commandShortcut,
  commandTitle,
  findCommand,
  runCommand,
  subscribeCommands,
} from './commands';
import { menuSpec, type MenuNode } from './components/menuSpec';
import { subscribeLang, t } from './i18n';
import { subscribeShortcuts } from './shortcuts';
import { editor, ui } from './store';
import { pixelStore } from './tools/pixel/store';
import { workspaces } from './workspaces';

/*
 * Appli de bureau sur Mac : les menus de l'éditeur (Fichier, Édition, Calque…) passent dans la
 * barre de menus du système, à côté de la pomme. Ils sont construits depuis menuSpec, comme la
 * barre de menus de l'éditeur, et suivent l'état de l'appli (coches, commandes disponibles).
 */

/** Raccourci d'une commande au format des menus du système (« CmdOrCtrl+Shift+S »). */
export function toAccelerator(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined;
  const parts = shortcut.split('+');
  const key = parts.pop() || '+';
  // Une touche seule (V, Suppr…) resterait captée par le menu, même dans un champ de texte.
  if (parts.length === 0 && !/^F\d{1,2}$/.test(key)) return undefined;
  const keys: Record<string, string> = {
    '=': 'Equal',
    '-': 'Minus',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    "'": 'Quote',
    ';': 'Semicolon',
    '<': 'Comma',
    '>': 'Period',
    Delete: 'Backspace',
  };
  const mods = parts.map((m) => (m === 'Mod' ? 'CmdOrCtrl' : m));
  return [...mods, keys[key] ?? (key.length === 1 ? key.toUpperCase() : key)].join('+');
}

/** Commandes d'édition qui, dans un champ de texte, agissent sur le texte. */
const TEXT_EDIT: Record<string, string> = {
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.selectAll': 'selectAll',
  'select.all': 'selectAll',
};

function editingField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el?.closest('input, textarea, select, [contenteditable="true"]');
}

/** Comme au clavier : une commande de la Persona active avec le même raccourci passe d'abord. */
function resolve(id: string): string {
  const shortcut = commandShortcut(id);
  if (!shortcut) return id;
  const persona = ui.get().persona;
  for (const [other, cmd] of allCommands()) {
    if (cmd.persona !== persona || commandShortcut(other) !== shortcut) continue;
    if (!cmd.enabled || cmd.enabled()) return other;
  }
  return id;
}

function runFromMenu(id: string): void {
  if (editingField() && TEXT_EDIT[id]) {
    document.execCommand(TEXT_EDIT[id]);
    return;
  }
  const { dialog, updateOpen } = ui.get();
  if (dialog || updateOpen) return;
  runCommand(resolve(id));
}

type Leaf = { item: MenuItem | CheckMenuItem; enabled: boolean; checked?: boolean };

/** Description stable d'un menu : s'il change (langue, extensions, raccourcis…), on le reconstruit. */
function structure(items: MenuNode[]): string {
  return items
    .map((n) => {
      switch (n.kind) {
        case 'sep':
          return '-';
        case 'sub':
          return `>${n.label}(${structure(n.items)})`;
        case 'action':
          return `a:${n.key}:${n.label}:${n.hint ?? ''}:${n.checked !== undefined}`;
        case 'cmd': {
          const cmd = findCommand(n.id);
          return cmd
            ? `c:${n.id}:${commandTitle(cmd)}:${commandShortcut(n.id) ?? ''}:${n.checked !== undefined}`
            : '';
        }
      }
    })
    .join('|');
}

export async function installMacMenu(): Promise<void> {
  const api = await import('@tauri-apps/api/menu');
  let builtKey = '';
  let leaves = new Map<string, Leaf>();
  /** Actions des choix propres au menu, relues à chaque clic (elles changent avec l'état). */
  let actions = new Map<string, () => void>();

  const state = (n: MenuNode): { enabled: boolean; checked?: boolean } => {
    if (n.kind === 'cmd') {
      const cmd = findCommand(n.id);
      return { enabled: !!cmd && (!cmd.enabled || cmd.enabled()), checked: n.checked };
    }
    return { enabled: true, checked: n.kind === 'action' ? n.checked : undefined };
  };

  async function leaf(
    path: string,
    text: string,
    n: MenuNode,
    accelerator?: string,
  ): Promise<MenuItem | CheckMenuItem> {
    const { enabled, checked } = state(n);
    const action = () => {
      if (n.kind === 'cmd') runFromMenu(n.id);
      else if (n.kind === 'action' && !(ui.get().dialog || ui.get().updateOpen)) actions.get(n.key)?.();
    };
    const make = (acc?: string) =>
      checked !== undefined
        ? api.CheckMenuItem.new({ text, enabled, checked, accelerator: acc, action })
        : api.MenuItem.new({ text, enabled, accelerator: acc, action });
    let item: MenuItem | CheckMenuItem;
    try {
      item = await make(accelerator);
    } catch {
      item = await make();
    }
    leaves.set(path, { item, enabled, checked });
    return item;
  }

  async function build(
    items: MenuNode[],
    path: string,
  ): Promise<(MenuItem | CheckMenuItem | Submenu | PredefinedMenuItem)[]> {
    const out: (MenuItem | CheckMenuItem | Submenu | PredefinedMenuItem)[] = [];
    for (const [i, n] of items.entries()) {
      const p = `${path}/${i}`;
      if (n.kind === 'sep') out.push(await api.PredefinedMenuItem.new({ item: 'Separator' }));
      else if (n.kind === 'sub')
        out.push(await api.Submenu.new({ text: n.label, items: await build(n.items, p) }));
      else if (n.kind === 'action') {
        actions.set(n.key, n.run);
        out.push(await leaf(p, n.label, n));
      } else {
        const cmd = findCommand(n.id);
        if (!cmd) continue;
        // Couper, copier et coller : ceux du système, pour les champs de texte (voir plus bas).
        const native = { 'edit.cut': 'Cut', 'edit.copy': 'Copy', 'edit.paste': 'Paste' } as const;
        const kind = native[n.id as keyof typeof native];
        if (kind) out.push(await api.PredefinedMenuItem.new({ item: kind, text: commandTitle(cmd) }));
        else out.push(await leaf(p, commandTitle(cmd), n, toAccelerator(commandShortcut(n.id))));
      }
    }
    return out;
  }

  /** Met les coches et les commandes disponibles à jour, sans reconstruire le menu. */
  async function refresh(items: MenuNode[], path: string): Promise<void> {
    for (const [i, n] of items.entries()) {
      const p = `${path}/${i}`;
      if (n.kind === 'sub') await refresh(n.items, p);
      if (n.kind === 'action') actions.set(n.key, n.run);
      const l = leaves.get(p);
      if (!l) continue;
      const s = state(n);
      if (s.enabled !== l.enabled) await l.item.setEnabled((l.enabled = s.enabled));
      if (s.checked !== undefined && s.checked !== l.checked && 'setChecked' in l.item)
        await l.item.setChecked((l.checked = s.checked));
    }
  }

  async function sync(): Promise<void> {
    const spec = menuSpec({ nativeMac: true });
    const key = spec.map((m) => `${m.label}{${structure(m.items)}}`).join('') + t('app.name');
    if (key === builtKey) {
      for (const m of spec) await refresh(m.items, m.id);
      return;
    }
    leaves = new Map();
    actions = new Map();
    const app = await api.Submenu.new({
      text: t('app.name'),
      items: [
        ...(await build(
          [{ kind: 'cmd', id: 'help.about' }, { kind: 'sep' }, { kind: 'cmd', id: 'app.preferences' }],
          'app',
        )),
        await api.PredefinedMenuItem.new({ item: 'Separator' }),
        await api.PredefinedMenuItem.new({ item: 'Services', text: t('macMenu.services') }),
        await api.PredefinedMenuItem.new({ item: 'Separator' }),
        await api.PredefinedMenuItem.new({ item: 'Hide', text: t('macMenu.hide') }),
        await api.PredefinedMenuItem.new({ item: 'HideOthers', text: t('macMenu.hideOthers') }),
        await api.PredefinedMenuItem.new({ item: 'ShowAll', text: t('macMenu.showAll') }),
        await api.PredefinedMenuItem.new({ item: 'Separator' }),
        await api.PredefinedMenuItem.new({ item: 'Quit', text: t('macMenu.quit') }),
      ],
    });
    const tops: Submenu[] = [];
    for (const m of spec)
      tops.push(await api.Submenu.new({ text: m.label, items: await build(m.items, m.id) }));
    const windowMenu = await api.Submenu.new({
      text: t('macMenu.window'),
      items: [
        await api.PredefinedMenuItem.new({ item: 'Minimize', text: t('window.minimize') }),
        await api.PredefinedMenuItem.new({ item: 'Maximize', text: t('macMenu.zoom') }),
        await api.PredefinedMenuItem.new({ item: 'Fullscreen', text: t('macMenu.fullscreen') }),
        await api.PredefinedMenuItem.new({ item: 'Separator' }),
        await api.PredefinedMenuItem.new({ item: 'BringAllToFront', text: t('macMenu.bringAllToFront') }),
      ],
    });
    // Le menu Fenêtre se place avant Aide, comme dans les applis du Mac.
    const menu = await api.Menu.new({ items: [app, ...tops.slice(0, -1), windowMenu, ...tops.slice(-1)] });
    await menu.setAsAppMenu();
    builtKey = key;
  }

  // Une seule mise à jour à la fois, au plus tôt 150 ms après le dernier changement.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      running = running.then(sync).catch((e) => console.warn('menu du Mac :', e));
    }, 150);
  };
  for (const subscribe of [
    editor.subscribe,
    ui.subscribe,
    pixelStore.subscribe,
    workspaces.subscribe,
    subscribeCommands,
    subscribeShortcuts,
    subscribeLang,
  ])
    subscribe(schedule);
  running = sync().catch((e) => console.warn('menu du Mac :', e));

  // Couper, copier et coller du menu hors d'un champ de texte : les objets du document.
  for (const [event, id] of [
    ['cut', 'edit.cut'],
    ['copy', 'edit.copy'],
    ['paste', 'edit.paste'],
  ] as const)
    document.addEventListener(event, (e) => {
      if (editingField() || ui.get().dialog) return;
      e.preventDefault();
      runCommand(id);
    });
}
