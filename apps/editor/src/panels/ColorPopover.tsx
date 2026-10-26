import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { formatColor, hslToRgb, isGradient, rgbaToCss, type Paint } from '@poulpe/core';
import { addSwatch } from '../actions';
import { paintPreview } from '../components/fields';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { ui, useEditor, useStore, useUi } from '../store';
import { paintStore } from '../tools/paint/state';
import { applyPaint, GradientBar, switchPaintType, useCurrentPaint } from './ColorPanel';
import { ColorPicker, type Phase } from './ColorPicker';

type Tab = 'swatches' | 'color' | 'gradient';

/** Gamme de couleurs prête à l'emploi : 12 teintes en 5 clartés, puis 12 gris. */
const PALETTE: string[] = [
  ...[78, 64, 50, 38, 26].flatMap((l) =>
    Array.from({ length: 12 }, (_, i) => formatColor(hslToRgb(i * 30, 0.8, l / 100))),
  ),
  ...Array.from({ length: 12 }, (_, i) => {
    const v = Math.round(255 - (i * 255) / 11);
    return formatColor({ r: v, g: v, b: v, a: 1 });
  }),
];

/**
 * Pastille de couleur de la barre du haut, comme dans Affinity : un clic ouvre une petite fenêtre
 * Échantillons / Couleur / Dégradé pour le remplissage ou le contour (Photo : couleur du pinceau).
 */
export function PaintChip({ target }: { target: 'fill' | 'stroke' }) {
  const t = useT();
  const { paint } = useCurrentPaint(target);
  const photo = useUi((s) => s.persona) === 'photo';
  const label = photo ? t('cpop.primary') : t(target === 'fill' ? 'ctx.fill' : 'ctx.stroke');
  return (
    <Popover.Root onOpenChange={(open) => open && ui.set({ colorTarget: target })}>
      <Popover.Trigger
        className={`paint-chip${target === 'stroke' ? ' ring' : ''}`}
        title={label}
        aria-label={label}
        data-testid={`ctx-${target}`}
      >
        <span style={{ background: paintPreview(paint) }} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="color-pop"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          data-testid="color-pop"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ColorPopContent />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ColorPopContent() {
  const t = useT();
  const { paint, target } = useCurrentPaint();
  const photo = useUi((s) => s.persona) === 'photo';
  const [tab, setTab] = useState<Tab>(isGradient(paint) ? 'gradient' : 'color');
  const tabs: Tab[] = photo ? ['swatches', 'color'] : ['swatches', 'color', 'gradient'];
  return (
    <>
      <div className="color-pop-head">
        <div className="color-pop-tabs" role="tablist">
          {tabs.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              data-testid={`cpop-${k}`}
              onClick={() => setTab(k)}
            >
              {t(`cpop.${k}`)}
            </button>
          ))}
        </div>
        {!photo && (
          <button
            className={`swatch none-swatch${paint.type === 'none' ? ' on' : ''}`}
            title={t('color.noColor')}
            aria-label={t('color.noColor')}
            data-testid="ctx-none"
            onClick={() => applyPaint(target, { type: 'none' }, 'set')}
          />
        )}
      </div>
      {tab === 'swatches' && <SwatchesTab paint={paint} target={target} photo={photo} />}
      {tab === 'color' && <ColorTab paint={paint} target={target} />}
      {tab === 'gradient' && <GradientTab paint={paint} target={target} />}
    </>
  );
}

/** Couleur éditée : l'arrêt choisi d'un dégradé, sinon la couleur unie. */
function useEditedColor(paint: Paint, target: 'fill' | 'stroke') {
  const stop = useStore(paintStore, (s) => s.stop);
  const gradient = isGradient(paint) ? paint : null;
  const si = gradient ? Math.min(stop, gradient.stops.length - 1) : 0;
  const color = gradient
    ? (gradient.stops[si]?.color ?? '#000000')
    : paint.type === 'solid'
      ? paint.color
      : '#ffffff';
  const onColor = (c: string, phase: Phase) => {
    if (gradient)
      applyPaint(
        target,
        { ...gradient, stops: gradient.stops.map((s, i) => (i === si ? { ...s, color: c } : s)) },
        phase,
      );
    else applyPaint(target, { type: 'solid', color: c }, phase);
  };
  return { color, onColor, si };
}

function ColorTab({ paint, target }: { paint: Paint; target: 'fill' | 'stroke' }) {
  const shape = useUi((s) => s.settings.colorShape) ?? 'box';
  const { color, onColor } = useEditedColor(paint, target);
  return <ColorPicker color={color} onChange={onColor} shape={shape} />;
}

function SwatchesTab({ paint, target, photo }: { paint: Paint; target: 'fill' | 'stroke'; photo: boolean }) {
  const t = useT();
  const recent = useUi((s) => s.recentColors);
  const { doc } = useEditor();
  const pick = (c: string) => applyPaint(target, { type: 'solid', color: c }, 'set');
  const row = (colors: readonly string[]) =>
    colors.map((c, i) => (
      <button
        key={`${c}-${i}`}
        className="swatch"
        style={{ background: rgbaToCss(c) }}
        title={c}
        aria-label={c}
        onClick={() => pick(c)}
      />
    ));
  return (
    <div className="color-pop-swatches">
      {recent.length > 0 && (
        <>
          <h4 className="sub">{t('color.recent')}</h4>
          <div className="swatches">{row(recent)}</div>
        </>
      )}
      <h4 className="sub">{t('cpop.palette')}</h4>
      <div className="palette-grid" data-testid="cpop-palette">
        {row(PALETTE)}
      </div>
      <h4 className="sub">{t('color.document')}</h4>
      <div className="swatches">
        {row(doc.swatches)}
        {!photo && paint.type === 'solid' && (
          <button
            className="swatch add"
            title={t('color.addSwatch')}
            aria-label={t('color.addSwatch')}
            onClick={() => addSwatch(paint.color)}
          >
            <Icon name="plus" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function GradientTab({ paint, target }: { paint: Paint; target: 'fill' | 'stroke' }) {
  const t = useT();
  const gradient = isGradient(paint) ? paint : null;
  const { color, onColor, si } = useEditedColor(paint, target);
  const kinds = ['linear', 'radial', 'conic'] as const;
  return (
    <div className="color-pop-gradient">
      <div className="seg" role="group" aria-label={t('cpop.gradient')}>
        {kinds.map((k) => (
          <button
            key={k}
            aria-pressed={paint.type === k}
            data-testid={`cpop-kind-${k}`}
            onClick={() => paint.type !== k && switchPaintType(target, paint, k)}
          >
            {t(`color.${k}`)}
          </button>
        ))}
      </div>
      {gradient && (
        <>
          <GradientBar
            paint={gradient}
            selected={si}
            onSelect={(stop) => paintStore.set({ stop })}
            onChange={(stops, phase) => applyPaint(target, { ...gradient, stops }, phase)}
          />
          <div className="picker-row">
            <span className="field-label">{t('cpop.stop')}</span>
            <span className="spacer" />
            <button
              className="chip-btn"
              data-testid="cpop-reverse"
              onClick={() =>
                applyPaint(
                  target,
                  { ...gradient, stops: gradient.stops.map((s) => ({ ...s, offset: 1 - s.offset })) },
                  'set',
                )
              }
            >
              {t('cpop.reverse')}
            </button>
          </div>
          <ColorPicker color={color} onChange={onColor} shape="box" />
        </>
      )}
    </div>
  );
}
