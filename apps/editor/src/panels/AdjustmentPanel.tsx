import { useEffect, useRef, useState } from 'react';
import {
  autoLevels,
  curveTable,
  defaultAdjustment,
  histogram,
  type Adjustment,
  type AdjustmentKind,
} from '@poulpe/core';
import { NumberField } from '../components/fields';
import { Slider } from '../components/PhotoContext';
import { useT } from '../i18n';
import { renderBelow, selectedAdjustment, setAdjustment } from '../photo/photoActions';
import { pickLut } from '../photo/retouchActions';
import { useEditor } from '../store';

/** Réglage numérique d'un calque : clé, libellé, bornes. */
interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

const P = (
  key: string,
  min: number,
  max: number,
  unit?: string,
  step?: number,
  label = `param.${key}`,
): Param => ({
  key,
  label,
  min,
  max,
  unit,
  step,
});

const PARAMS: Partial<Record<AdjustmentKind, Param[]>> = {
  brightnessContrast: [P('brightness', -100, 100), P('contrast', -100, 100)],
  levels: [
    P('black', 0, 254),
    P('white', 1, 255),
    P('gamma', 0.1, 5, '', 0.01),
    P('outBlack', 0, 255),
    P('outWhite', 0, 255),
  ],
  hsl: [P('hue', -180, 180, '°'), P('saturation', -100, 100), P('lightness', -100, 100)],
  vibrance: [P('vibrance', -100, 100), P('saturation', -100, 100)],
  exposure: [
    P('exposure', -5, 5, 'IL', 0.05),
    P('offset', -0.5, 0.5, '', 0.01),
    P('gamma', 0.1, 5, '', 0.01),
  ],
  whiteBalance: [P('temperature', -100, 100), P('tint', -100, 100)],
  blackWhite: [P('red', -100, 200, '%'), P('green', -100, 200, '%'), P('blue', -100, 200, '%')],
  photoFilter: [P('density', 0, 100, '%')],
  threshold: [P('level', 0, 255)],
  posterize: [P('levels', 2, 32)],
  gaussianBlur: [P('radius', 0, 200, 'px', 0.5)],
  unsharpMask: [P('amount', 0, 500, '%'), P('radius', 0.5, 50, 'px', 0.5), P('threshold', 0, 100)],
  clarity: [P('amount', -100, 100, '%')],
  noise: [P('amount', 0, 100, '%')],
  vignette: [P('amount', -100, 100, '%'), P('size', 0, 100, '%'), P('softness', 0, 100, '%')],
  pixelate: [P('size', 1, 200, 'px')],
};

/** Champ réglable : un curseur, ou un champ seul pour les petites valeurs à virgule. */
function ParamField({
  p,
  value,
  onChange,
}: {
  p: Param;
  value: number;
  onChange: (v: number, live: boolean) => void;
}) {
  const t = useT();
  if (p.step && p.step < 1) {
    return (
      <span className="pslider">
        <span className="field-label">{t(p.label)}</span>
        <input
          type="range"
          min={p.min}
          max={p.max}
          step={p.step}
          value={value}
          aria-label={t(p.label)}
          onChange={(e) => onChange(Number(e.target.value), true)}
        />
        <NumberField
          value={value}
          min={p.min}
          max={p.max}
          decimals={2}
          step={p.step}
          unit={p.unit}
          width={60}
          onChange={(v) => onChange(v, false)}
        />
      </span>
    );
  }
  return (
    <Slider
      label={t(p.label)}
      value={Math.round(value * 10) / 10}
      min={p.min}
      max={p.max}
      unit={p.unit}
      testId={`param-${p.key}`}
      onChange={(v) => onChange(v, true)}
    />
  );
}

/** Histogramme (luminance et canaux) d'une image. */
export function Histogram({ data, height = 70 }: { data: ImageData | null; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!data) return;
    const h = histogram({ data: data.data, width: data.width, height: data.height });
    const draw = (arr: Uint32Array, color: string, op: GlobalCompositeOperation) => {
      // L'échelle ignore les pics extrêmes (noir ou blanc purs) pour garder la forme lisible.
      const sorted = [...arr].sort((a, b) => a - b);
      const max = Math.max(1, sorted[Math.floor(sorted.length * 0.98)] * 1.2);
      ctx.globalCompositeOperation = op;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, c.height);
      for (let i = 0; i < 256; i++)
        ctx.lineTo((i / 255) * c.width, c.height - Math.min(1, arr[i] / max) * c.height);
      ctx.lineTo(c.width, c.height);
      ctx.closePath();
      ctx.fill();
    };
    draw(h.r, 'rgba(255,80,80,0.55)', 'lighter');
    draw(h.g, 'rgba(80,220,80,0.55)', 'lighter');
    draw(h.b, 'rgba(80,140,255,0.55)', 'lighter');
    draw(h.l, 'rgba(200,200,210,0.35)', 'source-over');
    ctx.globalCompositeOperation = 'source-over';
  }, [data]);
  return <canvas ref={ref} className="histogram" width={256} height={height} data-testid="histogram" />;
}

type Curve = [number, number][];

/** Éditeur de courbes : points déplaçables, clic pour ajouter, double-clic pour retirer. */
function CurvesEditor({
  points,
  onChange,
  color,
  hist,
}: {
  points: Curve;
  onChange: (pts: Curve, live: boolean) => void;
  color: string;
  hist: ImageData | null;
}) {
  const S = 200;
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const table = curveTable(points);
  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    ] as [number, number];
  };
  let path = '';
  for (let i = 0; i < 256; i += 3)
    path += `${i ? 'L' : 'M'}${((i / 255) * S).toFixed(1)} ${((1 - table[i]) * S).toFixed(1)}`;
  path += `L${S} ${((1 - table[255]) * S).toFixed(1)}`;
  return (
    <div className="curves">
      <Histogram data={hist} height={60} />
      <svg
        ref={svg}
        viewBox={`0 0 ${S} ${S}`}
        width={S}
        height={S}
        data-testid="curves"
        onPointerDown={(e) => {
          const [x, y] = toLocal(e);
          const near = points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.05);
          (e.target as Element).setPointerCapture?.(e.pointerId);
          if (near >= 0) setDrag(near);
          else {
            const next = [...points, [x, y] as [number, number]].sort((a, b) => a[0] - b[0]);
            setDrag(next.findIndex((p) => p[0] === x && p[1] === y));
            onChange(next, true);
          }
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const [x, y] = toLocal(e);
          const next = points.map((p) => [...p] as [number, number]);
          const lo = drag > 0 ? next[drag - 1][0] + 0.01 : 0;
          const hi = drag < next.length - 1 ? next[drag + 1][0] - 0.01 : 1;
          next[drag] = [Math.min(hi, Math.max(lo, x)), y];
          onChange(next, true);
        }}
        onPointerUp={() => setDrag(null)}
        onDoubleClick={(e) => {
          const [x, y] = toLocal(e);
          const near = points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.05);
          if (near >= 0 && points.length > 2)
            onChange(
              points.filter((_, i) => i !== near),
              false,
            );
        }}
      >
        <rect width={S} height={S} className="curves-bg" />
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} className="curves-grid">
            <line x1={g * S} y1={0} x2={g * S} y2={S} />
            <line x1={0} y1={g * S} x2={S} y2={g * S} />
          </g>
        ))}
        <line x1={0} y1={S} x2={S} y2={0} className="curves-diag" />
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x * S} cy={(1 - y) * S} r={4} className="curves-pt" />
        ))}
      </svg>
    </div>
  );
}

const CHANNELS = [
  { id: 'rgb', label: 'RVB', color: '#e7e6ec' },
  { id: 'r', label: 'R', color: '#ff5f5f' },
  { id: 'g', label: 'V', color: '#5fdc6f' },
  { id: 'b', label: 'B', color: '#5f9bff' },
] as const;

/** Panneau Réglage : les réglages du calque de réglage sélectionné, avec aperçu en direct. */
export function AdjustmentPanel() {
  const t = useT();
  const { doc } = useEditor();
  const node = selectedAdjustment();
  const [channel, setChannel] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb');
  const [hist, setHist] = useState<ImageData | null>(null);
  const nodeId = node?.id;
  const kind = node?.adjustment.kind;
  useEffect(() => {
    if (!nodeId || (kind !== 'levels' && kind !== 'curves')) return;
    const id = setTimeout(() => setHist(renderBelow(256, nodeId)), 150);
    return () => clearTimeout(id);
  }, [nodeId, kind, doc]);
  if (!node) return <p className="panel-body note">{t('adjustpanel.none')}</p>;
  const adj = node.adjustment;
  const set = (patch: Partial<Adjustment>, live = false) => setAdjustment(node.id, patch, live);
  const params = PARAMS[adj.kind] ?? [];
  const values = adj as unknown as Record<string, number>;
  return (
    <div className="panel-body adjust-panel" data-testid="adjustment-panel">
      <div className="adjust-title">
        <b>{t(`adjust.${adj.kind}`)}</b>
        <span className="spacer" />
        {adj.kind === 'levels' && (
          <button
            className="btn small"
            onClick={() => {
              const px = renderBelow(512, node.id);
              if (px) set(autoLevels({ data: px.data, width: px.width, height: px.height }));
            }}
          >
            {t('param.auto')}
          </button>
        )}
        <button className="btn small" onClick={() => set(defaultAdjustment(adj.kind))}>
          {t('param.reset')}
        </button>
      </div>
      {adj.kind === 'levels' && <Histogram data={hist} />}
      {params.map((p) => (
        <ParamField
          key={p.key}
          p={p}
          value={values[p.key]}
          onChange={(v, live) => set({ [p.key]: v } as Partial<Adjustment>, live)}
        />
      ))}
      {adj.kind === 'curves' && (
        <>
          <span className="seg" role="group" aria-label={t('param.channel')}>
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                className="btn small"
                aria-pressed={channel === c.id}
                onClick={() => setChannel(c.id)}
              >
                {c.label}
              </button>
            ))}
          </span>
          <CurvesEditor
            points={adj[channel]}
            color={CHANNELS.find((c) => c.id === channel)!.color}
            hist={hist}
            onChange={(pts, live) => set({ [channel]: pts } as Partial<Adjustment>, live)}
          />
          <p className="note">{t('param.curvesHint')}</p>
        </>
      )}
      {adj.kind === 'colorBalance' &&
        (['shadows', 'midtones', 'highlights'] as const).map((tone) => (
          <fieldset key={tone} className="tone">
            <legend>{t(`param.${tone}`)}</legend>
            {(['cyanRed', 'magentaGreen', 'yellowBlue'] as const).map((axis, i) => (
              <Slider
                key={axis}
                label={t(`param.${axis}`)}
                value={adj[tone][i]}
                min={-100}
                max={100}
                onChange={(v) => {
                  const next = [...adj[tone]] as [number, number, number];
                  next[i] = v;
                  set({ [tone]: next } as Partial<Adjustment>, true);
                }}
              />
            ))}
          </fieldset>
        ))}
      {adj.kind === 'lut' && (
        <div className="picker-row">
          <span className="ctx-dim">{t('lut.name', { name: adj.name || '—' })}</span>
          <button
            className="btn small"
            onClick={() =>
              void pickLut().then((lut) => {
                if (lut) set(lut, false);
              })
            }
          >
            {t('lut.replace')}
          </button>
        </div>
      )}
      {adj.kind === 'photoFilter' && (
        <label className="field">
          <span className="field-label">{t('param.color')}</span>
          <input
            type="color"
            className="color-input"
            value={adj.color.slice(0, 7)}
            onChange={(e) => set({ color: e.target.value }, true)}
          />
        </label>
      )}
      {adj.kind === 'gradientMap' && (
        <div className="picker-row">
          <span className="field-label">{t('param.stops')}</span>
          {adj.stops.map((s, i) => (
            <input
              key={i}
              type="color"
              className="color-input"
              value={s.color.slice(0, 7)}
              aria-label={`${t('param.color')} ${i + 1}`}
              onChange={(e) =>
                set({ stops: adj.stops.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) }, true)
              }
            />
          ))}
        </div>
      )}
      {adj.kind === 'noise' && (
        <label className="check">
          <input
            type="checkbox"
            checked={adj.monochrome}
            onChange={(e) => set({ monochrome: e.target.checked })}
          />
          {t('param.monochrome')}
        </label>
      )}
    </div>
  );
}

/** Éditeur de paramètres réutilisé par la boîte de dialogue Filtres (valeurs locales). */
export function AdjustmentFields({ adj, onChange }: { adj: Adjustment; onChange: (a: Adjustment) => void }) {
  const t = useT();
  const params = PARAMS[adj.kind] ?? [];
  const values = adj as unknown as Record<string, number>;
  return (
    <div className="adjust-panel">
      {params.map((p) => (
        <ParamField
          key={p.key}
          p={p}
          value={values[p.key]}
          onChange={(v) => onChange({ ...adj, [p.key]: v } as Adjustment)}
        />
      ))}
      {adj.kind === 'noise' && (
        <label className="check">
          <input
            type="checkbox"
            checked={adj.monochrome}
            onChange={(e) => onChange({ ...adj, monochrome: e.target.checked })}
          />
          {t('param.monochrome')}
        </label>
      )}
      {adj.kind === 'photoFilter' && (
        <label className="field">
          <span className="field-label">{t('param.color')}</span>
          <input
            type="color"
            className="color-input"
            value={adj.color.slice(0, 7)}
            onChange={(e) => onChange({ ...adj, color: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
