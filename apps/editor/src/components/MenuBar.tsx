import * as Menu from '@radix-ui/react-dropdown-menu';
import { useSyncExternalStore } from 'react';
import {
  commandShortcut,
  commandTitle,
  commandsVersion,
  findCommand,
  formatShortcut,
  runCommand,
  subscribeCommands,
  type CommandId,
} from '../commands';
import { useShortcuts } from '../shortcuts';
import { useT } from '../i18n';
import { useStore, useUi } from '../store';
import { pixelStore } from '../tools/pixel/store';
import { Icon } from './Icon';
import { menuSpec, type MenuNode } from './menuSpec';
import { useActiveWorkspace, useWorkspaces } from '../workspaces';
import { usePanels } from '../panels/panelLayout';

export function Item({ id, checked }: { id: CommandId | (string & {}); checked?: boolean }) {
  useT();
  useShortcuts();
  const cmd = findCommand(id);
  if (!cmd) return null;
  const enabled = !cmd.enabled || cmd.enabled();
  const shortcut = commandShortcut(id);
  return (
    <Menu.Item className="menu-item" disabled={!enabled} onSelect={() => void runCommand(id)}>
      <span className="menu-check">{checked ? '✓' : ''}</span>
      <span className="menu-label">{commandTitle(cmd)}</span>
      {shortcut && <span className="menu-shortcut">{formatShortcut(shortcut)}</span>}
    </Menu.Item>
  );
}

function Top({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="menubar-trigger">{label}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="start" sideOffset={2}>
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export const Sep = () => <Menu.Separator className="menu-sep" />;

export function Sub({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger className="menu-item">
        <span className="menu-check" />
        <span className="menu-label">{label}</span>
        <Icon name="chevron" size={12} />
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent className="menu" sideOffset={4}>
          {children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}

/** Éléments d'un menu décrit dans menuSpec. */
export function Nodes({ items }: { items: MenuNode[] }) {
  return (
    <>
      {items.map((n, i) => {
        switch (n.kind) {
          case 'cmd':
            return <Item key={`${n.id}-${i}`} id={n.id} checked={n.checked} />;
          case 'sep':
            return <Sep key={`sep-${i}`} />;
          case 'sub':
            return (
              <Sub key={`sub-${i}`} label={n.label}>
                <Nodes items={n.items} />
              </Sub>
            );
          case 'action':
            return (
              <Menu.Item key={n.key} className="menu-item" data-testid={n.testId} onSelect={n.run}>
                <span className="menu-check">{n.checked ? '✓' : ''}</span>
                <span className="menu-label">{n.label}</span>
                {n.hint && <span className="menu-shortcut">{n.hint}</span>}
              </Menu.Item>
            );
        }
      })}
    </>
  );
}

export function MenuBar() {
  // Re-rend la barre quand ce que montrent les menus change (coches, extensions, langue…).
  useT();
  useShortcuts();
  useUi((s) => s.settings);
  useUi((s) => s.persona);
  useUi((s) => s.softProof);
  useStore(pixelStore, (s) => s.quickMask);
  useWorkspaces((s) => s.list);
  useActiveWorkspace();
  usePanels((s) => s.tabs);
  useSyncExternalStore(subscribeCommands, commandsVersion);
  return (
    <nav className="menubar" aria-label="Menu">
      {menuSpec().map((m) => (
        <Top key={m.id} label={m.label}>
          <Nodes items={m.items} />
        </Top>
      ))}
    </nav>
  );
}
