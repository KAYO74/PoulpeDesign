import type { ComponentType } from 'react';
import { builderShapes, type ShapeBuilderMode } from '@poulpe/core';
import { PaintSwatches } from '../../components/ContextBar';
import { NumberField, Select, paintPreview } from '../../components/fields';
import { Icon, type IconName } from '../../components/Icon';
import { useT } from '../../i18n';
import { ui, useEditor, useStore, useUi, type ToolId } from '../../store';
import { pathsState, type PathsState, type PenMode } from './state';

/* Barres contextuelles de la plume, du crayon, du pinceau vectoriel, du cutter, du constructeur de
   formes et du remplissage de zone. */

/** Boutons à icône d'un choix exclusif (modes). */
function Modes<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: T;
  options: { id: T; icon: IconName; label: string; key?: string }[];
  onChange: (v: T) => void;
  label: string;
  testId: string;
}) {
  return (
    <>
      <span className="ctx-label">{label}</span>
      <span className="seg" role="group" aria-label={label}>
        {options.map((m) => (
          <button
            key={m.id}
            className="ib small"
            aria-pressed={value === m.id}
            title={m.key ? `${m.label} (${m.key})` : m.label}
            aria-label={m.label}
            data-testid={`${testId}-${m.id}`}
            onClick={() => onChange(m.id)}
          >
            <Icon name={m.icon} size={14} />
          </button>
        ))}
      </span>
    </>
  );
}

/** Case à cocher d'un réglage de ces outils. */
function Check({
  k,
  label,
  tip,
  testId,
}: {
  k: keyof PathsState;
  label: string;
  tip?: string;
  testId: string;
}) {
  const on = useStore(pathsState, (s) => s[k]) as boolean;
  return (
    <label className="check" title={tip}>
      <input
        type="checkbox"
        data-testid={testId}
        checked={on}
        onChange={() => pathsState.set({ [k]: !on })}
      />
      {label}
    </label>
  );
}

/** Curseur de 0 à 100. */
function Range({
  value,
  onChange,
  label,
  testId,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  testId: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        aria-label={label}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

const PEN_MODES: { id: PenMode; icon: IconName }[] = [
  { id: 'pen', icon: 'pen' },
  { id: 'smart', icon: 'penSmart' },
  { id: 'polygon', icon: 'penPolygon' },
  { id: 'line', icon: 'penLine' },
];

function PenBar() {
  const t = useT();
  const mode = useStore(pathsState, (s) => s.penMode);
  return (
    <>
      <PaintSwatches node={null} />
      <Modes
        label={t('paths.mode')}
        value={mode}
        testId="pen-mode"
        options={PEN_MODES.map((m) => ({ ...m, label: t(`paths.pen.${m.id}`) }))}
        onChange={(penMode) => pathsState.set({ penMode })}
      />
      <Check
        k="rubberBand"
        label={t('paths.rubberBand')}
        tip={t('paths.rubberBandTip')}
        testId="pen-rubber-band"
      />
      <span className="ctx-dim">{t(`paths.penHint.${mode}`)}</span>
    </>
  );
}

function PencilBar() {
  const t = useT();
  const smoothing = useUi((s) => s.pencilSmoothing);
  return (
    <>
      <PaintSwatches node={null} />
      <Range
        label={t('ctx.smoothing')}
        value={smoothing}
        testId="pencil-smoothing"
        onChange={(pencilSmoothing) => ui.set({ pencilSmoothing })}
      />
      <Check
        k="pencilAutoClose"
        label={t('paths.autoClose')}
        tip={t('paths.autoCloseTip')}
        testId="pencil-close"
      />
      <Check
        k="pencilPressure"
        label={t('paths.pressure')}
        tip={t('paths.pressureTip')}
        testId="pencil-pressure"
      />
      <Check k="pencilSculpt" label={t('paths.sculpt')} tip={t('paths.sculptTip')} testId="pencil-sculpt" />
      <span className="ctx-dim">{t('paths.pencilHint')}</span>
    </>
  );
}

/** Couleur du pinceau vectoriel : la couleur de contour courante. */
function StrokeChip() {
  const t = useT();
  const stroke = useUi((s) => s.defaults.stroke);
  const target = useUi((s) => s.colorTarget);
  return (
    <>
      <span className="ctx-label">{t('ctx.stroke')}</span>
      <button
        className={`chip ring${target === 'stroke' ? ' on' : ''}`}
        style={{ background: paintPreview(stroke.paint) }}
        aria-label={t('ctx.stroke')}
        title={t('ctx.stroke')}
        onClick={() => ui.set({ colorTarget: 'stroke' })}
      />
    </>
  );
}

function BrushBar() {
  const t = useT();
  const o = useStore(pathsState, (s) => s);
  return (
    <>
      <StrokeChip />
      <NumberField
        label={t('paths.width')}
        value={o.brushWidth}
        min={0.5}
        max={500}
        decimals={1}
        unit="px"
        width={84}
        testId="brush-width"
        onChange={(brushWidth) => pathsState.set({ brushWidth })}
      />
      <NumberField
        label={t('paths.opacity')}
        value={o.brushOpacity}
        min={1}
        max={100}
        unit="%"
        width={76}
        testId="brush-opacity"
        onChange={(brushOpacity) => pathsState.set({ brushOpacity })}
      />
      <Range
        label={t('ctx.smoothing')}
        value={o.brushSmoothing}
        testId="brush-smoothing"
        onChange={(brushSmoothing) => pathsState.set({ brushSmoothing })}
      />
      <NumberField
        label={t('paths.stabilizer')}
        value={o.brushStabilizer}
        min={0}
        max={200}
        unit="px"
        width={76}
        testId="brush-stabilizer"
        onChange={(brushStabilizer) => pathsState.set({ brushStabilizer })}
      />
      <Check
        k="brushPressure"
        label={t('paths.pressure')}
        tip={t('paths.pressureTip')}
        testId="brush-pressure"
      />
      <NumberField
        label={t('paths.taper')}
        value={o.brushTaper}
        min={0}
        max={50}
        unit="%"
        width={70}
        testId="brush-taper"
        onChange={(brushTaper) => pathsState.set({ brushTaper })}
      />
      <span className="ctx-dim">{t('paths.brushHint')}</span>
    </>
  );
}

function KnifeBar() {
  const t = useT();
  return <span className="ctx-dim">{t('paths.knifeHint')}</span>;
}

const BUILDER_MODES: { id: ShapeBuilderMode; icon: IconName; key: string }[] = [
  { id: 'add', icon: 'modeAdd', key: '+' },
  { id: 'subtract', icon: 'modeSubtract', key: '-' },
  { id: 'create', icon: 'duplicate', key: '*' },
];

function BuilderBar() {
  const t = useT();
  const mode = useStore(pathsState, (s) => s.builderMode);
  const { doc, selection } = useEditor();
  // Il faut au moins deux formes fermées sélectionnées.
  const ready = builderShapes(doc, selection).length >= 2;
  return (
    <>
      <Modes
        label={t('paths.mode')}
        value={mode}
        testId="builder-mode"
        options={BUILDER_MODES.map((m) => ({ ...m, label: t(`paths.builder.${m.id}`) }))}
        onChange={(builderMode) => pathsState.set({ builderMode })}
      />
      <span className="ctx-dim">{t(ready ? `paths.builderHint.${mode}` : 'paths.builderNeedsTwo')}</span>
    </>
  );
}

function FillBar() {
  const t = useT();
  const source = useStore(pathsState, (s) => s.fillSource);
  const fill = useUi((s) => s.defaults.fill);
  const target = useUi((s) => s.colorTarget);
  return (
    <>
      <span className="ctx-label">{t('ctx.fill')}</span>
      <button
        className={`chip${target === 'fill' ? ' on' : ''}`}
        style={{ background: paintPreview(fill) }}
        aria-label={t('ctx.fill')}
        title={t('ctx.fill')}
        onClick={() => ui.set({ colorTarget: 'fill' })}
      />
      <Select
        label={t('paths.fillSource')}
        value={source}
        testId="fill-source"
        options={(['all', 'selection'] as const).map((v) => ({
          value: v,
          label: t(`paths.fillSource.${v}`),
        }))}
        onChange={(fillSource) => pathsState.set({ fillSource })}
      />
      <span className="ctx-dim">{t('paths.fillHint')}</span>
    </>
  );
}

export const contexts: Partial<Record<ToolId, ComponentType>> = {
  pen: PenBar,
  pencil: PencilBar,
  vectorBrush: BrushBar,
  knife: KnifeBar,
  shapeBuilder: BuilderBar,
  vectorFill: FillBar,
};
