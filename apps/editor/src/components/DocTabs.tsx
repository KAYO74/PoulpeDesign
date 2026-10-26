import { useT } from '../i18n';
import { closeTab, openTab, switchTab, tabInfo, useTabs } from '../docTabs';
import { baseName } from '../io';
import { ui, useEditor, useUi } from '../store';
import { Icon } from './Icon';

/** Onglets des documents ouverts, avec « + » pour en ouvrir un nouveau. */
export function DocTabs() {
  const t = useT();
  const { tabs, activeId } = useTabs();
  // Relit l'onglet actif quand son nom, son fichier ou son état « modifié » changent.
  useEditor();
  useUi((s) => s.filePath);
  return (
    <div className="doc-tabs" role="tablist">
      {tabs.map((tab) => {
        const info = tabInfo(tab);
        const name = info.filePath ? baseName(info.filePath) : info.name;
        const active = tab.id === activeId;
        return (
          <span
            key={tab.id}
            className="doc-tab"
            role="tab"
            aria-selected={active}
            tabIndex={0}
            data-testid="doc-tab"
            onClick={() => switchTab(tab.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && switchTab(tab.id)}
          >
            {info.dirty && <span className="dot" aria-hidden="true" />}
            <span className="doc-tab-name">{name}</span>
            <button
              className="doc-tab-close"
              aria-label={t('tabs.close')}
              title={t('tabs.close')}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        );
      })}
      <button
        className="doc-tab-new"
        aria-label={t('tabs.new')}
        title={t('tabs.new')}
        data-testid="doc-tab-new"
        onClick={() => {
          openTab();
          // Comme dans Affinity : le nouvel onglet propose tout de suite la taille du document.
          ui.set({ dialog: 'new' });
        }}
      >
        <Icon name="plus" size={12} />
      </button>
    </div>
  );
}
