import { useRef } from 'react';
import { isGradient, rgbaToCss } from '@poulpe/core';
import { Icon } from '../components/Icon';
import { paintPreview } from '../components/fields';
import { useT } from '../i18n';
import { ui, useStore, useUi } from '../store';
import { paintStore } from '../tools/paint/state';
import { applyPaint, useCurrentPaint } from './ColorPanel';
import { ColorPicker } from './ColorPicker';
import { FloatingFrame } from './FloatingFrame';
import { dockPanel, floatPanel, panels, startPanelDrag, type PanelId } from './panelLayout';

/** Fenêtre du sélecteur de couleur : toujours flottante, jamais ancrée dans le Studio. */
export const COLOR_WINDOW: PanelId = 'color-picker';

const SIZE = { w: 248, h: 430 };

/** Ouvre (ou ferme) le sélecteur de couleur, près de l'élément cliqué s'il est donné. */
export function toggleColorWindow(anchor?: Element | null): void {
  if (panels.get().floating[COLOR_WINDOW]) return dockPanel(COLOR_WINDOW);
  const r = anchor?.getBoundingClientRect();
  const x = r
    ? r.left > window.innerWidth / 2
      ? r.left - SIZE.w - 8
      : r.right + 8
    : window.innerWidth / 2 - SIZE.w / 2;
  const y = r ? Math.max(8, Math.min(r.top, window.innerHeight - SIZE.h - 8)) : 80;
  floatPanel(COLOR_WINDOW, { x, y, ...SIZE });
}

/** Ouvre le sélecteur de couleur pour le remplissage ou le contour. */
export function openColorWindowFor(target: 'fill' | 'stroke', anchor?: Element | null): void {
  ui.set({ colorTarget: target });
  if (!panels.get().floating[COLOR_WINDOW]) toggleColorWindow(anchor);
}

/**
 * Sélecteur de couleur avec roue, comme dans Affinity : il s'ouvre depuis les couleurs de la
 * colonne d'outils, de la barre contextuelle ou du menu Fenêtre, et se place n'importe où.
 */
export function ColorWindow() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const { paint, target } = useCurrentPaint();
  const photo = useUi((s) => s.persona) === 'photo';
  const recent = useUi((s) => s.recentColors);
  // La fenêtre garde toujours une roue ; elle prend le triangle s'il est choisi dans le panneau.
  const shape = useUi((s) => s.settings.colorShape) === 'triangle' ? 'triangle' : 'wheel';
  const stop = useStore(paintStore, (s) => s.stop);
  const gradient = isGradient(paint) ? paint : null;
  const si = gradient ? Math.min(stop, gradient.stops.length - 1) : 0;
  const color = gradient
    ? (gradient.stops[si]?.color ?? '#000000')
    : paint.type === 'solid'
      ? paint.color
      : '#ffffff';

  const onColor = (c: string, phase: Parameters<typeof applyPaint>[2]) => {
    if (gradient)
      applyPaint(
        target,
        { ...gradient, stops: gradient.stops.map((s, i) => (i === si ? { ...s, color: c } : s)) },
        phase,
      );
    else applyPaint(target, { type: 'solid', color: c }, phase);
  };

  return (
    <FloatingFrame id={COLOR_WINDOW} label={t('colorWindow.title')} className="color-window">
      <div
        ref={ref}
        className="float-head panel-handle"
        onPointerDown={(e) => startPanelDrag(e, COLOR_WINDOW, ref.current?.parentElement ?? null)}
      >
        <span className="float-title">{t('colorWindow.title')}</span>
        <button
          className="ib small"
          data-no-drag
          title={t('common.close')}
          aria-label={t('common.close')}
          data-testid="color-window-close"
          onClick={() => dockPanel(COLOR_WINDOW)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="panel-body color-window-body">
        {!photo && (
          <div className="picker-row">
            <div className="seg" role="group" aria-label={t('studio.color')}>
              <button aria-pressed={target === 'fill'} onClick={() => ui.set({ colorTarget: 'fill' })}>
                {t('color.fill')}
              </button>
              <button aria-pressed={target === 'stroke'} onClick={() => ui.set({ colorTarget: 'stroke' })}>
                {t('color.stroke')}
              </button>
            </div>
            <span className="chip big" style={{ background: paintPreview(paint) }} aria-hidden="true" />
          </div>
        )}
        <ColorPicker color={color} onChange={onColor} shape={shape} />
        {!photo && (
          <button
            className={`chip-btn none-btn${paint.type === 'none' ? ' on' : ''}`}
            data-testid="color-window-none"
            onClick={() => applyPaint(target, { type: 'none' }, 'set')}
          >
            <span className="none-swatch" aria-hidden="true" />
            {t('color.noColor')}
          </button>
        )}
        {recent.length > 0 && (
          <div className="swatches">
            {recent.map((c) => (
              <button
                key={c}
                className="swatch"
                style={{ background: rgbaToCss(c) }}
                title={c}
                aria-label={c}
                onClick={() => onColor(c, 'set')}
              />
            ))}
          </div>
        )}
      </div>
    </FloatingFrame>
  );
}
