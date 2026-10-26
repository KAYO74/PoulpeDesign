import { useEffect, useMemo, useRef, useState } from 'react';
import { allCommands, commandShortcut, commandTitle, formatShortcut, runCommand } from '../../commands';
import { t as tr, useT } from '../../i18n';
import { setPersona } from '../../photo/persona';
import { ui, type ToolId } from '../../store';
import { TOOL_CATALOG, toolPersona } from '../../toolCatalog';
import { ICON_PATHS, Icon, type IconName } from '../Icon';
import { pickTool } from '../ToolColumn';
import { Modal } from './Modal';
import { close } from './close';

/*
 * « Que voulez-vous faire ? » (Ctrl+K) : un champ qui retrouve n'importe quel outil ou action de
 * l'éditeur par son nom, sans chercher dans les menus ni dans la colonne d'outils.
 */

interface Entry {
  key: string;
  kind: 'tool' | 'command';
  title: string;
  shortcut?: string;
  icon?: IconName;
  run: () => void;
}

/** Minuscules, sans accents. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Un outil du catalogue : la Persona qu'il demande est ouverte si besoin. */
function chooseTool(id: ToolId): void {
  const need = toolPersona(id);
  const persona = ui.get().persona;
  if (need === 'photo' && persona !== 'photo') setPersona('photo');
  else if (need === 'draw' && persona === 'photo') setPersona('draw');
  pickTool(id);
}

function entries(): Entry[] {
  const persona = ui.get().persona;
  const tools = [...new Set(TOOL_CATALOG.flatMap((g) => g.tools))].map((id): Entry => ({
    key: `tool:${id}`,
    kind: 'tool',
    title: tr(`tool.${id}`),
    icon: id in ICON_PATHS ? (id as IconName) : undefined,
    run: () => chooseTool(id),
  }));
  const commands = allCommands()
    .filter(([, c]) => (!c.persona || c.persona === persona) && (!c.enabled || c.enabled()))
    .filter(([id]) => id !== 'help.search')
    .map(([id, c]): Entry => ({
      key: `cmd:${id}`,
      kind: 'command',
      title: commandTitle(c),
      shortcut: commandShortcut(id),
      run: () => void runCommand(id),
    }));
  return [...tools, ...commands];
}

/** Rang d'une entrée pour la recherche : 0 = commence par la recherche, 1 = contient tous les mots, sinon exclue. */
function rank(title: string, words: string[], q: string): number | null {
  const f = fold(title);
  if (!words.every((w) => f.includes(w))) return null;
  return f.startsWith(q) || f.split(/[\s'’()—-]+/).some((w) => w.startsWith(q)) ? 0 : 1;
}

export function CommandPalette() {
  const t = useT();
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const all = useMemo(entries, []);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const query = fold(q).trim();
    if (!query) return all.filter((e) => e.kind === 'command').slice(0, 30);
    const words = query.split(/\s+/);
    return all
      .map((e) => ({ e, r: rank(e.title, words, query) }))
      .filter((x): x is { e: Entry; r: number } => x.r !== null)
      .sort((a, b) => a.r - b.r || a.e.title.localeCompare(b.e.title))
      .map((x) => x.e)
      .slice(0, 40);
  }, [all, q]);

  const input = useRef<HTMLInputElement>(null);
  // Le cadre des fenêtres met le focus sur son premier bouton : le champ le reprend ensuite.
  useEffect(() => {
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const run = (e: Entry | undefined) => {
    if (!e) return;
    close();
    // La fenêtre se ferme d'abord : une action qui ouvre sa propre fenêtre la garde ouverte.
    setTimeout(e.run, 0);
  };

  return (
    <Modal title={t('palette.title')} onClose={close}>
      <input
        className="text-input palette-input"
        ref={input}
        value={q}
        placeholder={t('palette.placeholder')}
        aria-label={t('palette.title')}
        data-testid="palette-input"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setAt((i) => Math.min(shown.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setAt((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter') run(shown[at]);
          else return;
          e.preventDefault();
        }}
      />
      <div className="palette-list" role="listbox" ref={list}>
        {shown.map((e, i) => (
          <div
            key={e.key}
            role="option"
            aria-selected={i === at}
            className="palette-item"
            data-testid={`palette-${e.key}`}
            onMouseMove={() => setAt(i)}
            onClick={() => run(e)}
          >
            {e.icon ? <Icon name={e.icon} /> : <span className="palette-dot" />}
            <span className="palette-title">{e.title}</span>
            <span className="palette-kind">{t(e.kind === 'tool' ? 'palette.tool' : 'palette.command')}</span>
            {e.shortcut && <kbd>{formatShortcut(e.shortcut)}</kbd>}
          </div>
        ))}
        {!shown.length && <p className="palette-none">{t('palette.none')}</p>}
      </div>
      <p className="note">{t('palette.hint')}</p>
    </Modal>
  );
}
