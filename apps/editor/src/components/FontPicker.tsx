import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { fontCategory, fontHasBold, type FontCategory } from '../fonts';
import { useT, type MessageKey } from '../i18n';
import { Icon } from './Icon';

type Filter = 'all' | FontCategory | 'bold';

const FILTERS: [Filter, MessageKey][] = [
  ['all', 'fontpick.all'],
  ['serif', 'fontpick.serif'],
  ['sans', 'fontpick.sans'],
  ['script', 'fontpick.script'],
  ['mono', 'fontpick.mono'],
  ['bold', 'fontpick.bold'],
];

const quoted = (f: string) => `"${f}", sans-serif`;

/**
 * Choix de la police : un champ de recherche, des filtres (serif, sans serif, écriture, chasse
 * fixe, gras) et chaque nom écrit dans sa propre police, pour voir l'aperçu avant de choisir.
 */
export function FontPicker({
  value,
  fonts,
  onChange,
  label,
  width,
  testId,
}: {
  value: string;
  fonts: string[];
  onChange: (family: string) => void;
  label?: string;
  width?: number;
  testId?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fonts.filter(
      (f) =>
        (!q || f.toLowerCase().includes(q)) &&
        (filter === 'all' || (filter === 'bold' ? fontHasBold(f) : fontCategory(f) === filter)),
    );
  }, [fonts, query, filter]);
  const pick = (f: string) => {
    onChange(f);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="field select-field"
        style={width ? { width } : undefined}
        data-testid={testId}
        data-value={value}
        aria-label={label}
      >
        {label && <span className="field-label">{label}</span>}
        <span className="select-value" style={{ fontFamily: quoted(value) }}>
          {value}
        </span>
        <Icon name="chevronDown" size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="font-pop"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          data-testid="font-pop"
          onKeyDown={(e) => e.key === 'Escape' && e.stopPropagation()}
        >
          <input
            className="search"
            type="search"
            autoFocus
            placeholder={t('fontpick.search')}
            aria-label={t('fontpick.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="font-filters" role="group">
            {FILTERS.map(([id, key]) => (
              <button
                key={id}
                className="font-chip"
                aria-pressed={filter === id}
                data-testid={`font-filter-${id}`}
                onClick={() => setFilter(id)}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <div className="font-list" role="listbox" aria-label={label}>
            {shown.map((f) => (
              <button
                key={f}
                role="option"
                aria-selected={f === value}
                className="font-opt"
                data-value={f}
                style={{ fontFamily: quoted(f) }}
                onClick={() => pick(f)}
              >
                <span>{f}</span>
                {f === value && <Icon name="check" size={12} />}
              </button>
            ))}
            {!shown.length && <p className="empty">{t('fontpick.none')}</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
