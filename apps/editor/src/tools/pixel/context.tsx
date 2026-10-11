import { Icon } from '../../components/Icon';
import { Slider } from '../../components/PhotoContext';
import { NumberField, Select } from '../../components/fields';
import { useT } from '../../i18n';
import { brushSettings, setBrush, ui, useStore, useUi, type ToolId } from '../../store';
import { crop } from './crop';
import { quickMaskOn, toggleQuickMask } from './quickMask';
import { pixelStore, type CropOverlay, type CropRatio, type PixelToolState } from './store';

/* Barres contextuelles des outils de pixels de la version 1.2. */

const set = (patch: Partial<PixelToolState>) => pixelStore.set(patch);

function Check({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** Couleur principale (et secondaire), comme dans la barre du pinceau. */
function Colors({ second }: { second?: boolean }) {
  const t = useT();
  const c1 = useUi((s) => s.brushColor);
  const c2 = useUi((s) => s.brushColor2);
  return (
    <>
      <label className="field">
        <span className="field-label">{t('ctx.primary')}</span>
        <input
          type="color"
          className="color-input"
          value={c1.slice(0, 7)}
          aria-label={t('ctx.primary')}
          onChange={(e) => ui.set({ brushColor: e.target.value })}
        />
      </label>
      {second && (
        <>
          <button
            className="ib small"
            title={`${t('pixel.swapColors')} (X)`}
            aria-label={t('pixel.swapColors')}
            onClick={() => ui.set((s) => ({ brushColor: s.brushColor2, brushColor2: s.brushColor }))}
          >
            <Icon name="swap" size={14} />
          </button>
          <label className="field">
            <span className="field-label">{t('pixel.secondary')}</span>
            <input
              type="color"
              className="color-input"
              value={c2.slice(0, 7)}
              aria-label={t('pixel.secondary')}
              onChange={(e) => ui.set({ brushColor2: e.target.value })}
            />
          </label>
        </>
      )}
    </>
  );
}

/** Taille, dureté, opacité (ou force) et flux du pinceau de l'outil. */
function BrushSliders({
  tool,
  strength,
  sizeOnly,
}: {
  tool: ToolId;
  strength?: boolean;
  sizeOnly?: boolean;
}) {
  const t = useT();
  useUi((s) => s.brushes);
  const b = brushSettings(tool);
  return (
    <>
      <Slider
        label={t('ctx.size')}
        value={b.size}
        min={1}
        max={1000}
        unit="px"
        testId="brush-size"
        onChange={(size) => setBrush({ size }, tool)}
      />
      {!sizeOnly && (
        <>
          <Slider
            label={t('ctx.hardness')}
            value={b.hardness}
            min={0}
            max={100}
            unit="%"
            onChange={(hardness) => setBrush({ hardness }, tool)}
          />
          <Slider
            label={t(strength ? 'ctx.strength' : 'ctx.opacity')}
            value={b.opacity}
            min={1}
            max={100}
            unit="%"
            testId="brush-opacity"
            onChange={(opacity) => setBrush({ opacity }, tool)}
          />
          <Slider
            label={t('ctx.flow')}
            value={b.flow}
            min={1}
            max={100}
            unit="%"
            onChange={(flow) => setBrush({ flow }, tool)}
          />
        </>
      )}
    </>
  );
}

function Tolerance({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useT();
  return (
    <Slider
      label={t('ctx.tolerance')}
      value={value}
      min={0}
      max={255}
      testId="tolerance"
      onChange={onChange}
    />
  );
}

const RATIOS: CropRatio[] = ['free', 'original', '1:1', '4:3', '3:2', '16:9', 'custom'];
const OVERLAYS: CropOverlay[] = ['none', 'thirds', 'grid', 'golden'];

export function CropContext() {
  const t = useT();
  const s = useStore(pixelStore, (x) => x);
  const r = s.cropRect;
  const setRatio = (patch: Partial<PixelToolState>) => {
    set(patch);
    crop.fitRatio();
  };
  return (
    <>
      <Select
        label={t('pixel.crop.ratio')}
        value={s.cropRatio}
        testId="crop-ratio"
        options={RATIOS.map((v) => ({ value: v, label: t(`pixel.crop.ratio.${v}`) }))}
        onChange={(cropRatio) => setRatio({ cropRatio })}
      />
      {s.cropRatio === 'custom' && (
        <>
          <NumberField
            value={s.cropW}
            min={1}
            max={100000}
            width={70}
            testId="crop-ratio-w"
            onChange={(cropW) => setRatio({ cropW })}
          />
          <span className="ctx-dim">×</span>
          <NumberField
            value={s.cropH}
            min={1}
            max={100000}
            width={70}
            testId="crop-ratio-h"
            onChange={(cropH) => setRatio({ cropH })}
          />
        </>
      )}
      {s.cropRatio !== 'free' && (
        <button
          className="ib small"
          title={t('pixel.crop.swap')}
          aria-label={t('pixel.crop.swap')}
          onClick={() =>
            s.cropRatio === 'custom'
              ? setRatio({ cropW: s.cropH, cropH: s.cropW })
              : setRatio({ cropPortrait: !s.cropPortrait })
          }
        >
          <Icon name="swap" size={14} />
        </button>
      )}
      <Select
        label={t('pixel.crop.overlay')}
        value={s.cropOverlay}
        options={OVERLAYS.map((v) => ({ value: v, label: t(`pixel.crop.overlay.${v}`) }))}
        onChange={(cropOverlay) => set({ cropOverlay })}
      />
      <button
        className="btn small"
        aria-pressed={s.cropStraighten}
        data-testid="crop-straighten"
        title={t('pixel.crop.straightenHint')}
        onClick={() => set({ cropStraighten: !s.cropStraighten })}
      >
        <Icon name="straighten" size={14} /> {t('pixel.crop.straighten')}
      </button>
      <NumberField
        label={t('pixel.crop.angle')}
        value={s.cropAngle}
        min={-45}
        max={45}
        step={0.1}
        decimals={2}
        unit="°"
        width={80}
        testId="crop-angle"
        onChange={(v) => crop.setAngle(v)}
      />
      {r && (
        <span className="ctx-dim" data-testid="crop-size">
          {Math.round(r.width)} × {Math.round(r.height)} px
        </span>
      )}
      <button className="btn small" data-testid="crop-reset" onClick={() => crop.reset()}>
        {t('pixel.crop.reset')}
      </button>
      <button className="btn small" onClick={() => crop.cancel()}>
        {t('new.cancel')}
      </button>
      <button className="btn small primary" data-testid="crop-apply" onClick={() => crop.apply()}>
        {t('filter.apply')}
      </button>
    </>
  );
}

const KINDS = ['linear', 'radial', 'elliptical', 'conical'] as const;

export function GradientContext() {
  const t = useT();
  const s = useStore(pixelStore, (x) => x);
  return (
    <>
      <Colors second />
      <Select
        label={t('pixel.gradient.kind')}
        value={s.gradientKind}
        testId="gradient-kind"
        options={KINDS.map((k) => ({ value: k, label: t(`pixel.gradient.${k}`) }))}
        onChange={(gradientKind) => set({ gradientKind })}
      />
      {s.gradientKind === 'elliptical' && (
        <Slider
          label={t('pixel.gradient.aspect')}
          value={s.gradientAspect}
          min={5}
          max={100}
          unit="%"
          onChange={(gradientAspect) => set({ gradientAspect })}
        />
      )}
      <Slider
        label={t('ctx.opacity')}
        value={s.gradientOpacity}
        min={1}
        max={100}
        unit="%"
        testId="gradient-opacity"
        onChange={(gradientOpacity) => set({ gradientOpacity })}
      />
      <Check
        label={t('pixel.gradient.reverse')}
        checked={s.gradientReverse}
        testId="gradient-reverse"
        onChange={(gradientReverse) => set({ gradientReverse })}
      />
      <span className="ctx-dim">{t('pixel.gradient.hint')}</span>
    </>
  );
}

export function SpongeContext() {
  const t = useT();
  const mode = useStore(pixelStore, (x) => x.spongeMode);
  return (
    <>
      <Select
        label={t('ctx.mode')}
        value={mode}
        testId="sponge-mode"
        options={(['desaturate', 'saturate'] as const).map((m) => ({
          value: m,
          label: t(`pixel.sponge.${m}`),
        }))}
        onChange={(spongeMode) => set({ spongeMode })}
      />
      <BrushSliders tool="sponge" strength />
    </>
  );
}

export function BackgroundEraserContext() {
  const t = useT();
  const s = useStore(pixelStore, (x) => x);
  return (
    <>
      <BrushSliders tool="backgroundEraser" />
      <Tolerance value={s.bgTolerance} onChange={(bgTolerance) => set({ bgTolerance })} />
      <Check
        label={t('pixel.continuous')}
        checked={s.bgContinuous}
        onChange={(bgContinuous) => set({ bgContinuous })}
      />
      <Check
        label={t('ctx.contiguous')}
        checked={s.bgContiguous}
        onChange={(bgContiguous) => set({ bgContiguous })}
      />
    </>
  );
}

export function FloodEraserContext() {
  const t = useT();
  const s = useStore(pixelStore, (x) => x);
  return (
    <>
      <Tolerance value={s.floodTolerance} onChange={(floodTolerance) => set({ floodTolerance })} />
      <Check
        label={t('ctx.contiguous')}
        checked={s.floodContiguous}
        onChange={(floodContiguous) => set({ floodContiguous })}
      />
    </>
  );
}

export function ColorReplaceContext() {
  const t = useT();
  const s = useStore(pixelStore, (x) => x);
  return (
    <>
      <Colors />
      <BrushSliders tool="colorReplace" />
      <Tolerance value={s.replaceTolerance} onChange={(replaceTolerance) => set({ replaceTolerance })} />
      <Check
        label={t('pixel.continuous')}
        checked={s.replaceContinuous}
        onChange={(replaceContinuous) => set({ replaceContinuous })}
      />
    </>
  );
}

export function PatchContext() {
  const t = useT();
  const mode = useStore(pixelStore, (x) => x.patchMode);
  const region = useStore(pixelStore, (x) => x.patchRegion);
  return (
    <>
      <Select
        label={t('ctx.mode')}
        value={mode}
        testId="patch-mode"
        options={(['source', 'destination'] as const).map((m) => ({
          value: m,
          label: t(`pixel.patch.${m}`),
        }))}
        onChange={(patchMode) => set({ patchMode })}
      />
      <span className="ctx-dim">{t(region ? 'pixel.patch.dragHint' : 'pixel.patch.drawHint')}</span>
    </>
  );
}

export function BlemishContext() {
  const t = useT();
  return (
    <>
      <BrushSliders tool="blemish" sizeOnly />
      <span className="ctx-dim">{t('pixel.blemish.hint')}</span>
    </>
  );
}

export function RedEyeContext() {
  const t = useT();
  const darken = useStore(pixelStore, (x) => x.redEyeDarken);
  return (
    <>
      <BrushSliders tool="redEye" sizeOnly />
      <Slider
        label={t('pixel.redEye.darken')}
        value={darken}
        min={0}
        max={100}
        unit="%"
        onChange={(redEyeDarken) => set({ redEyeDarken })}
      />
      <span className="ctx-dim">{t('pixel.redEye.hint')}</span>
    </>
  );
}

/** Rappel du masque rapide, au bout de la barre contextuelle de tous les outils. */
export function QuickMaskBadge() {
  const t = useT();
  useStore(pixelStore, (x) => x.quickMask);
  useUi((s) => s.persona);
  if (!quickMaskOn()) return null;
  return (
    <span className="mask-badge" data-testid="quick-mask-badge" title={t('pixel.quickMask.tip')}>
      {t('pixel.quickMask.on')}
      <button className="btn small" onClick={toggleQuickMask}>
        {t('pixel.quickMask.exit')}
      </button>
    </span>
  );
}
