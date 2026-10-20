import {
  colorToCmyk,
  findNode,
  isGradient,
  isStyled,
  opaque,
  outOfGamut,
  rgbaToCss,
  sampleStops,
  type GradientStop,
  type Paint,
} from '@poulpe/core';
import { addSwatch, removeSwatch, setPaint, withCmyk } from '../actions';
import { pickPatternImage } from '../vectorActions';
import { NumberField, Select, paintPreview } from '../components/fields';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { editingStyle, isEditingText } from '../canvas/textEdit';
import {
  editor,
  pushRecentColor,
  setSettings,
  ui,
  useEditor,
  useStore,
  useTextSelection,
  useUi,
  type ColorShape,
} from '../store';
import { paintStore } from '../tools/paint/state';
import { ColorPicker, type Phase } from './ColorPicker';

const DEFAULT_STOPS = (c: string): GradientStop[] => [
  { offset: 0, color: c },
  { offset: 1, color: '#ffffff' },
];

/** Peinture courante de la cible (remplissage ou contour) : sélection, ou réglage des nouveaux objets. */
export function useCurrentPaint(): { paint: Paint; target: 'fill' | 'stroke'; hasSelection: boolean } {
  const { doc, selection } = useEditor();
  const target = useUi((s) => s.colorTarget);
  const defaults = useUi((s) => s.defaults);
  const persona = useUi((s) => s.persona);
  const brushColor = useUi((s) => s.brushColor);
  useTextSelection();
  // Persona Photo : le panneau règle la couleur du pinceau.
  if (persona === 'photo')
    return { paint: { type: 'solid', color: brushColor }, target: 'fill', hasSelection: false };
  const editing = editingStyle();
  if (editing?.color && target === 'fill')
    return { paint: { type: 'solid', color: editing.color }, target, hasSelection: true };
  let node = selection.length ? findNode(doc, selection[0])?.node : null;
  while (node?.type === 'group') node = node.children[node.children.length - 1];
  if (node && isStyled(node)) {
    return { paint: target === 'fill' ? node.fill : node.stroke.paint, target, hasSelection: true };
  }
  return { paint: target === 'fill' ? defaults.fill : defaults.stroke.paint, target, hasSelection: false };
}

/**
 * Un autre geste était ouvert au début du glissement (tracé en cours à la Plume) : la couleur n'en
 * prend pas la base (l'historique mêlerait les deux) ; elle s'applique d'un coup au relâchement.
 */
let foreign = false;

/** Applique une peinture ; pendant un glissement, un seul pas d'historique pour tout le geste. */
export function applyPaint(target: 'fill' | 'stroke', paint: Paint, phase: Phase): void {
  if (ui.get().persona === 'photo') {
    if (paint.type === 'solid')
      ui.set({ brushColor: paint.color, defaults: { ...ui.get().defaults, fill: paint } });
    if (paint.type === 'solid' && (phase === 'end' || phase === 'set')) pushRecentColor(paint.color);
    return;
  }
  // Pendant l'édition d'un texte, la session d'édition forme déjà un seul pas d'historique.
  const live = editor.selection.length > 0 && !isEditingText();
  if (phase === 'start') foreign = live && editor.inGesture;
  if (foreign) {
    if (phase === 'end') foreign = false;
    if (phase === 'start' || phase === 'move') return;
    setPaint(target, paint);
  } else {
    if (live && phase === 'start') editor.begin();
    setPaint(target, paint, live && (phase === 'start' || phase === 'move' || phase === 'end'));
    if (live && phase === 'end') editor.commit('history.style');
  }
  if (phase === 'end' || phase === 'set') {
    const c = paint.type === 'solid' ? paint.color : null;
    if (c) pushRecentColor(c);
  }
}

function firstColor(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if (isGradient(p)) return p.stops[0]?.color ?? '#000000';
  return '#2ba59a';
}

export function ColorPanel() {
  const t = useT();
  const { paint, target, hasSelection } = useCurrentPaint();
  const recent = useUi((s) => s.recentColors);
  const { doc } = useEditor();
  // Arrêt choisi, partagé avec les outils Remplissage et Transparence (sur le canevas).
  const stopIndex = useStore(paintStore, (s) => s.stop);
  const setStopIndex = (stop: number) => paintStore.set({ stop });
  const photo = useUi((s) => s.persona) === 'photo';
  // Document d'impression : le sélecteur s'ouvre en CMJN et signale les couleurs hors gamut.
  const print = doc.layout?.colorMode === 'cmyk';
  const shape = useUi((s) => s.settings.colorShape) ?? 'box';

  const switchType = (type: Paint['type']) => {
    const base = firstColor(paint);
    const stops = isGradient(paint) ? paint.stops : DEFAULT_STOPS(base);
    if (type === 'pattern') {
      // Un motif a besoin d'une image : on la demande tout de suite.
      void pickPatternImage();
      return;
    }
    const next: Paint =
      type === 'none'
        ? { type: 'none' }
        : type === 'solid'
          ? { type: 'solid', color: base }
          : type === 'linear'
            ? { type: 'linear', angle: paint.type === 'linear' ? paint.angle : 90, stops }
            : type === 'conic'
              ? { type: 'conic', angle: 0, cx: 0.5, cy: 0.5, stops }
              : { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops };
    applyPaint(target, next, 'set');
  };

  const gradient = isGradient(paint) ? paint : null;
  const pattern = paint.type === 'pattern' ? paint : null;
  const stops = gradient?.stops ?? [];
  const si = Math.min(stopIndex, Math.max(0, stops.length - 1));
  const editColor = gradient ? (stops[si]?.color ?? '#000000') : paint.type === 'solid' ? paint.color : null;

  const onColor = (c: string, phase: Phase) => {
    if (paint.type === 'solid' || paint.type === 'none')
      applyPaint(target, { type: 'solid', color: c }, phase);
    else if (gradient) {
      const next = stops.map((s, i) => (i === si ? { ...s, color: c } : s));
      applyPaint(target, { ...gradient, stops: next }, phase);
    }
  };

  const applySwatch = (c: string) => {
    if (gradient) onColor(c, 'set');
    else applyPaint(target, { type: 'solid', color: c }, 'set');
  };

  return (
    <div className="panel-body color-panel">
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
      <div className="picker-row color-selects">
        <Select
          label={t('color.type')}
          value={paint.type}
          testId="color-paint-type"
          options={(['solid', 'linear', 'radial', 'conic', 'pattern', 'none'] as const).map((type) => ({
            value: type,
            label: t(`color.${type}`),
          }))}
          onChange={switchType}
        />
        {editColor !== null && (
          <Select
            label={t('color.shape')}
            value={shape}
            testId="color-shape"
            options={[
              { value: 'box' as ColorShape, label: t('color.shapeBox') },
              { value: 'wheel' as ColorShape, label: t('color.shapeWheel') },
              { value: 'triangle' as ColorShape, label: t('color.shapeTriangle') },
            ]}
            onChange={(v) => setSettings({ colorShape: v })}
          />
        )}
      </div>
      {gradient && (
        <GradientBar
          paint={gradient}
          selected={si}
          onSelect={setStopIndex}
          onChange={(stops2, phase) => applyPaint(target, { ...gradient, stops: stops2 }, phase)}
        />
      )}
      {gradient?.type === 'linear' && (
        <div className="picker-row">
          <NumberField
            label={t('color.angle')}
            value={gradient.angle}
            min={-360}
            max={360}
            unit="°"
            width={90}
            onChange={(v) => {
              // L'angle saisi remplace le début et la fin posés avec l'outil Remplissage.
              const { x1: _a, y1: _b, x2: _c, y2: _d, ...rest } = gradient;
              applyPaint(target, { ...rest, angle: v }, 'set');
            }}
          />
        </div>
      )}
      {gradient?.type === 'conic' && (
        <div className="picker-row">
          <NumberField
            label={t('color.angle')}
            value={gradient.angle}
            min={-360}
            max={360}
            unit="°"
            width={84}
            onChange={(v) => applyPaint(target, { ...gradient, angle: v }, 'set')}
          />
          <NumberField
            label={t('color.centerX')}
            value={Math.round(gradient.cx * 100)}
            unit="%"
            width={84}
            onChange={(v) => applyPaint(target, { ...gradient, cx: v / 100 }, 'set')}
          />
          <NumberField
            label={t('color.centerY')}
            value={Math.round(gradient.cy * 100)}
            unit="%"
            width={84}
            onChange={(v) => applyPaint(target, { ...gradient, cy: v / 100 }, 'set')}
          />
        </div>
      )}
      {pattern && (
        <div className="picker-row">
          <NumberField
            label={t('color.patternScale')}
            value={Math.round(pattern.scale * 100)}
            min={1}
            max={2000}
            unit="%"
            width={84}
            onChange={(v) => applyPaint(target, { ...pattern, scale: v / 100 }, 'set')}
          />
          <NumberField
            label={t('color.angle')}
            value={pattern.angle}
            min={-360}
            max={360}
            unit="°"
            width={84}
            onChange={(v) => applyPaint(target, { ...pattern, angle: v }, 'set')}
          />
          <button className="chip-btn" onClick={() => void pickPatternImage()}>
            {t('color.patternImage')}
          </button>
        </div>
      )}
      {gradient?.type === 'radial' && (
        <div className="picker-row">
          <NumberField
            label={t('color.centerX')}
            value={Math.round(gradient.cx * 100)}
            unit="%"
            width={84}
            onChange={(v) => applyPaint(target, { ...gradient, cx: v / 100 }, 'set')}
          />
          <NumberField
            label={t('color.centerY')}
            value={Math.round(gradient.cy * 100)}
            unit="%"
            width={84}
            onChange={(v) => applyPaint(target, { ...gradient, cy: v / 100 }, 'set')}
          />
          <NumberField
            label={t('color.radius')}
            value={Math.round(gradient.r * 100)}
            min={1}
            unit="%"
            width={84}
            onChange={(v) => applyPaint(target, { ...gradient, r: v / 100 }, 'set')}
          />
        </div>
      )}
      {editColor !== null ? (
        <ColorPicker
          color={editColor}
          shape={shape}
          onChange={onColor}
          cmyk={photo ? undefined : colorToCmyk(editColor, doc)}
          onCmyk={(c, cmyk) => withCmyk(opaque(c), cmyk, () => onColor(c, 'set'))}
          preferCmyk={print}
          outOfGamut={print && !doc.layout?.cmyk?.[opaque(editColor).toLowerCase()] && outOfGamut(editColor)}
        />
      ) : (
        <p className="empty">{hasSelection ? '' : t('color.nothing')}</p>
      )}
      {recent.length > 0 && (
        <>
          <h4 className="sub">{t('color.recent')}</h4>
          <div className="swatches">
            {recent.map((c) => (
              <button
                key={c}
                className="swatch"
                style={{ background: rgbaToCss(c) }}
                title={c}
                aria-label={c}
                onClick={() => applySwatch(c)}
              />
            ))}
          </div>
        </>
      )}
      <h4 className="sub">{t('color.document')}</h4>
      <div className="swatches">
        {!photo && (
          <button
            className={`swatch none-swatch${paint.type === 'none' ? ' on' : ''}`}
            title={t('color.noColor')}
            aria-label={t('color.noColor')}
            data-testid="swatch-none"
            onClick={() => applyPaint(target, { type: 'none' }, 'set')}
          />
        )}
        {doc.swatches.map((c) => (
          <button
            key={c}
            className="swatch"
            style={{ background: rgbaToCss(c) }}
            title={`${c} · ${t('color.removeSwatch')}`}
            aria-label={c}
            onClick={() => applySwatch(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              removeSwatch(c);
            }}
          />
        ))}
        {editColor && (
          <button
            className="swatch add"
            title={t('color.addSwatch')}
            aria-label={t('color.addSwatch')}
            onClick={() => addSwatch(editColor)}
          >
            <Icon name="plus" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Barre d'arrêts d'un dégradé. */
function GradientBar({
  paint,
  selected,
  onSelect,
  onChange,
}: {
  paint: Extract<Paint, { stops: GradientStop[] }>;
  selected: number;
  onSelect: (i: number) => void;
  onChange: (stops: GradientStop[], phase: Phase) => void;
}) {
  const t = useT();
  const stops = paint.stops;
  const preview = `linear-gradient(90deg, ${[...stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${rgbaToCss(s.color)} ${s.offset * 100}%`)
    .join(', ')}), var(--checker)`;

  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.stop')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offset = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const next = [...stops, { offset, color: sampleStops(stops, offset) }];
    onChange(next, 'set');
    onSelect(next.length - 1);
  };

  const onStopDown = (i: number, e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onSelect(i);
    const bar = e.currentTarget.parentElement!;
    const rect = bar.getBoundingClientRect();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let started = false;
    const move = (ev: PointerEvent) => {
      const offset =
        Math.round(Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)) * 1000) / 1000;
      onChange(
        stops.map((s, j) => (j === i ? { ...s, offset } : s)),
        started ? 'move' : 'start',
      );
      started = true;
    };
    const up = (ev: PointerEvent) => {
      if (started) {
        const offset =
          Math.round(Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)) * 1000) / 1000;
        onChange(
          stops.map((s, j) => (j === i ? { ...s, offset } : s)),
          'end',
        );
      }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const remove = (i: number) => {
    if (stops.length <= 2) return;
    onChange(
      stops.filter((_, j) => j !== i),
      'set',
    );
    onSelect(Math.max(0, i - 1));
  };

  return (
    <div className="gradient-editor">
      <div
        className="gradient-bar"
        style={{ background: preview }}
        onPointerDown={onBarDown}
        title={t('color.stopHint')}
      >
        {stops.map((s, i) => (
          <button
            key={i}
            className={`stop${i === selected ? ' on' : ''}`}
            style={{ left: `${s.offset * 100}%`, background: rgbaToCss(s.color) }}
            aria-label={`${Math.round(s.offset * 100)} %`}
            onPointerDown={(e) => onStopDown(i, e)}
            onKeyDown={(e) => {
              if (e.key === 'Delete' || e.key === 'Backspace') remove(i);
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
                onChange(
                  stops.map((st, j) =>
                    j === i ? { ...st, offset: Math.min(1, Math.max(0, st.offset + d)) } : st,
                  ),
                  'set',
                );
              }
            }}
          />
        ))}
      </div>
      <button
        className="ib"
        disabled={stops.length <= 2}
        title={t('color.removeStop')}
        aria-label={t('color.removeStop')}
        onClick={() => remove(selected)}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}
