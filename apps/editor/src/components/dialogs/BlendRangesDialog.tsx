import { useEffect, useState } from 'react';
import { findNode, FULL_RANGE, type BlendRanges } from '@poulpe/core';
import { useT } from '../../i18n';
import { editor, ui } from '../../store';
import { Modal } from './Modal';

type Range = BlendRanges['layer'];

/** Calques sélectionnés qui peuvent avoir des plages de fusion. */
export function blendTargets(): string[] {
  return editor.selection.filter((id) => {
    const n = findNode(editor.doc, id)?.node;
    return n && n.type !== 'adjustment';
  });
}

/** Calque › Plages de fusion… : ouvre la fenêtre, dans un geste de l'éditeur (aperçu en direct). */
export function openBlendRanges(): void {
  if (!blendTargets().length) return;
  editor.begin();
  ui.set({ dialog: 'blendRanges' });
}

function close(keep: boolean) {
  ui.set({ dialog: null });
  if (keep) editor.commit('history.blendRanges');
  else editor.cancel();
}

/** Barre de dégradé noir → blanc avec quatre poignées (début et fin du noir, du blanc). */
function RangeBar({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: Range;
  onChange: (r: Range) => void;
  testId: string;
}) {
  const t = useT();
  const names = ['blend.blackStart', 'blend.blackEnd', 'blend.whiteStart', 'blend.whiteEnd'] as const;
  return (
    <div className="blend-range" data-testid={testId}>
      <span className="field-label">{label}</span>
      <div className="blend-range-bar">
        {value.map((v, i) => (
          <input
            key={i}
            type="range"
            min={0}
            max={255}
            value={v}
            aria-label={`${label} · ${t(names[i])}`}
            onChange={(e) => {
              const next = [...value] as Range;
              next[i] = Number(e.target.value);
              // Les poignées restent dans l'ordre : noir début ≤ noir fin ≤ blanc début ≤ blanc fin.
              for (let k = i + 1; k < 4; k++) next[k] = Math.max(next[k], next[i]);
              for (let k = i - 1; k >= 0; k--) next[k] = Math.min(next[k], next[i]);
              onChange(next);
            }}
          />
        ))}
      </div>
      <span className="blend-range-values num">
        {value[0] === value[1] ? value[0] : `${value[0]}/${value[1]}`} ·{' '}
        {value[2] === value[3] ? value[2] : `${value[2]}/${value[3]}`}
      </span>
    </div>
  );
}

/** Plages de fusion du calque : « Ce calque » et « Calque du dessous », avec aperçu. */
export function BlendRangesDialog() {
  const t = useT();
  const [ids] = useState(blendTargets);
  const [r, setR] = useState<BlendRanges>(() => {
    const n = findNode(editor.doc, ids[0])?.node;
    return n?.blendRanges
      ? structuredClone(n.blendRanges)
      : { layer: [...FULL_RANGE], under: [...FULL_RANGE] };
  });
  useEffect(() => {
    editor.preview((d) => {
      for (const id of ids) {
        const n = findNode(d, id)?.node;
        if (!n) continue;
        const full = (x: Range) => x[0] === 0 && x[1] === 0 && x[2] === 255 && x[3] === 255;
        if (full(r.layer) && full(r.under)) delete n.blendRanges;
        else n.blendRanges = structuredClone(r);
      }
    });
  }, [ids, r]);
  return (
    <Modal title={t('blend.title')} onClose={() => close(false)}>
      <p className="note">{t('blend.hint')}</p>
      <RangeBar
        label={t('blend.layer')}
        value={r.layer}
        testId="blend-layer"
        onChange={(layer) => setR({ ...r, layer })}
      />
      <RangeBar
        label={t('blend.under')}
        value={r.under}
        testId="blend-under"
        onChange={(under) => setR({ ...r, under })}
      />
      <footer>
        <button className="btn" onClick={() => setR({ layer: [...FULL_RANGE], under: [...FULL_RANGE] })}>
          {t('param.reset')}
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => close(false)}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" data-testid="blend-apply" onClick={() => close(true)}>
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}
