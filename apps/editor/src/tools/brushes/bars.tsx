import { useEffect, useRef, useState } from 'react';
import { BLEND_MODES, type BlendMode, type ToneRange } from '@poulpe/core';
import { Modal } from '../../components/Dialogs';
import { Slider } from '../../components/PhotoContext';
import { NumberField, Select } from '../../components/fields';
import { useT } from '../../i18n';
import { SelectionRefine } from '../../photo/selection';
import { isBrushTool, useStore, useUi, type ToolId } from '../../store';
import {
  brushOptions,
  type BrushOptions,
  type CloneSource,
  type LassoMode,
  type SampleSource,
} from './state';

/*
 * Options de la barre contextuelle ajoutées aux pinceaux et aux sélections de la Persona Photo
 * (stabilisateur, mode de fusion, plage de tons, source du tampon, tracé depuis le centre, modes
 * du lasso…), et la fenêtre « Affiner la sélection ».
 */

const set = (patch: Partial<BrushOptions>) => brushOptions.set(patch);

function Check({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function BlendSelect({
  value,
  onChange,
  testId,
}: {
  value: BlendMode;
  onChange: (m: BlendMode) => void;
  testId: string;
}) {
  const t = useT();
  return (
    <Select<BlendMode>
      label={t('layers.blend')}
      value={value}
      testId={testId}
      options={BLEND_MODES.map((m) => ({ value: m, label: t(`blend.${m}`) }))}
      onChange={onChange}
    />
  );
}

function SourceSelect({
  value,
  onChange,
  testId,
}: {
  value: SampleSource;
  onChange: (s: SampleSource) => void;
  testId: string;
}) {
  const t = useT();
  return (
    <Select<SampleSource>
      label={t('brushes.source')}
      value={value}
      testId={testId}
      options={[
        { value: 'layer', label: t('brushes.source.layer') },
        { value: 'all', label: t('brushes.source.all') },
      ]}
      onChange={onChange}
    />
  );
}

/** Stabilisateur : corde ou fenêtre, et sa longueur. */
function StabilizerFields() {
  const t = useT();
  const o = useStore(brushOptions, (s) => s);
  return (
    <>
      <Check
        label={t('brushes.stabilizer')}
        checked={o.stabilizer}
        testId="brush-stabilizer"
        onChange={(stabilizer) => set({ stabilizer })}
      />
      {o.stabilizer && (
        <>
          <Select<'rope' | 'window'>
            value={o.stabilizerMode}
            testId="brush-stabilizer-mode"
            options={[
              { value: 'rope', label: t('brushes.rope') },
              { value: 'window', label: t('brushes.window') },
            ]}
            onChange={(stabilizerMode) => set({ stabilizerMode })}
          />
          {o.stabilizerMode === 'rope' ? (
            <NumberField
              label={t('brushes.ropeLength')}
              value={o.ropeLength}
              min={1}
              max={500}
              unit="px"
              width={70}
              onChange={(ropeLength) => set({ ropeLength })}
            />
          ) : (
            <NumberField
              label={t('brushes.windowSize')}
              value={o.windowSize}
              min={2}
              max={60}
              width={60}
              onChange={(windowSize) => set({ windowSize })}
            />
          )}
        </>
      )}
    </>
  );
}

const LASSO_MODES: LassoMode[] = ['freehand', 'polygonal', 'magnetic'];

function LassoModes() {
  const t = useT();
  const mode = useStore(brushOptions, (s) => s.lassoMode);
  return (
    <span className="seg small" role="group" aria-label={t('ctx.mode')}>
      {LASSO_MODES.map((m) => (
        <button
          key={m}
          aria-pressed={mode === m}
          data-testid={`lasso-${m}`}
          onClick={() => set({ lassoMode: m })}
        >
          {t(`brushes.lasso.${m}`)}
        </button>
      ))}
    </span>
  );
}

/** Bouton « Affiner » des outils de sélection, et sa fenêtre. */
function RefineButton() {
  const t = useT();
  const has = useUi((s) => s.hasPixelSelection);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="btn small"
        disabled={!has}
        data-testid="selection-refine"
        onClick={() => setOpen(true)}
      >
        {t('brushes.refine')}
      </button>
      {open && <RefineDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Affiner la sélection : agrandir ou réduire, lisser, adoucir, avec un aperçu en direct sur le
 * canevas. Valider fait une seule étape d'historique, Annuler rend la sélection de départ.
 */
export function RefineDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [session] = useState(() => SelectionRefine.start());
  const done = useRef(false);
  const [adjust, setAdjust] = useState(0);
  const [smooth, setSmooth] = useState(0);
  const [feather, setFeather] = useState(0);
  useEffect(() => {
    const s = session;
    if (!s || done.current) return;
    // Petit délai : sur une grande photo, le calcul suit le curseur sans le freiner.
    const timer = setTimeout(() => s.preview({ adjust, smooth, feather }), 60);
    return () => clearTimeout(timer);
  }, [session, adjust, smooth, feather]);
  // Fenêtre fermée sans valider (changement d'outil…) : la sélection de départ revient.
  useEffect(
    () => () => {
      if (!done.current) session?.cancel();
    },
    [session],
  );
  const finish = (apply: boolean) => {
    const s = session;
    done.current = true;
    if (s) {
      if (apply) {
        s.preview({ adjust, smooth, feather });
        s.apply();
      } else s.cancel();
    }
    onClose();
  };
  return (
    <Modal title={t('refine.title')} onClose={() => finish(false)}>
      <div className="brushes-refine">
        <Slider
          label={t('refine.adjust')}
          value={adjust}
          min={-100}
          max={100}
          unit="px"
          testId="refine-adjust"
          onChange={setAdjust}
        />
        <Slider label={t('refine.smooth')} value={smooth} min={0} max={100} unit="px" onChange={setSmooth} />
        <Slider
          label={t('refine.feather')}
          value={feather}
          min={0}
          max={250}
          unit="px"
          testId="refine-feather"
          onChange={setFeather}
        />
        <p className="note">{t('refine.note')}</p>
      </div>
      <footer>
        <button className="btn" onClick={() => finish(false)}>
          {t('new.cancel')}
        </button>
        <button className="btn primary" data-testid="refine-apply" onClick={() => finish(true)}>
          {t('filter.apply')}
        </button>
      </footer>
    </Modal>
  );
}

const SELECT_TOOLS: ToolId[] = ['marqueeRect', 'marqueeEllipse', 'lasso', 'magicWand', 'quickSelect'];

/** Options ajoutées à la fin de la barre contextuelle des outils de la Persona Photo. */
export function BrushesExtra() {
  const t = useT();
  const tool = useUi((s) => s.tool);
  const persona = useUi((s) => s.persona);
  const o = useStore(brushOptions, (s) => s);
  if (persona !== 'photo') return null;
  const brushLike = isBrushTool(tool) && tool !== 'quickSelect';
  return (
    <>
      {tool === 'brush' && (
        <>
          <BlendSelect value={o.blend} testId="brush-blend" onChange={(blend) => set({ blend })} />
          <Check
            label={t('brushes.protectAlpha')}
            checked={o.protectAlpha}
            testId="brush-protect-alpha"
            onChange={(protectAlpha) => set({ protectAlpha })}
          />
        </>
      )}
      {tool === 'fill' && (
        <>
          <BlendSelect value={o.fillBlend} testId="fill-blend" onChange={(fillBlend) => set({ fillBlend })} />
          <SourceSelect
            value={o.fillSource}
            testId="fill-source"
            onChange={(fillSource) => set({ fillSource })}
          />
        </>
      )}
      {(tool === 'dodge' || tool === 'burn') && (
        <>
          <Select<ToneRange>
            label={t('brushes.tonalRange')}
            value={o.toneRange}
            testId="tone-range"
            options={(['shadows', 'midtones', 'highlights'] as const).map((r) => ({
              value: r,
              label: t(`brushes.tone.${r}`),
            }))}
            onChange={(toneRange) => set({ toneRange })}
          />
          <Check
            label={t('brushes.protectHue')}
            checked={o.protectHue}
            testId="protect-hue"
            onChange={(protectHue) => set({ protectHue })}
          />
        </>
      )}
      {(tool === 'clone' || tool === 'heal') && (
        <>
          <Check
            label={t('brushes.aligned')}
            checked={o.aligned}
            testId="clone-aligned"
            onChange={(aligned) => set({ aligned })}
          />
          <Select<CloneSource>
            label={t('brushes.source')}
            value={o.cloneSource}
            testId="clone-source"
            options={(['layer', 'layerBelow', 'below'] as const).map((s) => ({
              value: s,
              label: t(`brushes.clone.${s}`),
            }))}
            onChange={(cloneSource) => set({ cloneSource })}
          />
        </>
      )}
      {tool === 'clone' && (
        <>
          <NumberField
            label={t('brushes.rotation')}
            value={o.cloneRotation}
            min={-180}
            max={180}
            unit="°"
            width={64}
            testId="clone-rotation"
            onChange={(cloneRotation) => set({ cloneRotation })}
          />
          <NumberField
            label={t('brushes.scale')}
            value={o.cloneScale}
            min={1}
            max={1000}
            unit="%"
            width={64}
            testId="clone-scale"
            onChange={(cloneScale) => set({ cloneScale })}
          />
        </>
      )}
      {brushLike && <StabilizerFields />}
      {(tool === 'marqueeRect' || tool === 'marqueeEllipse') && (
        <>
          <Check
            label={t('brushes.fromCenter')}
            checked={o.fromCenter}
            testId="marquee-center"
            onChange={(fromCenter) => set({ fromCenter })}
          />
          <Check
            label={t('brushes.antialias')}
            checked={o.antialias}
            testId="marquee-antialias"
            onChange={(antialias) => set({ antialias })}
          />
        </>
      )}
      {tool === 'lasso' && (
        <>
          <LassoModes />
          {o.lassoMode === 'magnetic' && (
            <NumberField
              label={t('brushes.magneticWidth')}
              value={o.magneticWidth}
              min={2}
              max={60}
              unit="px"
              width={60}
              onChange={(magneticWidth) => set({ magneticWidth })}
            />
          )}
          {o.lassoMode !== 'freehand' && (
            <span className="ctx-dim">
              {t(o.lassoMode === 'magnetic' ? 'brushes.magneticHint' : 'ctx.polyLassoHint')}
            </span>
          )}
        </>
      )}
      {tool === 'magicWand' && (
        <>
          <SourceSelect
            value={o.wandSource}
            testId="wand-source"
            onChange={(wandSource) => set({ wandSource })}
          />
          <span className="ctx-dim">{t('brushes.wandHint')}</span>
        </>
      )}
      {SELECT_TOOLS.includes(tool) && <RefineButton />}
    </>
  );
}
