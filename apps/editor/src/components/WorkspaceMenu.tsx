import * as Menu from '@radix-ui/react-dropdown-menu';
import { useT } from '../i18n';
import { useActiveWorkspace, useWorkspaces } from '../workspaces';
import { Nodes } from './MenuBar';
import { workspaceNodes } from './menuSpec';
import { Icon } from './Icon';

/** Choix d'un espace de travail personnalisé, à côté des trois Personas intégrées. */
export function WorkspaceMenu() {
  const t = useT();
  const list = useWorkspaces((s) => s.list);
  const active = useActiveWorkspace();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className={`persona workspace-trigger${active ? ' named' : ''}`}
        aria-pressed={!!active}
        title={t('workspace.menu')}
        aria-label={t('workspace.menu')}
        data-testid="workspace-menu"
      >
        {active ? <span className="workspace-name">{active.name}</span> : <Icon name="columns" />}
        <Icon name="chevronDown" size={10} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="start" sideOffset={4}>
          <WorkspaceItems />
          {list.length === 0 && (
            <div className="menu-note" role="note">
              {t('workspace.empty')}
            </div>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Éléments du menu des espaces (barre d'outils et menu Affichage). */
export function WorkspaceItems() {
  useT();
  useWorkspaces((s) => s.list);
  useActiveWorkspace();
  return <Nodes items={workspaceNodes()} />;
}
