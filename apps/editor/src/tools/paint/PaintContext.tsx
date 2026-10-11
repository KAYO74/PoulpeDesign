import {
  alphaOf,
  convertGradient,
  findNode,
  gradientKind,
  isGradient,
  isStyled,
  newGradient,
  opaque,
  reverseStops,
  rotateGradient,
  withAlpha,
  type GradientKind,
  type HandlePaint,
  type Paint,
  type SceneNode,
  type StrokeJoin,
  type Transparency,
} from '@poulpe/core';
import { setPaint } from '../../actions';
import { Icon, type IconName } from '../../components/Icon';
import { NumberField, Select } from '../../components/fields';
import { useT } from '../../i18n';
import { editor, ui, useEditor, useStore, useUi } from '../../store';
import { pickPatternImage } from '../../vectorActions';
import { closedShapesIn, selectedShapes, setContour } from './contourTool';
import { frameOf, gradientTarget, styledIn, writePaint, type GradientMode } from './gradientTool';
import { paintStore, type FillKind } from './state';
import { widthPoints, widthTarget, withWidthPoints } from './widthTool';

/* Barres contextuelles des outils Remplissage, Transparence, Contour et Largeur de trait. */

const FILL_KINDS: FillKind[] = ['none', 'solid', 'linear', 'radial', 'elliptical', 'conic', 'bitmap'];
const GRADIENT_KINDS: GradientKind[] = ['linear', 'radial', 'elliptical', 'conic'];

function kindOf(p: Paint): FillKind {
  if (p.type === 'pattern') return 'bitmap';
  return gradientKind(p) ?? (p.type === 'solid' ? 'solid' : 'none');
}

function firstColor(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if (isGradient(p) && p.stops.length) return p.stops[0].color;
  return '#000000';
}

/** Peinture de la cible (remplissage ou contour) d'un objet. */
const targetPaint = (n: SceneNode): Paint | null =>
  isStyled(n) ? (ui.get().colorTarget === 'fill' ? n.fill : n.stroke.paint) : null;

/** Change le type de la peinture en gardant ses couleurs et le tracé du dégradé. */
function convertPaint(p: Paint, kind: FillKind, w: number, h: number): Paint {
  if (kind === 'none') return { type: 'none' };
  if (kind === 'solid') return { type: 'solid', color: firstColor(p) };
  if (kind === 'bitmap') return p;
  if (isGradient(p)) return convertGradient(p, kind, w, h);
  return newGradient(
    kind,
    [
      { offset: 0, color: firstColor(p) },
      { offset: 1, color: '#ffffff' },
    ],
    w,
    h,
  ) as Paint;
}

function IconBtn({
  icon,
  label,
  onClick,
  disabled,
  testId,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      className="btn small icon"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon name={icon} />
    </button>
  );
}

/** Modifie le dégradé de chaque objet de la sélection qui en a un (remplissage, contour ou transparence). */
function eachGradient(
  mode: GradientMode,
  fn: (p: HandlePaint, w: number, h: number) => HandlePaint | null,
): void {
  const ids = editor.selection;
  editor.apply(mode === 'transparency' ? 'history.transparency' : 'history.gradient', (d) => {
    const nodes =
      mode === 'fill'
        ? styledIn(d, ids)
        : ids.map((id) => findNode(d, id)?.node).filter((n): n is SceneNode => !!n);
    for (const n of nodes) {
      if (n.locked) continue;
      const p = mode === 'transparency' ? (n.transparency ?? null) : targetPaint(n);
      if (!p || (p.type !== 'linear' && p.type !== 'radial' && p.type !== 'conic' && p.type !== 'pattern'))
        continue;
      const f = frameOf(n, mode);
      writePaint(n, mode, fn(p, f.width, f.height));
    }
  });
}

/** Champs de l'arrêt choisi : couleur (remplissage), opacité et position. */
function StopFields({ mode }: { mode: GradientMode }) {
  const t = useT();
  useEditor();
  useUi((s) => s.colorTarget);
  const si = useStore(paintStore, (s) => s.stop);
  const tg = gradientTarget(mode);
  if (!tg || !('stops' in tg.paint)) return null;
  const paint = tg.paint;
  const stops = paint.stops as { offset: number; color?: string; opacity?: number }[];
  const i = Math.min(si, stops.length - 1);
  const stop = stops[i];
  const set = (patch: Partial<{ offset: number; color: string; opacity: number }>) => {
    const next = { ...paint, stops: stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) } as HandlePaint;
    if (mode === 'fill') setPaint(ui.get().colorTarget, next as Paint);
    else
      editor.apply('history.transparency', (d) => {
        const n = findNode(d, tg.node.id)?.node;
        if (n) writePaint(n, mode, next);
      });
  };
  const opacity = stop.color !== undefined ? alphaOf(stop.color) : (stop.opacity ?? 1);
  return (
    <>
      {stop.color !== undefined && (
        <label className="field" title={t('paint.stopColor')}>
          <input
            type="color"
            className="paint-swatch"
            value={opaque(stop.color).slice(0, 7)}
            aria-label={t('paint.stopColor')}
            data-testid="paint-stop-color"
            onChange={(e) => set({ color: withAlpha(e.target.value, alphaOf(stop.color!)) })}
          />
        </label>
      )}
      <NumberField
        label={t('paint.stopOpacity')}
        value={Math.round(opacity * 100)}
        min={0}
        max={100}
        unit="%"
        width={80}
        testId="paint-stop-opacity"
        onChange={(v) =>
          stop.color !== undefined
            ? set({ color: withAlpha(stop.color, v / 100) })
            : set({ opacity: v / 100 })
        }
      />
      <NumberField
        label={t('paint.stopPosition')}
        value={Math.round(stop.offset * 1000) / 10}
        min={0}
        max={100}
        decimals={1}
        unit="%"
        width={80}
        testId="paint-stop-position"
        onChange={(v) => set({ offset: v / 100 })}
      />
    </>
  );
}

/** Outil Remplissage [G]. */
export function FillContext() {
  const t = useT();
  const { doc, selection } = useEditor();
  const target = useUi((s) => s.colorTarget);
  const defaults = useUi((s) => s.defaults);
  const fillKind = useStore(paintStore, (s) => s.fillKind);
  const nodes = styledIn(doc, selection);
  const first = nodes[0];
  const paint = first ? targetPaint(first)! : target === 'fill' ? defaults.fill : defaults.stroke.paint;
  const kind = first ? kindOf(paint) : fillKind;
  const hasGradient = nodes.some((n) => {
    const p = targetPaint(n);
    return !!p && (isGradient(p) || p.type === 'pattern');
  });

  const setKind = (k: FillKind) => {
    paintStore.set({ fillKind: k });
    if (!nodes.length) return;
    if (k === 'bitmap') {
      void pickPatternImage();
      return;
    }
    editor.apply('history.style', (d) => {
      for (const n of styledIn(d, editor.selection)) {
        const p = targetPaint(n);
        if (p) writePaint(n, 'fill', convertPaint(p, k, n.width, n.height));
      }
    });
  };

  return (
    <>
      <Select
        label={t('paint.type')}
        value={kind}
        testId="paint-type"
        options={FILL_KINDS.map((k) => ({ value: k, label: t(`paint.kind.${k}`) }))}
        onChange={setKind}
      />
      <span className="ctx-label">{t('paint.context')}</span>
      <span className="seg small" role="group" aria-label={t('paint.context')}>
        {(['fill', 'stroke'] as const).map((k) => (
          <button
            key={k}
            aria-pressed={target === k}
            data-testid={`paint-target-${k}`}
            onClick={() => ui.set({ colorTarget: k })}
          >
            {t(k === 'fill' ? 'color.fill' : 'color.stroke')}
          </button>
        ))}
      </span>
      <StopFields mode="fill" />
      <IconBtn
        icon="rotateRight"
        label={t('paint.rotate')}
        disabled={!hasGradient}
        testId="paint-rotate"
        onClick={() => eachGradient('fill', (p, w, h) => rotateGradient(p, w, h))}
      />
      <IconBtn
        icon="swap"
        label={t('paint.reverse')}
        disabled={!hasGradient || kind === 'bitmap'}
        testId="paint-reverse"
        onClick={() => eachGradient('fill', (p) => (p.type === 'pattern' ? p : reverseStops(p)))}
      />
      <span className="ctx-dim">{t('paint.fillHint')}</span>
    </>
  );
}

/** Outil Transparence [Y]. */
export function TransparencyContext() {
  const t = useT();
  const { doc, selection } = useEditor();
  const transKind = useStore(paintStore, (s) => s.transKind);
  const nodes = selection.map((id) => findNode(doc, id)?.node).filter((n): n is SceneNode => !!n);
  const withT = nodes.filter((n) => n.transparency);
  const kind: GradientKind | 'none' = withT.length
    ? (gradientKind(withT[0].transparency!) ?? 'linear')
    : nodes.length
      ? 'none'
      : transKind;

  const setKind = (k: GradientKind | 'none') => {
    if (k !== 'none') paintStore.set({ transKind: k });
    if (!nodes.length) return;
    editor.apply('history.transparency', (d) => {
      for (const id of editor.selection) {
        const n = findNode(d, id)?.node;
        if (!n || n.locked || n.type === 'adjustment') continue;
        if (k === 'none') {
          delete n.transparency;
          continue;
        }
        const f = frameOf(n, 'transparency');
        n.transparency = n.transparency
          ? convertGradient(n.transparency, k, f.width, f.height)
          : (newGradient(
              k,
              [
                { offset: 0, opacity: 1 },
                { offset: 1, opacity: 0 },
              ],
              f.width,
              f.height,
            ) as unknown as Transparency);
      }
    });
  };

  return (
    <>
      <Select
        label={t('paint.type')}
        value={kind}
        testId="transparency-type"
        options={(['none', ...GRADIENT_KINDS] as const).map((k) => ({
          value: k,
          label: t(`paint.kind.${k}`),
        }))}
        onChange={setKind}
      />
      <StopFields mode="transparency" />
      <IconBtn
        icon="rotateRight"
        label={t('paint.rotate')}
        disabled={!withT.length}
        testId="transparency-rotate"
        onClick={() => eachGradient('transparency', (p, w, h) => rotateGradient(p, w, h))}
      />
      <IconBtn
        icon="swap"
        label={t('paint.reverse')}
        disabled={!withT.length}
        testId="transparency-reverse"
        onClick={() => eachGradient('transparency', (p) => (p.type === 'pattern' ? p : reverseStops(p)))}
      />
      <IconBtn
        icon="trash"
        label={t('paint.remove')}
        disabled={!withT.length}
        testId="transparency-remove"
        onClick={() => eachGradient('transparency', () => null)}
      />
      <span className="ctx-dim">{t('paint.transHint')}</span>
    </>
  );
}

/** Outil Contour [O]. */
export function ContourContext() {
  const t = useT();
  const { doc } = useEditor();
  const defaults = useStore(paintStore, (s) => s.contour);
  const shapes = selectedShapes(doc);
  const own = shapes.map((n) => ('contour' in n ? n.contour : undefined)).find(Boolean);
  const shown = own ?? defaults;

  /** Applique un réglage aux formes sélectionnées (le contour est créé s'il n'existait pas). */
  const set = (patch: Partial<typeof defaults>) => {
    paintStore.set({ contour: { ...defaults, ...patch } });
    if (!shapes.length) return;
    editor.apply('history.contour', (d) => {
      for (const n of selectedShapes(d)) {
        const old = 'contour' in n ? n.contour : undefined;
        if (!old && patch.radius === undefined) continue;
        setContour(n, { ...defaults, ...old, ...patch });
      }
    });
  };

  return (
    <>
      <NumberField
        label={t('paint.contourRadius')}
        value={shown.radius}
        min={-1000}
        max={1000}
        decimals={1}
        unit="px"
        width={90}
        testId="contour-radius"
        onChange={(radius) => set({ radius })}
      />
      <Select
        label={t('paint.contourJoin')}
        value={shown.join}
        testId="contour-join"
        options={(['miter', 'round', 'bevel'] as StrokeJoin[]).map((j) => ({
          value: j,
          label: t(`paint.join.${j}`),
        }))}
        onChange={(join) => set({ join })}
      />
      <NumberField
        label={t('paint.miterLimit')}
        value={shown.miterLimit}
        min={1}
        max={100}
        decimals={1}
        width={70}
        testId="contour-miter"
        disabled={shown.join !== 'miter'}
        onChange={(miterLimit) => set({ miterLimit })}
      />
      <IconBtn
        icon="trash"
        label={t('paint.remove')}
        disabled={!own}
        testId="contour-remove"
        onClick={() =>
          editor.apply('history.contour', (d) => {
            for (const id of editor.selection) {
              const n = findNode(d, id)?.node;
              if (n) closedShapesIn(n).forEach((m) => setContour(m, null));
            }
          })
        }
      />
      <span className="ctx-dim">{t('paint.contourHint')}</span>
    </>
  );
}

/** Outil Largeur de trait [W]. */
export function WidthContext() {
  const t = useT();
  useEditor();
  const index = useStore(paintStore, (s) => s.widthPoint);
  const n = widthTarget();
  const stroke = n && isStyled(n) ? n.stroke : null;
  const pts = stroke ? widthPoints(stroke) : [];
  const i = index !== null && index < pts.length ? index : null;
  return (
    <>
      <NumberField
        label={t('paint.widthPoint')}
        value={stroke && i !== null ? Math.round(pts[i].w * stroke.width * 10) / 10 : null}
        min={0}
        max={2000}
        decimals={1}
        unit="px"
        width={90}
        testId="width-point"
        disabled={!stroke || i === null}
        onChange={(v) => {
          if (!n || !stroke || i === null) return;
          const next = pts.map((q, j) => (j === i ? { ...q, w: v / Math.max(0.0001, stroke.width) } : q));
          editor.apply('history.strokeWidth', (d) => {
            const m = findNode(d, n.id)?.node;
            if (m && isStyled(m)) m.stroke = withWidthPoints(m.stroke, next);
          });
        }}
      />
      <button
        className="btn small"
        data-testid="width-reset"
        disabled={!stroke?.profile}
        onClick={() => {
          paintStore.set({ widthPoint: null });
          editor.apply('history.strokeWidth', (d) => {
            for (const m of styledIn(d, editor.selection)) {
              if (!isStyled(m) || !m.stroke.profile) continue;
              const s = { ...m.stroke };
              delete s.profile;
              delete s.profilePos;
              m.stroke = s;
            }
          });
        }}
      >
        {t('paint.widthReset')}
      </button>
      <span className="ctx-dim">{t('paint.widthHint')}</span>
    </>
  );
}
