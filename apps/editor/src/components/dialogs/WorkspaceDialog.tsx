import { useState } from 'react';
import { useT } from '../../i18n';
import { useUi, type Persona, type ToolId, type ToolsColumns } from '../../store';
import { Icon, type IconName } from '../Icon';
import { TOOL_CATALOG, toolGroupsFor, toolPersona } from '../../toolCatalog';
import { studioTabsAll } from '../../panels/Studio';
import { createWorkspace, deleteWorkspace, editWorkspace, workspaces } from '../../workspaces';
import { Modal } from './Modal';
import { close } from './close';

const BASES: { id: Persona; icon: IconName }[] = [
  { id: 'draw', icon: 'draw' },
  { id: 'photo', icon: 'photo' },
  { id: 'layout', icon: 'layout' },
];

/**
 * Créer ou modifier un espace de travail personnalisé : nom, base (vectoriel, pixel, présentation),
 * outils et panneaux affichés. La disposition actuelle des panneaux est enregistrée avec l'espace.
 */
export function WorkspaceDialog() {
  const t = useT();
  const editId = useUi((s) => s.workspaceEdit);
  const existing = workspaces.get().list.find((w) => w.id === editId) ?? null;
  const persona = useUi((s) => s.persona);
  const columnsNow = useUi((s) => s.settings.toolsColumns);
  const [name, setName] = useState(existing?.name ?? t('workspace.defaultName'));
  const [base, setBase] = useState<Persona>(existing?.base ?? persona);
  const all = TOOL_CATALOG.flatMap((c) => c.tools);
  const allTabs = studioTabsAll().map((tab) => tab.id);
  const baseTools = (b: Persona) => toolGroupsFor(b).flat();
  const [tools, setTools] = useState<ToolId[]>(existing?.tools ?? baseTools(existing?.base ?? persona));
  const [tabs, setTabs] = useState<string[]>(existing?.tabs ?? allTabs);
  const [columns, setColumns] = useState<ToolsColumns>(existing?.toolsColumns ?? columnsNow);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const changeBase = (b: Persona) => {
    setBase(b);
    setTools(baseTools(b));
  };
  const mixed =
    tools.some((id) => toolPersona(id) === 'photo') && tools.some((id) => toolPersona(id) === 'draw');
  const save = () => {
    const keptTools = all.filter((id) => tools.includes(id));
    const keptTabs = allTabs.filter((id) => tabs.includes(id));
    const same = (a: ToolId[], b: ToolId[]) => a.length === b.length && a.every((id) => b.includes(id));
    const draft = {
      name: name.trim() || t('workspace.defaultName'),
      base,
      tools: same(keptTools, baseTools(base)) ? null : keptTools,
      tabs: keptTabs.length === allTabs.length ? null : keptTabs,
      toolsColumns: columns,
    };
    if (existing) editWorkspace(existing.id, draft);
    else createWorkspace(draft);
    close();
  };
  return (
    <Modal title={t(existing ? 'workspace.editTitle' : 'workspace.newTitle')} onClose={close} wide>
      <label className="ws-name">
        <span>{t('workspace.name')}</span>
        <input
          className="text-input"
          value={name}
          data-testid="workspace-name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </label>
      <h4 className="sub">{t('workspace.base')}</h4>
      <div className="ws-bases" role="radiogroup" aria-label={t('workspace.base')}>
        {BASES.map((b) => (
          <button
            key={b.id}
            role="radio"
            aria-checked={base === b.id}
            className={`ws-base${base === b.id ? ' on' : ''}`}
            data-testid={`workspace-base-${b.id}`}
            onClick={() => changeBase(b.id)}
          >
            <Icon name={b.icon} />
            <b>{t(`workspace.base.${b.id}`)}</b>
            <span>{t(`workspace.baseHint.${b.id}`)}</span>
          </button>
        ))}
      </div>
      <h4 className="sub">
        {t('workspace.tools')}
        <span className="ws-count">
          {tools.length} / {all.length}
        </span>
        <button className="link" onClick={() => setTools(baseTools(base))}>
          {t('workspace.baseTools')}
        </button>
        <button className="link" onClick={() => setTools(all)}>
          {t('workspace.all')}
        </button>
        <button className="link" onClick={() => setTools(['select'])}>
          {t('workspace.none')}
        </button>
      </h4>
      <p className="note small">{t('workspace.toolsHint')}</p>
      <div className="ws-catalog">
        {TOOL_CATALOG.map((family) => (
          <div className="ws-family" key={family.id}>
            <span className="ws-family-name">{t(`workspace.family.${family.id}`)}</span>
            <div className="ws-toolgroup">
              {family.tools.map((id) => (
                <button
                  key={id}
                  className="tool"
                  aria-pressed={tools.includes(id)}
                  title={t(`tool.${id}`)}
                  aria-label={t(`tool.${id}`)}
                  data-testid={`workspace-tool-${id}`}
                  onClick={() => setTools(toggle(tools, id))}
                >
                  <Icon name={id as IconName} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {mixed && <p className="note small">{t('workspace.mixedHint')}</p>}
      <h4 className="sub">{t('view.toolsColumns')}</h4>
      <div className="seg" role="group" aria-label={t('view.toolsColumns')}>
        {(['auto', 'one', 'two'] as const).map((c) => (
          <button
            key={c}
            aria-pressed={columns === c}
            data-testid={`workspace-columns-${c}`}
            onClick={() => setColumns(c)}
          >
            {t(`view.toolsColumns.${c}`)}
          </button>
        ))}
      </div>
      <h4 className="sub">{t('workspace.panels')}</h4>
      <div className="ws-tabs">
        {studioTabsAll().map((tab) => (
          <label className="check" key={tab.id}>
            <input
              type="checkbox"
              checked={tabs.includes(tab.id)}
              data-testid={`workspace-tab-${tab.id}`}
              onChange={() => setTabs(toggle(tabs, tab.id))}
            />
            {t(tab.label)}
          </label>
        ))}
      </div>
      <p className="note small">{t('workspace.layoutHint')}</p>
      <footer>
        {existing && (
          <button
            className="btn danger"
            data-testid="workspace-delete"
            onClick={() => {
              deleteWorkspace(existing.id);
              close();
            }}
          >
            <Icon name="trash" />
            {t('workspace.delete')}
          </button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={close}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" data-testid="workspace-save" onClick={save}>
          {t(existing ? 'workspace.save' : 'workspace.create')}
        </button>
      </footer>
    </Modal>
  );
}
