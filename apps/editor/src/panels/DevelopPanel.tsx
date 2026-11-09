import { useState } from 'react';
import { DEVELOP_BANDS, defaultDevelop, type Adjustment, type Develop } from '@poulpe/core';
import { useT } from '../i18n';
import { addAdjustment, selectedAdjustment, setAdjustment } from '../photo/photoActions';
import { useEditor } from '../store';
import { ParamField } from './AdjustmentPanel';
import { P, type Param } from './params';

/*
 * Onglet Développer : les réglages d'une photo réunis comme dans le module Développement de
 * Lightroom (balance des blancs, tons, présence, couleur par plage). Tout vit dans un seul
 * calque de réglage « Développer », non destructif, créé au premier curseur déplacé.
 */

const WHITE_BALANCE: Param[] = [P('temperature', -100, 100), P('tint', -100, 100)];
const TONES: Param[] = [
  P('exposure', -5, 5, 'IL', 0.05),
  P('contrast', -100, 100),
  P('highlights', -100, 100),
  P('shadows', -100, 100),
  P('whites', -100, 100),
  P('blacks', -100, 100),
];
const PRESENCE: Param[] = [P('vibrance', -100, 100), P('saturation', -100, 100)];
const BAND_CHANNELS: { key: 'hue' | 'sat' | 'lum'; label: string }[] = [
  { key: 'hue', label: 'param.hue' },
  { key: 'sat', label: 'param.saturation' },
  { key: 'lum', label: 'param.lightness' },
];
/** Couleur d'aperçu de chaque plage. */
const BAND_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e66f5', '#8e24aa', '#d81b8c'];

export function DevelopControls({
  adj,
  onChange,
}: {
  adj: Develop;
  onChange: (patch: Partial<Adjustment>, live: boolean) => void;
}) {
  const t = useT();
  const [band, setBand] = useState(0);
  const values = adj as unknown as Record<string, number>;
  const section = (title: string, params: Param[]) => (
    <fieldset className="tone" data-testid={`develop-${title}`}>
      <legend>{t(`develop.${title}`)}</legend>
      {params.map((p) => (
        <ParamField
          key={p.key}
          p={p}
          value={values[p.key]}
          onChange={(v, live) => onChange({ [p.key]: v } as Partial<Adjustment>, live)}
        />
      ))}
    </fieldset>
  );
  return (
    <>
      {section('whiteBalance', WHITE_BALANCE)}
      {section('tones', TONES)}
      {section('presence', PRESENCE)}
      <fieldset className="tone" data-testid="develop-color">
        <legend>{t('develop.color')}</legend>
        <span className="seg develop-bands" role="group" aria-label={t('develop.band')}>
          {DEVELOP_BANDS.map((name, i) => (
            <button
              key={name}
              className="btn small develop-band"
              aria-pressed={band === i}
              title={t(`band.${name}`)}
              aria-label={t(`band.${name}`)}
              data-testid={`develop-band-${name}`}
              onClick={() => setBand(i)}
            >
              <span className="develop-dot" style={{ background: BAND_COLORS[i] }} />
            </button>
          ))}
        </span>
        {BAND_CHANNELS.map((c) => (
          <ParamField
            key={c.key}
            p={{ ...P(`band-${c.key}`, -100, 100, '', 1, c.label) }}
            value={adj[c.key][band] ?? 0}
            onChange={(v, live) => {
              const next = [...adj[c.key]];
              next[band] = v;
              onChange({ [c.key]: next } as Partial<Adjustment>, live);
            }}
          />
        ))}
      </fieldset>
    </>
  );
}

/** Onglet Développer : modifie le calque « Développer » sélectionné, ou en crée un. */
export function DevelopPanel() {
  const t = useT();
  useEditor();
  const node = selectedAdjustment();
  const current = node?.adjustment.kind === 'develop' ? node : null;
  const adj = current?.adjustment.kind === 'develop' ? current.adjustment : defaultDevelop();
  const change = (patch: Partial<Adjustment>, live: boolean) => {
    const sel = selectedAdjustment();
    if (sel && sel.adjustment.kind === 'develop') setAdjustment(sel.id, patch, live);
    else addAdjustment('develop', { ...defaultDevelop(), ...patch } as Adjustment);
  };
  return (
    <div className="panel-body adjust-panel" data-testid="develop-panel">
      <div className="adjust-title">
        <b>{t('adjust.develop')}</b>
        <span className="spacer" />
        {current && (
          <button
            className="btn small"
            data-testid="develop-reset"
            onClick={() => setAdjustment(current.id, defaultDevelop(), false)}
          >
            {t('develop.reset')}
          </button>
        )}
      </div>
      {!current && <p className="note">{t('develop.hint')}</p>}
      <DevelopControls adj={adj} onChange={change} />
    </div>
  );
}
