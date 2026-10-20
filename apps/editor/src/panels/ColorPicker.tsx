import { useEffect, useRef, useState } from 'react';
import {
  cmykToColor,
  formatColor,
  hslToRgb,
  hsvToRgb,
  normalizeHex,
  parseColor,
  rgbToHsl,
  rgbToHsv,
  type Cmyk,
  type HSVA,
} from '@poulpe/core';
import { NumberField } from '../components/fields';
import { useT } from '../i18n';
import type { ColorShape } from '../store';

export type Phase = 'start' | 'move' | 'end' | 'set';

/**
 * Sélecteur de couleur : carré saturation / luminosité (ou roue des teintes autour du carré),
 * teinte, opacité, hexadécimal, RVB, TSL ou CMJN. En CMJN (`cmyk` donné), les valeurs saisies sont
 * gardées telles quelles pour l'impression.
 */
export function ColorPicker({
  color,
  onChange,
  cmyk,
  onCmyk,
  outOfGamut,
  preferCmyk,
  wheel,
  shape: shapeProp,
  noAlpha,
}: {
  color: string;
  onChange: (c: string, phase: Phase) => void;
  /** Valeurs CMJN de la couleur (affiche le mode CMJN). */
  cmyk?: Cmyk;
  /** Couleur choisie en CMJN : sa couleur à l'écran et ses valeurs exactes. */
  onCmyk?: (c: string, cmyk: Cmyk) => void;
  /** La couleur change nettement à l'impression. */
  outOfGamut?: boolean;
  /** Ouvrir en mode CMJN (document d'impression). */
  preferCmyk?: boolean;
  /** Roue des teintes autour du carré, comme dans Affinity. */
  wheel?: boolean;
  /** Forme : carré, roue avec carré, ou roue avec triangle (prioritaire sur `wheel`). */
  shape?: ColorShape;
  /** Pas de réglage d'opacité (couleurs toujours opaques). */
  noAlpha?: boolean;
}) {
  const t = useT();
  const shape: ColorShape = shapeProp ?? (wheel ? 'wheel' : 'box');
  const [hsv, setHsv] = useState<HSVA>(() => rgbToHsv(parseColor(color)));
  const [mode, setMode] = useState<'rgb' | 'hsl' | 'cmyk'>(preferCmyk && cmyk ? 'cmyk' : 'rgb');
  const lastEmitted = useRef(color);
  // Le document passe en CMJN : le sélecteur suit.
  useEffect(() => {
    if (preferCmyk && cmyk) setMode('cmyk');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferCmyk]);

  // Couleur changée de l'extérieur (autre objet sélectionné, annulation…).
  useEffect(() => {
    if (color.toLowerCase() !== lastEmitted.current.toLowerCase()) {
      const next = rgbToHsv(parseColor(color));
      setHsv((prev) => ({ ...next, h: next.s === 0 || next.v === 0 ? prev.h : next.h }));
      lastEmitted.current = color;
    }
  }, [color]);

  const emit = (next: HSVA, phase: Phase) => {
    setHsv(next);
    const c = formatColor(hsvToRgb(next));
    lastEmitted.current = c;
    onChange(c, phase);
  };

  const drag = (el: HTMLElement, e: React.PointerEvent, fn: (x: number, y: number, phase: Phase) => void) => {
    const rect = el.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => [
      Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)),
    ];
    el.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    fn(x, y, 'start');
    const move = (ev: PointerEvent) => {
      const [mx, my] = at(ev);
      fn(mx, my, 'move');
    };
    const up = (ev: PointerEvent) => {
      const [ux, uy] = at(ev);
      fn(ux, uy, 'end');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const rgb = hsvToRgb(hsv);
  const hsl = rgbToHsl(rgb);
  const opaqueHex = formatColor({ ...rgb, a: 1 });
  const hueColor = formatColor(hsvToRgb({ h: hsv.h, s: 1, v: 1, a: 1 }));

  /** Carré saturation / luminosité. */
  const svSquare = (cls: string) => (
    <div
      className={cls}
      style={{ background: hueColor }}
      role="slider"
      aria-label="Saturation"
      aria-valuenow={Math.round(hsv.s * 100)}
      tabIndex={0}
      onPointerDown={(e) =>
        drag(e.currentTarget, e, (x, y, phase) => emit({ ...hsv, s: x, v: 1 - y, a: hsv.a }, phase))
      }
      onKeyDown={(e) => {
        const d = e.shiftKey ? 0.1 : 0.01;
        if (e.key === 'ArrowRight') emit({ ...hsv, s: Math.min(1, hsv.s + d) }, 'set');
        if (e.key === 'ArrowLeft') emit({ ...hsv, s: Math.max(0, hsv.s - d) }, 'set');
        if (e.key === 'ArrowUp') emit({ ...hsv, v: Math.min(1, hsv.v + d) }, 'set');
        if (e.key === 'ArrowDown') emit({ ...hsv, v: Math.max(0, hsv.v - d) }, 'set');
      }}
    >
      <div className="sv-white" />
      <div className="sv-black" />
      <div
        className="sv-knob"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: opaqueHex }}
      />
    </div>
  );

  return (
    <div className="picker">
      {shape !== 'box' ? (
        <div className="wheel" data-testid="color-wheel">
          <div
            className="wheel-ring"
            role="slider"
            aria-label="Teinte"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            tabIndex={0}
            onPointerDown={(e) =>
              drag(e.currentTarget, e, (x, y, phase) => {
                const deg = (Math.atan2(x - 0.5, 0.5 - y) * 180) / Math.PI;
                emit({ ...hsv, h: Math.min(359.9, (deg + 360) % 360) }, phase);
              })
            }
            onKeyDown={(e) => {
              const d = e.shiftKey ? 10 : 1;
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
                emit({ ...hsv, h: (hsv.h + d) % 360 }, 'set');
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')
                emit({ ...hsv, h: (hsv.h - d + 360) % 360 }, 'set');
            }}
          />
          <div
            className="wheel-knob"
            style={{
              left: `${50 + 40.5 * Math.sin((hsv.h * Math.PI) / 180)}%`,
              top: `${50 - 40.5 * Math.cos((hsv.h * Math.PI) / 180)}%`,
              background: hueColor,
            }}
          />
          {shape === 'triangle' ? <HsvTriangle hsv={hsv} drag={drag} emit={emit} /> : svSquare('sv wheel-sv')}
        </div>
      ) : (
        <>
          {svSquare('sv')}
          <div
            className="slider hue"
            role="slider"
            aria-label="Teinte"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            tabIndex={0}
            onPointerDown={(e) =>
              drag(e.currentTarget, e, (x, _y, phase) => emit({ ...hsv, h: x * 359.9 }, phase))
            }
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight')
                emit({ ...hsv, h: Math.min(359.9, hsv.h + (e.shiftKey ? 10 : 1)) }, 'set');
              if (e.key === 'ArrowLeft')
                emit({ ...hsv, h: Math.max(0, hsv.h - (e.shiftKey ? 10 : 1)) }, 'set');
            }}
          >
            <div className="slider-knob" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
        </>
      )}
      {!noAlpha && (
        <div
          className="slider alpha"
          role="slider"
          aria-label={t('color.opacity')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv.a * 100)}
          tabIndex={0}
          style={{ ['--c' as string]: opaqueHex }}
          onPointerDown={(e) =>
            drag(e.currentTarget, e, (x, _y, phase) => emit({ ...hsv, a: Math.round(x * 100) / 100 }, phase))
          }
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') emit({ ...hsv, a: Math.min(1, hsv.a + 0.01) }, 'set');
            if (e.key === 'ArrowLeft') emit({ ...hsv, a: Math.max(0, hsv.a - 0.01) }, 'set');
          }}
        >
          <div className="slider-knob" style={{ left: `${hsv.a * 100}%` }} />
        </div>
      )}
      <div className="picker-row">
        <HexField
          value={opaqueHex}
          onChange={(hex) => {
            const c = rgbToHsv(parseColor(hex));
            emit({ ...c, a: hsv.a }, 'set');
          }}
        />
        {!noAlpha && (
          <NumberField
            label={t('color.opacity')}
            value={Math.round(hsv.a * 100)}
            min={0}
            max={100}
            unit="%"
            width={100}
            onChange={(v) => emit({ ...hsv, a: v / 100 }, 'set')}
          />
        )}
      </div>
      <div className="picker-row">
        <div className="seg small" role="group">
          <button aria-pressed={mode === 'rgb'} onClick={() => setMode('rgb')}>
            {t('color.rgb')}
          </button>
          <button aria-pressed={mode === 'hsl'} onClick={() => setMode('hsl')}>
            {t('color.hsl')}
          </button>
          {cmyk && onCmyk && (
            <button aria-pressed={mode === 'cmyk'} data-testid="mode-cmyk" onClick={() => setMode('cmyk')}>
              {t('color.cmyk')}
            </button>
          )}
        </div>
        {mode === 'cmyk' && cmyk && onCmyk ? (
          <>
            {([0, 1, 2, 3] as const).map((i) => (
              <NumberField
                key={i}
                label={t('color.cmyk')[i]}
                value={Math.round(cmyk[i])}
                min={0}
                max={100}
                width={56}
                testId={`cmyk-${i}`}
                onChange={(v) => {
                  const next = [...cmyk] as Cmyk;
                  next[i] = Math.max(0, Math.min(100, v));
                  const c = cmykToColor(next);
                  const withA = formatColor({ ...parseColor(c), a: hsv.a });
                  setHsv({ ...rgbToHsv(parseColor(c)), a: hsv.a });
                  lastEmitted.current = withA;
                  onCmyk(withA, next);
                }}
              />
            ))}
          </>
        ) : mode === 'rgb' ? (
          <>
            {(['r', 'g', 'b'] as const).map((k) => (
              <NumberField
                key={k}
                label={k.toUpperCase()}
                value={Math.round(rgb[k])}
                min={0}
                max={255}
                width={56}
                onChange={(v) => emit({ ...rgbToHsv({ ...rgb, [k]: v }), a: hsv.a }, 'set')}
              />
            ))}
          </>
        ) : (
          <>
            <NumberField
              label={t('color.hsl')[0]}
              value={Math.round(hsl.h)}
              min={0}
              max={360}
              width={56}
              onChange={(v) => emit({ ...rgbToHsv(hslToRgb(v, hsl.s, hsl.l)), a: hsv.a }, 'set')}
            />
            <NumberField
              label={t('color.hsl')[1]}
              value={Math.round(hsl.s * 100)}
              min={0}
              max={100}
              width={56}
              onChange={(v) => emit({ ...rgbToHsv(hslToRgb(hsl.h, v / 100, hsl.l)), a: hsv.a }, 'set')}
            />
            <NumberField
              label={t('color.hsl')[2]}
              value={Math.round(hsl.l * 100)}
              min={0}
              max={100}
              width={56}
              onChange={(v) => emit({ ...rgbToHsv(hslToRgb(hsl.h, hsl.s, v / 100)), a: hsv.a }, 'set')}
            />
          </>
        )}
      </div>
      {outOfGamut && (
        <p className="note small gamut" data-testid="gamut-warning">
          {t('color.outOfGamut')}
        </p>
      )}
    </div>
  );
}

/** Rayon du cercle où s'inscrit le triangle, en fraction de la largeur de la roue. */
const TRI_R = 0.29;
/** Sommets du triangle non tourné (centre 0, rayon 1) : teinte pure en haut, blanc, noir. */
const TRI = {
  hue: [0, -1],
  white: [-Math.sqrt(3) / 2, 0.5],
  black: [Math.sqrt(3) / 2, 0.5],
} as const;

/**
 * Triangle teinte pure / blanc / noir au centre de la roue, comme dans Affinity : il tourne avec la
 * teinte, son sommet coloré face au curseur de la roue.
 */
function HsvTriangle({
  hsv,
  drag,
  emit,
}: {
  hsv: HSVA;
  drag: (el: HTMLElement, e: React.PointerEvent, fn: (x: number, y: number, phase: Phase) => void) => void;
  emit: (next: HSVA, phase: Phase) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hue = Math.round(hsv.h * 10) / 10;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const n = el.width;
    const img = ctx.createImageData(n, n);
    const c = hsvToRgb({ h: hue, s: 1, v: 1, a: 1 });
    for (let py = 0; py < n; py++)
      for (let px = 0; px < n; px++) {
        const w = weights(((px + 0.5) / n) * 2 - 1, ((py + 0.5) / n) * 2 - 1);
        // Un pixel de marge lisse le bord du triangle.
        const edge = Math.min(w.hue, w.white, w.black) * n * 0.75;
        if (edge < -1) continue;
        const [h, wt] = [Math.max(0, w.hue), Math.max(0, w.white)];
        const i = (py * n + px) * 4;
        img.data[i] = c.r * h + 255 * wt;
        img.data[i + 1] = c.g * h + 255 * wt;
        img.data[i + 2] = c.b * h + 255 * wt;
        img.data[i + 3] = 255 * Math.min(1, edge + 1);
      }
    ctx.putImageData(img, 0, 0);
  }, [hue]);

  // Position du curseur : poids des sommets d'après saturation et luminosité.
  const wh = hsv.s * hsv.v;
  const ww = hsv.v - wh;
  const wb = 1 - hsv.v;
  const ux = TRI.hue[0] * wh + TRI.white[0] * ww + TRI.black[0] * wb;
  const uy = TRI.hue[1] * wh + TRI.white[1] * ww + TRI.black[1] * wb;
  const a = (hsv.h * Math.PI) / 180;
  const kx = ux * Math.cos(a) - uy * Math.sin(a);
  const ky = ux * Math.sin(a) + uy * Math.cos(a);

  const pick = (x: number, y: number, phase: Phase) => {
    // Coordonnées dans la roue (0..1) vers le repère du triangle non tourné.
    const dx = (x - 0.5) / TRI_R;
    const dy = (y - 0.5) / TRI_R;
    const ux2 = dx * Math.cos(-a) - dy * Math.sin(-a);
    const uy2 = dx * Math.sin(-a) + dy * Math.cos(-a);
    const w = clampWeights(weights(ux2, uy2));
    const v = w.hue + w.white;
    emit({ ...hsv, v, s: v > 0 ? Math.min(1, w.hue / v) : 0 }, phase);
  };

  return (
    <div
      className="wheel-tri"
      role="slider"
      aria-label="Saturation"
      aria-valuenow={Math.round(hsv.s * 100)}
      tabIndex={0}
      data-testid="color-triangle"
      onPointerDown={(e) => {
        // Le glissement se mesure sur la roue entière ; hors du triangle, le point revient au bord.
        const wheelEl = e.currentTarget.parentElement!;
        drag(wheelEl, e, pick);
      }}
      onKeyDown={(e) => {
        const d = e.shiftKey ? 0.1 : 0.01;
        if (e.key === 'ArrowRight') emit({ ...hsv, s: Math.min(1, hsv.s + d) }, 'set');
        if (e.key === 'ArrowLeft') emit({ ...hsv, s: Math.max(0, hsv.s - d) }, 'set');
        if (e.key === 'ArrowUp') emit({ ...hsv, v: Math.min(1, hsv.v + d) }, 'set');
        if (e.key === 'ArrowDown') emit({ ...hsv, v: Math.max(0, hsv.v - d) }, 'set');
      }}
    >
      <canvas ref={canvas} width={128} height={128} style={{ transform: `rotate(${hue}deg)` }} />
      <div
        className="sv-knob"
        style={{
          left: `${50 + 50 * kx}%`,
          top: `${50 + 50 * ky}%`,
          background: formatColor({ ...hsvToRgb(hsv), a: 1 }),
        }}
      />
    </div>
  );
}

/** Poids barycentriques (teinte, blanc, noir) d'un point du repère du triangle. */
function weights(x: number, y: number): { hue: number; white: number; black: number } {
  const [ax, ay] = TRI.hue;
  const [bx, by] = TRI.white;
  const [cx, cy] = TRI.black;
  const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const hue = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
  const white = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
  return { hue, white, black: 1 - hue - white };
}

/** Ramène un point sur le triangle (le plus proche de ses bords). */
function clampWeights(w: { hue: number; white: number; black: number }) {
  let { hue, white, black } = w;
  hue = Math.max(0, hue);
  white = Math.max(0, white);
  black = Math.max(0, black);
  const sum = hue + white + black || 1;
  return { hue: hue / sum, white: white / sum, black: black / sum };
}

function HexField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const t = useT();
  const [text, setText] = useState(value.slice(1).toUpperCase());
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value.slice(1).toUpperCase());
  }, [value, focused]);
  const commit = () => {
    const hex = normalizeHex(text);
    if (hex) onChange(hex);
    else setText(value.slice(1).toUpperCase());
  };
  return (
    <label className="field hex">
      <span className="field-label">#</span>
      <input
        className="num"
        value={text}
        aria-label={t('color.hex')}
        data-testid="hex-input"
        maxLength={9}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}
