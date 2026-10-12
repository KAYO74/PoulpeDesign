import { useState } from 'react';
import { useT } from '../../i18n';
import { brushSettings, useStore, useUi } from '../../store';
import { DEFAULT_PRESETS, applyPreset, deletePreset, isCurrentPreset, saveCurrentPreset } from './presets';
import { userPresets, type BrushPreset } from './state';

/** Aperçu d'un préréglage : une touche ronde, bord plus ou moins doux, à la taille ramenée. */
function Dab({ p }: { p: BrushPreset }) {
  const r = Math.max(2, Math.min(11, 2 + Math.sqrt(p.size) * 0.9));
  const h = Math.min(99, p.hardness);
  const a = (0.25 + 0.75 * (p.flow / 100)) * (p.opacity / 100);
  return (
    <span
      className="brushes-dab"
      style={{
        width: r * 2,
        height: r * 2,
        opacity: a,
        background: `radial-gradient(circle closest-side, var(--fg) ${h}%, transparent 100%)`,
      }}
    />
  );
}

/** Liste des préréglages du panneau Pinceau (fournis, puis enregistrés), et enregistrement du pinceau actif. */
export function BrushPresets() {
  const t = useT();
  const tool = useUi((s) => s.tool);
  useUi((s) => s.brushes);
  const mine = useStore(userPresets, (s) => s.list);
  const [name, setName] = useState('');
  const b = brushSettings(tool);
  const save = () => {
    if (!name.trim()) return;
    saveCurrentPreset(name);
    setName('');
  };
  return (
    <div className="brushes-presets">
      <div className="brushes-presets-title">{t('brush.presets')}</div>
      <ul role="listbox" aria-label={t('brush.presets')}>
        {[...DEFAULT_PRESETS, ...mine].map((p) => {
          const own = !DEFAULT_PRESETS.includes(p);
          const label = own ? p.name : t(p.name);
          return (
            <li key={p.id} role="option" aria-selected={isCurrentPreset(p, b)}>
              <button
                className="brushes-preset"
                data-testid={`preset-${p.id}`}
                title={`${label} · ${p.size} px · ${p.hardness} % · ${p.opacity} % · ${p.flow} %`}
                onClick={() => applyPreset(p)}
              >
                <span className="brushes-dab-box">
                  <Dab p={p} />
                </span>
                <span className="brushes-preset-name">{label}</span>
                <span className="brushes-preset-size">{p.size}</span>
              </button>
              {own && (
                <button
                  className="ib small"
                  aria-label={t('brush.deletePreset')}
                  title={t('brush.deletePreset')}
                  onClick={() => deletePreset(p.id)}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="brushes-save">
        <input
          className="text-input"
          value={name}
          placeholder={t('brush.presetName')}
          aria-label={t('brush.presetName')}
          data-testid="preset-name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button className="btn small" data-testid="preset-save" disabled={!name.trim()} onClick={save}>
          {t('brush.savePreset')}
        </button>
      </div>
    </div>
  );
}
