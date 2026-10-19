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
  /** Pas de réglage d'opacité (couleurs toujours opaques). */
  noAlpha?: boolean;
}) {
  const t = useT();
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
      {wheel ? (
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
          {svSquare('sv wheel-sv')}
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
