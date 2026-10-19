import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Slider } from '../../components/PhotoContext';
import { useT } from '../../i18n';
import { FloatingFrame } from '../../panels/FloatingFrame';
import {
  dockPanel,
  floatPanel,
  panels,
  startPanelDrag,
  usePanels,
  type PanelId,
} from '../../panels/panelLayout';
import { brushSettings, isBrushTool, setBrush, toast, useStore, useUi } from '../../store';
import { saveCurrentPreset } from './presets';
import { drawStrokePreview } from './preview';
import { addTips, brushTips, deleteTip, importAbr, preloadTips, tipFromImageFile } from './tips';

/** Fenêtre de création de pinceau : toujours flottante, on peint sur le document pendant qu'elle est ouverte. */
export const BRUSH_EDITOR: PanelId = 'brush-editor';

const SIZE = { w: 300, h: 600 };

export function openBrushEditor(anchor?: Element | null): void {
  if (panels.get().floating[BRUSH_EDITOR]) return;
  const r = anchor?.getBoundingClientRect();
  const x = r ? (r.left > window.innerWidth / 2 ? r.left - SIZE.w - 12 : r.right + 12) : 120;
  const y = Math.max(8, Math.min(r?.top ?? 80, window.innerHeight - SIZE.h - 8));
  floatPanel(BRUSH_EDITOR, { x, y, ...SIZE });
}

export function toggleBrushEditor(): void {
  if (panels.get().floating[BRUSH_EDITOR]) dockPanel(BRUSH_EDITOR);
  else openBrushEditor();
}

/**
 * Création de pinceau, comme dans Affinity et Photoshop : forme (ronde, depuis une image ou
 * importée d'un fichier .abr), espacement, angle, rondeur et variations au hasard. Les réglages
 * s'appliquent tout de suite à l'outil actif, pour essayer sur le document.
 */
export function BrushEditor() {
  const t = useT();
  const head = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const tool = useUi((s) => s.tool);
  const color = useUi((s) => s.brushColor);
  useUi((s) => s.brushes);
  const open = usePanels((s) => !!s.floating[BRUSH_EDITOR]);
  const tips = useStore(brushTips, (s) => s.list);
  const [name, setName] = useState('');
  const b = brushSettings(tool);
  useEffect(() => {
    if (open) preloadTips();
  }, [open]);
  useEffect(() => {
    if (preview.current) drawStrokePreview(preview.current, b, color, 30);
  });

  const pickTip = (tip?: string) =>
    // Une forme dessinée se pose touche à touche : un espacement plus large par défaut.
    setBrush({ tip, spacing: tip && b.spacing === undefined ? 25 : b.spacing });

  const fromImage = async (file: File | undefined) => {
    if (!file) return;
    const tip = await tipFromImageFile(file, file.name.replace(/\.[^.]+$/, ''));
    if (!tip) return toast(t('brushEditor.emptyImage'));
    addTips([tip]);
    pickTip(tip.id);
  };
  const fromAbr = async (file: File | undefined) => {
    if (!file) return;
    const added = importAbr(await file.arrayBuffer(), file.name);
    if (!added.length) return toast(t('brushEditor.abrNone'));
    toast(t('brushEditor.abrDone', { n: added.length }));
    pickTip(added[0].id);
  };
  const save = () => {
    if (!name.trim()) return;
    saveCurrentPreset(name);
    setName('');
    toast(t('brushEditor.saved'));
  };

  return (
    <FloatingFrame id={BRUSH_EDITOR} label={t('brushEditor.title')} className="brush-editor">
      <div
        ref={head}
        className="float-head panel-handle"
        onPointerDown={(e) => startPanelDrag(e, BRUSH_EDITOR, head.current?.parentElement ?? null)}
      >
        <span className="float-title">{t('brushEditor.title')}</span>
        <button
          className="ib small"
          data-no-drag
          title={t('common.close')}
          aria-label={t('common.close')}
          data-testid="brush-editor-close"
          onClick={() => dockPanel(BRUSH_EDITOR)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="panel-body brush-editor-body">
        {!isBrushTool(tool) ? (
          <p className="note">{t('brush.none')}</p>
        ) : (
          <>
            <canvas
              ref={preview}
              className="brush-preview"
              width={260}
              height={80}
              aria-label={t('brush.preview')}
              data-testid="brush-editor-preview"
            />
            <h4 className="sub">{t('brushEditor.shape')}</h4>
            <div className="brush-tips" role="listbox" aria-label={t('brushEditor.shape')}>
              <button
                role="option"
                aria-selected={!b.tip}
                className="brush-tip round"
                title={t('brushEditor.round')}
                data-testid="brush-tip-round"
                onClick={() => pickTip(undefined)}
              >
                <span className="brush-tip-dot" />
              </button>
              {tips.map((tip) => (
                <button
                  key={tip.id}
                  role="option"
                  aria-selected={b.tip === tip.id}
                  className="brush-tip"
                  title={tip.name}
                  data-testid={`brush-tip-${tip.id}`}
                  onClick={() => pickTip(tip.id)}
                >
                  <img src={tip.data} alt={tip.name} />
                </button>
              ))}
            </div>
            <div className="picker-row">
              <label className="chip-btn file-btn">
                {t('brushEditor.fromImage')}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  data-testid="brush-tip-image"
                  onChange={(e) => {
                    void fromImage(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="chip-btn file-btn">
                {t('brushEditor.importAbr')}
                <input
                  type="file"
                  accept=".abr"
                  hidden
                  data-testid="brush-tip-abr"
                  onChange={(e) => {
                    void fromAbr(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {b.tip && tips.some((x) => x.id === b.tip) && (
                <button
                  className="ib small"
                  title={t('brushEditor.deleteShape')}
                  aria-label={t('brushEditor.deleteShape')}
                  onClick={() => {
                    const id = b.tip!;
                    pickTip(undefined);
                    deleteTip(id);
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              )}
            </div>
            <Slider
              label={t('ctx.size')}
              value={b.size}
              min={1}
              max={1000}
              unit="px"
              onChange={(size) => setBrush({ size })}
            />
            {!b.tip && (
              <Slider
                label={t('ctx.hardness')}
                value={b.hardness}
                min={0}
                max={100}
                unit="%"
                onChange={(hardness) => setBrush({ hardness })}
              />
            )}
            <Slider
              label={t('brushEditor.spacing')}
              value={b.spacing ?? 10}
              min={1}
              max={200}
              unit="%"
              testId="brush-spacing"
              onChange={(spacing) => setBrush({ spacing })}
            />
            <Slider
              label={t('brushEditor.angle')}
              value={b.angle ?? 0}
              min={-180}
              max={180}
              unit="°"
              testId="brush-angle"
              onChange={(angle) => setBrush({ angle })}
            />
            <Slider
              label={t('brushEditor.roundness')}
              value={b.roundness ?? 100}
              min={1}
              max={100}
              unit="%"
              testId="brush-roundness"
              onChange={(roundness) => setBrush({ roundness })}
            />
            <h4 className="sub">{t('brushEditor.dynamics')}</h4>
            <Slider
              label={t('brushEditor.sizeJitter')}
              value={b.sizeJitter ?? 0}
              min={0}
              max={100}
              unit="%"
              testId="brush-size-jitter"
              onChange={(sizeJitter) => setBrush({ sizeJitter })}
            />
            <Slider
              label={t('brushEditor.angleJitter')}
              value={b.angleJitter ?? 0}
              min={0}
              max={180}
              unit="°"
              testId="brush-angle-jitter"
              onChange={(angleJitter) => setBrush({ angleJitter })}
            />
            <Slider
              label={t('brushEditor.scatter')}
              value={b.scatter ?? 0}
              min={0}
              max={200}
              unit="%"
              testId="brush-scatter"
              onChange={(scatter) => setBrush({ scatter })}
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
            <p className="note">{t('brushEditor.tryHint')}</p>
            <div className="brushes-save">
              <input
                className="text-input"
                value={name}
                placeholder={t('brush.presetName')}
                aria-label={t('brush.presetName')}
                data-testid="brush-editor-name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
              <button
                className="btn small"
                data-testid="brush-editor-save"
                disabled={!name.trim()}
                onClick={save}
              >
                {t('brush.savePreset')}
              </button>
            </div>
          </>
        )}
      </div>
    </FloatingFrame>
  );
}
