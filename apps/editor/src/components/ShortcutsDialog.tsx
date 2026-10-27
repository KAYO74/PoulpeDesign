import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  toolKeysFor,
  allCommands,
  commandShortcut,
  commandTitle,
  commandsVersion,
  formatShortcut,
  subscribeCommands,
} from '../commands';
import { getLang, useT, type MessageKey } from '../i18n';
import { eventToShortcut, isCustomized, resetShortcut, setShortcut, useShortcuts } from '../shortcuts';
import { setSettings, toast, ui, useUi } from '../store';
import { KEY_PRESETS } from '../toolKeyPresets';
import { Select } from './fields';
import { Modal } from './Dialogs';

const close = () => ui.set({ dialog: null });

/** Sections de la liste, dans l'ordre des menus ; le préfixe de l'identifiant de commande décide. */
const SECTIONS: [string, MessageKey][] = [
  ['file', 'menu.file'],
  ['edit', 'menu.edit'],
  ['select', 'menu.select'],
  ['view', 'menu.view'],
  ['layer', 'menu.layer'],
  ['arrange', 'menu.arrange'],
  ['text', 'menu.text'],
  ['adjust', 'menu.adjust'],
  ['filter', 'menu.filters'],
  ['help', 'menu.help'],
];
const sectionOf = (id: string) => {
  const prefix = id.split('.')[0] === 'livefilter' ? 'filter' : id.split('.')[0];
  return SECTIONS.some(([p]) => p === prefix) ? prefix : 'other';
};

/**
 * Aide > Raccourcis clavier : la liste de toutes les commandes (menus, macros, extensions), et
 * pour chacune un raccourci à changer d'un clic puis d'une touche, comme dans Affinity.
 */
export function ShortcutsDialog() {
  const t = useT();
  return (
    <Modal title={t('shortcuts.title')} onClose={close} wide>
      <ShortcutsEditor />
    </Modal>
  );
}

/**
 * La liste des raccourcis, à modifier. `only` : ne montrer que ces commandes (sans les outils),
 * par exemple celles de l'ordre des calques dans Préférences > Calques.
 */
export function ShortcutsEditor({ only }: { only?: string[] }) {
  const t = useT();
  useShortcuts();
  const [query, setQuery] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  const persona = ui.get().persona;
  const settings = useUi((s) => s.settings);
  const tools = toolKeysFor(persona);

  const version = useSyncExternalStore(subscribeCommands, commandsVersion);
  const rows = useMemo(
    () =>
      allCommands().map(([id, cmd]) => {
        // Réglages et filtres portent les mêmes noms : on précise le menu.
        const menu = id.startsWith('filter.')
          ? 'menu.filters'
          : id.startsWith('livefilter.')
            ? 'menu.layerLiveFilters'
            : id.startsWith('adjust.')
              ? 'menu.adjust'
              : null;
        const title = commandTitle(cmd);
        return { id, cmd, title: menu ? `${title} (${t(menu)})` : title };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, version, getLang()],
  );
  const q = query.trim().toLowerCase();
  const listed = only ? only.flatMap((id) => rows.filter((r) => r.id === id)) : rows;
  const shown = q
    ? listed.filter(
        (r) => r.title.toLowerCase().includes(q) || (commandShortcut(r.id) ?? '').toLowerCase().includes(q),
      )
    : listed;

  const capture = (id: string, e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setCapturing(null);
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setShortcut(id, null);
      setCapturing(null);
      return;
    }
    const s = eventToShortcut(e.nativeEvent);
    if (!s) return;
    // Sans Ctrl ni Alt, une lettre seule est réservée aux outils.
    if (/^(Shift\+)?[A-Z0-9]$/.test(s)) {
      toast(t('shortcuts.needModifier'));
      return;
    }
    const persona = rows.find((r) => r.id === id)?.cmd.persona;
    for (const r of rows)
      if (r.id !== id && commandShortcut(r.id) === s && (r.cmd.persona ?? null) === (persona ?? null)) {
        setShortcut(r.id, null);
        toast(t('shortcuts.reassigned', { name: r.title }));
      }
    setShortcut(id, s);
    setCapturing(null);
  };

  return (
    <>
      <p className="note">{t('shortcuts.hint')}</p>
      {!only && (
        <div className="picker-row">
          <Select
            label={t('shortcuts.preset')}
            testId="key-preset"
            value={settings.keyPreset}
            onChange={(v) => setSettings({ keyPreset: v })}
            options={KEY_PRESETS.map((p) => ({ value: p, label: t(`shortcuts.preset.${p}`) }))}
          />
        </div>
      )}
      {!only && (
        <div className="picker-row">
          <input
            className="search"
            type="search"
            placeholder={t('shortcuts.search')}
            aria-label={t('shortcuts.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="spacer" />
          <button className="btn" onClick={() => resetShortcut()}>
            {t('shortcuts.resetAll')}
          </button>
        </div>
      )}
      <div className={`shortcuts${only ? ' only' : ''}`}>
        {!only && <h4 className="shortcut-section">{t('shortcuts.section.tools')}</h4>}
        {!only && (
          <table>
            <tbody>
              {Object.entries(tools).map(([k, list]) => (
                <tr key={k}>
                  <td>{list.map((tool) => t(`tool.${tool}`)).join(', ')}</td>
                  <td>
                    <kbd>{k.toUpperCase()}</kbd>
                  </td>
                </tr>
              ))}
              <tr>
                <td>{t('tool.hand')}</td>
                <td>
                  <kbd>{t('shortcuts.space')}</kbd>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {[...SECTIONS, ['other', 'shortcuts.section.other' as MessageKey] as [string, MessageKey]].map(
          ([sec, label]) => {
            const list = shown.filter((r) => sectionOf(r.id) === sec);
            if (!list.length) return null;
            return (
              <section key={sec} data-testid={`shortcut-section-${sec}`}>
                {!only && <h4 className="shortcut-section">{t(label)}</h4>}
                <table className="shortcut-edit">
                  <tbody>
                    {list.map(({ id, title }) => {
                      const s = commandShortcut(id);
                      return (
                        <tr key={id}>
                          <td>{title}</td>
                          <td>
                            <button
                              className={`kbd-btn${capturing === id ? ' capturing' : ''}`}
                              data-testid={`shortcut-${id}`}
                              onClick={() => setCapturing(id)}
                              onBlur={() => capturing === id && setCapturing(null)}
                              onKeyDown={(e) => capturing === id && capture(id, e)}
                            >
                              {capturing === id ? t('shortcuts.press') : s ? formatShortcut(s) : '—'}
                            </button>
                            {isCustomized(id) && (
                              <button className="link" onClick={() => resetShortcut(id)}>
                                {t('shortcuts.reset')}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          },
        )}
      </div>
    </>
  );
}
