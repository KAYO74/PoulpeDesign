import {
  ARROW_HEADS,
  WIDTH_PROFILES,
  findNode,
  isStyled,
  rgbaToCss,
  type ArrowHead,
  type Stroke,
} from '@poulpe/core';
import { updateSelected } from '../actions';
import { Icon } from '../components/Icon';
import { NumberField, Select, paintPreview } from '../components/fields';
import { useT } from '../i18n';
import { ui, useEditor, useUi } from '../store';
import { addStroke, removeStroke, setStroke, setStrokeAt } from '../vectorActions';

/** Motifs de pointillés prêts à l'emploi, en multiples de l'épaisseur du trait. */
const DASHES: { id: string; dash: number[] | undefined; cap?: Stroke['cap'] }[] = [
  { id: 'solid', dash: undefined },
  { id: 'dashed', dash: [3, 2] },
  { id: 'dotted', dash: [0, 2], cap: 'round' },
  { id: 'long', dash: [6, 3] },
  { id: 'dashDot', dash: [4, 2, 0, 2], cap: 'round' },
];

export function StrokePanel() {
  const t = useT();
  const { doc, selection } = useEditor();
  const defaults = useUi((s) => s.defaults);
  const node = selection.length ? findNode(doc, selection[0])?.node : null;
  const stroke = node && isStyled(node) ? node.stroke : defaults.stroke;
  const preset = DASHES.find((d) => JSON.stringify(d.dash) === JSON.stringify(stroke.dash))?.id ?? 'custom';
  const dash = stroke.dash ?? [3, 2];
  const extras = node && isStyled(node) ? (node.strokes ?? []) : [];
  const profileId =
    WIDTH_PROFILES.find((p) => JSON.stringify(p.profile) === JSON.stringify(stroke.profile ?? [1, 1]))?.id ??
    'uniform';
  return (
    <div className="panel-body stroke-panel">
      <div className="picker-row">
        <button
          className="chip ring big"
          style={{ background: paintPreview(stroke.paint) }}
          aria-label={t('color.stroke')}
          title={t('color.stroke')}
          onClick={() => ui.set({ colorTarget: 'stroke' })}
        />
        <NumberField
          label={t('stroke.width')}
          value={stroke.width}
          min={0}
          max={500}
          decimals={1}
          unit="px"
          width={120}
          testId="stroke-width"
          onChange={(w) =>
            node
              ? updateSelected(
                  'history.style',
                  (n) => void (isStyled(n) && (n.stroke = { ...n.stroke, width: w })),
                  { deep: true },
                )
              : ui.set({ defaults: { ...defaults, stroke: { ...defaults.stroke, width: w } } })
          }
        />
      </div>
      <div className="picker-row">
        <Select
          label={t('stroke.style')}
          value={preset}
          options={[
            ...DASHES.map((d) => ({ value: d.id, label: t(`stroke.dash.${d.id}`) })),
            ...(preset === 'custom' ? [{ value: 'custom', label: t('stroke.dash.custom') }] : []),
          ]}
          onChange={(id) => {
            const d = DASHES.find((x) => x.id === id);
            if (d) setStroke({ dash: d.dash, ...(d.cap ? { cap: d.cap } : {}) });
          }}
        />
        {stroke.dash && (
          <>
            <NumberField
              label={t('stroke.dashLength')}
              value={dash[0]}
              min={0}
              max={100}
              decimals={1}
              width={70}
              onChange={(v) => setStroke({ dash: [v, ...dash.slice(1)] })}
            />
            <NumberField
              label={t('stroke.gap')}
              value={dash[1] ?? dash[0]}
              min={0}
              max={100}
              decimals={1}
              width={70}
              onChange={(v) => setStroke({ dash: [dash[0], v, ...dash.slice(2)] })}
            />
          </>
        )}
      </div>
      <div className="picker-row">
        <Select
          label={t('stroke.align')}
          value={stroke.align ?? 'center'}
          testId="stroke-align"
          options={(['center', 'inside', 'outside'] as const).map((a) => ({
            value: a,
            label: t(`stroke.align.${a}`),
          }))}
          onChange={(align) => setStroke({ align: align === 'center' ? undefined : align })}
        />
        <Select
          label={t('stroke.profile')}
          value={profileId}
          testId="stroke-profile"
          options={WIDTH_PROFILES.map((p) => ({ value: p.id, label: t(`stroke.profile.${p.id}`) }))}
          onChange={(id) => {
            const p = WIDTH_PROFILES.find((x) => x.id === id);
            setStroke({
              profile: !p || p.id === 'uniform' ? undefined : [...p.profile],
              profilePos: undefined,
            });
          }}
        />
      </div>
      <div className="picker-row">
        <Select
          label={t('stroke.cap')}
          value={stroke.cap ?? 'round'}
          options={(['butt', 'round', 'square'] as const).map((c) => ({
            value: c,
            label: t(`stroke.cap.${c}`),
          }))}
          onChange={(cap) => setStroke({ cap })}
        />
        <Select
          label={t('stroke.join')}
          value={stroke.join ?? 'round'}
          options={(['miter', 'round', 'bevel'] as const).map((j) => ({
            value: j,
            label: t(`stroke.join.${j}`),
          }))}
          onChange={(join) => setStroke({ join })}
        />
      </div>
      <div className="picker-row">
        <Select<ArrowHead>
          label={t('stroke.start')}
          value={stroke.start ?? 'none'}
          options={ARROW_HEADS.map((a) => ({ value: a, label: t(`stroke.arrow.${a}`) }))}
          onChange={(start) => setStroke({ start: start === 'none' ? undefined : start })}
        />
        <Select<ArrowHead>
          label={t('stroke.end')}
          value={stroke.end ?? 'none'}
          options={ARROW_HEADS.map((a) => ({ value: a, label: t(`stroke.arrow.${a}`) }))}
          onChange={(end) => setStroke({ end: end === 'none' ? undefined : end })}
        />
      </div>
      <div className="panel-sub">
        <span className="panel-sub-title">{t('stroke.extras')}</span>
        <button
          className="icon-btn"
          title={t('stroke.addStroke')}
          aria-label={t('stroke.addStroke')}
          data-testid="stroke-add"
          disabled={!node}
          onClick={() => addStroke()}
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
      {extras.map((s, i) => (
        <div className="picker-row" key={i} data-testid={`stroke-extra-${i}`}>
          <input
            className="swatch-input"
            type="color"
            aria-label={t('stroke.extraColor', { n: i + 1 })}
            value={rgbaToCss(s.paint.type === 'solid' ? s.paint.color : '#ffffff').slice(0, 7)}
            onChange={(e) => setStrokeAt(i, { paint: { type: 'solid', color: e.target.value } })}
          />
          <NumberField
            label={t('stroke.width')}
            value={s.width}
            min={0}
            max={500}
            decimals={1}
            unit="px"
            onChange={(width) => setStrokeAt(i, { width })}
          />
          <button
            className="icon-btn"
            title={t('stroke.removeStroke')}
            aria-label={t('stroke.removeStroke')}
            onClick={() => removeStroke(i)}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}
      <p className="note small">{t('stroke.arrowHint')}</p>
    </div>
  );
}
