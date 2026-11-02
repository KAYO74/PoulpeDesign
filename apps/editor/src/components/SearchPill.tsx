import { commandShortcut, formatShortcut, runCommand } from '../commands';
import { useT } from '../i18n';
import { Icon } from './Icon';

/** Champ de recherche de la barre de titre : ouvre « Que voulez-vous faire ? » (Ctrl+K). */
export function SearchPill() {
  const t = useT();
  const shortcut = formatShortcut(commandShortcut('help.search') ?? '');
  return (
    <button
      className="search-pill"
      data-testid="search-pill"
      title={`${t('help.search')} (${shortcut})`}
      aria-label={t('help.search')}
      onClick={() => void runCommand('help.search')}
    >
      <Icon name="search" size={13} />
      <span className="search-pill-text">{t('search.pill')}</span>
      <kbd>{shortcut}</kbd>
    </button>
  );
}
