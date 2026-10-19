import { useEffect, useRef } from 'react';
import { drawStrokePreview } from '../tools/brushes/preview';
import { brushTips } from '../tools/brushes/tips';
import { openBrushEditor } from '../tools/brushes/BrushEditor';
import { useT } from '../i18n';
import { Slider } from '../components/PhotoContext';
import { brushSettings, isBrushTool, setBrush, useStore, useUi } from '../store';
import { BrushPresets } from '../tools/brushes/BrushPresets';

/** Panneau Pinceau : taille, dureté, opacité et flux de l'outil de peinture actif, avec un aperçu du trait. */
export function BrushPanel() {
  const t = useT();
  const tool = useUi((s) => s.tool);
  useUi((s) => s.brushes);
  const color = useUi((s) => s.brushColor);
  const ref = useRef<HTMLCanvasElement>(null);
  const b = brushSettings(tool);
  useStore(brushTips, (s) => s.list);
  useEffect(() => {
    if (ref.current) drawStrokePreview(ref.current, b, color);
  });
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
      <button
        className="btn small"
        data-testid="brush-create"
        onClick={(e) => openBrushEditor(e.currentTarget)}
      >
        {t('brushEditor.open')}
      </button>
      <BrushPresets />
    </div>
  );
}
