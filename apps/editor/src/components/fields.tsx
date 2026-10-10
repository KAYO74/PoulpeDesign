import { useEffect, useState } from 'react';
import { rgbaToCss, type Paint } from '@poulpe/core';

/** Champ numérique : Entrée ou sortie du champ pour valider, flèches pour ajuster (Maj : ×10). */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  decimals = 0,
  width,
  testId,
  disabled,
}: {
  label?: string;
  value: number | null;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  decimals?: number;
  width?: number;
  testId?: string;
  disabled?: boolean;
}) {
  const fmt = (v: number | null) => (v === null || Number.isNaN(v) ? '' : String(+v.toFixed(decimals)));
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (raw: string) => {
    const v = parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(v)) {
      const c = clamp(v);
      if (c !== value) onChange(c);
      setText(fmt(c));
    } else setText(fmt(value));
  };
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input
        className="num"
        style={{ width: `${width && width >= 110 ? 5.5 : 3.6}em` }}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        data-testid={testId}
        aria-label={label}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={(e) => {
          setFocused(false);
          commit(e.target.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = parseFloat(text.replace(',', '.')) || 0;
            const next = clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setText(fmt(next));
            onChange(next);
          }
        }}
      />
      {unit && <span className="field-unit">{unit}</span>}
    </label>
  );
}

/** Aperçu d'une peinture (uni, dégradé, aucune) pour les pastilles de couleur. */
export function paintPreview(p: Paint): string {
  switch (p.type) {
    case 'none':
      return 'linear-gradient(135deg, transparent 45%, #e5484d 45%, #e5484d 55%, transparent 55%), #fff';
    case 'solid':
      return `linear-gradient(${rgbaToCss(p.color)}, ${rgbaToCss(p.color)}), var(--checker)`;
    case 'linear':
      return `linear-gradient(${p.angle + 90}deg, ${p.stops.map((s) => `${rgbaToCss(s.color)} ${s.offset * 100}%`).join(', ')}), var(--checker)`;
    case 'radial':
      return `radial-gradient(circle at ${p.cx * 100}% ${p.cy * 100}%, ${p.stops.map((s) => `${rgbaToCss(s.color)} ${s.offset * 100}%`).join(', ')}), var(--checker)`;
    case 'conic':
      return `conic-gradient(from ${p.angle}deg at ${p.cx * 100}% ${p.cy * 100}%, ${p.stops.map((s) => `${rgbaToCss(s.color)} ${s.offset * 360}deg`).join(', ')}), var(--checker)`;
    case 'pattern':
      // L'image du motif n'est pas disponible ici : des hachures signalent un remplissage par motif.
      return 'repeating-linear-gradient(45deg, #8b8b92 0 3px, #d9d9de 3px 6px)';
  }
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  width,
  testId,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
  width?: number;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field" style={width ? { width } : undefined}>
      {label && <span className="field-label">{label}</span>}
      <select
        data-testid={testId}
        disabled={disabled}
        value={String(value)}
        aria-label={label}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
