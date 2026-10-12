import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { Slider } from '../components/PhotoContext';
import { brushSettings, isBrushTool, setBrush, useUi } from '../store';
import { BrushPresets } from '../tools/brushes/BrushPresets';

/** Panneau Pinceau : taille, dureté, opacité et flux de l'outil de peinture actif, avec un aperçu du trait. */
export function BrushPanel() {
  const t = useT();
  const tool = useUi((s) => s.tool);
  useUi((s) => s.brushes);
  const color = useUi((s) => s.brushColor);
  const ref = useRef<HTMLCanvasElement>(null);
  const b = brushSettings(tool);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const r = Math.min(26, Math.max(1, b.size / 2));
    const h = Math.min(0.99, b.hardness / 100);
    // Trait en S, touche après touche, comme le vrai pinceau.
    for (let i = 0; i <= 60; i++) {
      const x = 20 + (i / 60) * (c.width - 40);
      const y = c.height / 2 + Math.sin((i / 60) * Math.PI * 2) * 14;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(h, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = (b.flow / 100) * 0.35 * (b.opacity / 100);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, [b.size, b.hardness, b.flow, b.opacity, color]);
  if (!isBrushTool(tool)) return <p className="panel-body note">{t('brush.none')}</p>;
  return (
    <div className="panel-body brush-panel">
      <canvas ref={ref} className="brush-preview" width={240} height={64} aria-label={t('brush.preview')} />
      <Slider
        label={t('ctx.size')}
        value={b.size}
        min={1}
        max={1000}
        unit="px"
        onChange={(size) => setBrush({ size })}
      />
      <Slider
        label={t('ctx.hardness')}
        value={b.hardness}
        min={0}
        max={100}
        unit="%"
        onChange={(hardness) => setBrush({ hardness })}
      />
      <Slider
        label={t('ctx.opacity')}
        value={b.opacity}
        min={1}
        max={100}
        unit="%"
        onChange={(opacity) => setBrush({ opacity })}
      />
      <Slider
        label={t('ctx.flow')}
        value={b.flow}
        min={1}
        max={100}
        unit="%"
        onChange={(flow) => setBrush({ flow })}
      />
      <BrushPresets />
    </div>
  );
}
