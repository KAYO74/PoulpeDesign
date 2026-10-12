import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { type PoulpeDocument, type SceneNode, type TextWrap } from '@poulpe/core';
import { NumberField, Select } from '../../components/fields';
import { useT } from '../../i18n';
import { useEditor, useUi } from '../../store';
import {
  DEFAULT_DISTANCE,
  autoFlow,
  chainOverflows,
  convertToTextFrame,
  convertibleShapes,
  setFrameSettings,
  setWrap,
  targetFrames,
  wrapTargets,
} from './actions';

/*
 * Réglages de la mise en page du texte ajoutés à la fin de la barre contextuelle : l'habillage de
 * l'objet sélectionné (style, côtés, distance), les réglages du cadre de texte (marges intérieures,
 * débordement, habillage ignoré, coulée automatique) et « Convertir en cadre de texte ».
 */

/** Icônes des styles d'habillage (16 × 16, au trait, comme `components/Icon.tsx`). */
const WRAP_ICONS: Record<TextWrap['type'] | 'none', string> = {
  none: 'M2 3.5h12 M2 6.5h12 M2 9.5h12 M2 12.5h12 M6 5h4v6h-4z',
  square: 'M2 3.5h12 M2 6.5h3 M11 6.5h3 M2 9.5h3 M11 9.5h3 M2 12.5h12 M6.5 5.5h3v5h-3z',
  tight: 'M2 3.5h12 M2 6.5h4 M10 6.5h4 M2 9.5h4 M10 9.5h4 M2 12.5h12 M8 5.5a2 2.5 0 1 0 .01 0',
  jump: 'M2 2.5h12 M2 13.5h12 M5.5 5h5v6h-5z',
  through: 'M2 3.5h12 M2 6.5h12 M2 9.5h12 M2 12.5h12 M6 5h4v6h-4z M6 5l4 6',
};

const WRAP_TYPES = ['none', 'square', 'tight', 'jump', 'through'] as const;

function WrapIcon({ type }: { type: (typeof WRAP_TYPES)[number] }) {
  return (
    <svg className="i" width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <path d={WRAP_ICONS[type]} />
    </svg>
  );
}

/**
 * Bouton qui ouvre un petit panneau sous lui. Le panneau reste dans la barre (il ne ferme pas
 * l'édition d'un texte) mais se place par-dessus le canevas, en position fixe.
 */
function Popover({
  label,
  title,
  testId,
  active,
  children,
}: {
  label: ReactNode;
  title: string;
  testId: string;
  active?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = panel.current?.offsetWidth ?? 280;
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), y: r.bottom + 6 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        className="btn small"
        title={title}
        aria-expanded={open}
        aria-pressed={active}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <span className="tf-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={panel}
          className="tf-pop"
          role="dialog"
          aria-label={title}
          data-testid={`${testId}-panel`}
          style={{ left: pos.x, top: pos.y }}
        >
          {children}
        </div>
      )}
    </>
  );
}

/** Habillage des objets sélectionnés. */
function WrapPanel({ node }: { node: SceneNode }) {
  const t = useT();
  const w = node.wrap;
  const type = w?.type ?? 'none';
  const pushes = type === 'square' || type === 'tight' || type === 'jump';
  return (
    <>
      <div className="tf-row">
        <span className="tf-label">{t('tf.wrapStyle')}</span>
        <span className="ctx-group" role="group" aria-label={t('tf.wrapStyle')}>
          {WRAP_TYPES.map((k) => (
            <button
              key={k}
              className="btn small icon"
              title={t(`tf.wrap.${k}`)}
              aria-label={t(`tf.wrap.${k}`)}
              aria-pressed={type === k}
              data-testid={`wrap-${k}`}
              onClick={() => setWrap({ type: k })}
            >
              <WrapIcon type={k} />
            </button>
          ))}
        </span>
      </div>
      <div className="tf-row">
        <Select
          label={t('tf.wrapSide')}
          value={w?.side ?? 'both'}
          testId="wrap-side"
          disabled={!pushes || type === 'jump'}
          options={(['both', 'left', 'right', 'largest'] as const).map((v) => ({
            value: v,
            label: t(`tf.side.${v}`),
          }))}
          onChange={(side) => setWrap({ side })}
        />
      </div>
      <div className="tf-row">
        <NumberField
          label={t('tf.wrapDistance')}
          value={pushes ? (w?.distance ?? 0) : DEFAULT_DISTANCE}
          min={0}
          max={2000}
          unit="px"
          width={90}
          disabled={!pushes}
          testId="wrap-distance"
          onChange={(distance) => setWrap({ distance })}
        />
      </div>
      <p className="tf-note">{t('tf.wrapNote')}</p>
    </>
  );
}

/** Réglages des cadres de texte sélectionnés. */
function FramePanel({ frame }: { frame: SceneNode & { type: 'text' } }) {
  const t = useT();
  const insets = frame.insets ?? [0, 0, 0, 0];
  const same = insets.every((v) => v === insets[0]);
  const [linked, setLinked] = useState(same);
  const overflow = chainOverflows(frame.id);
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  return (
    <>
      <div className="tf-row">
        <span className="tf-label">{t('tf.insets')}</span>
        <label className="check">
          <input
            type="checkbox"
            checked={linked}
            data-testid="frame-insets-linked"
            onChange={(e) => {
              setLinked(e.target.checked);
              if (e.target.checked && !same)
                setFrameSettings({ insets: [insets[0], insets[0], insets[0], insets[0]] });
            }}
          />
          {t('tf.insetsSame')}
        </label>
      </div>
      {linked ? (
        <div className="tf-row">
          <NumberField
            label={t('tf.inset')}
            value={insets[0]}
            min={0}
            max={2000}
            unit="px"
            width={90}
            testId="frame-inset"
            onChange={(v) => setFrameSettings({ insets: [v, v, v, v] })}
          />
        </div>
      ) : (
        <div className="tf-grid">
          {sides.map((side, i) => (
            <NumberField
              key={side}
              label={t(`tf.inset.${side}`)}
              value={insets[i]}
              min={0}
              max={2000}
              unit="px"
              width={90}
              testId={`frame-inset-${side}`}
              onChange={(v) => {
                const next = [...insets] as [number, number, number, number];
                next[i] = v;
                setFrameSettings({ insets: next });
              }}
            />
          ))}
        </div>
      )}
      <label className="check tf-row">
        <input
          type="checkbox"
          checked={!!frame.hideOverflow}
          data-testid="frame-hide-overflow"
          onChange={(e) => setFrameSettings({ hideOverflow: e.target.checked })}
        />
        {t('tf.hideOverflow')}
      </label>
      <label className="check tf-row">
        <input
          type="checkbox"
          checked={!!frame.ignoreWrap}
          data-testid="frame-ignore-wrap"
          onChange={(e) => setFrameSettings({ ignoreWrap: e.target.checked })}
        />
        {t('tf.ignoreWrap')}
      </label>
      <div className="tf-row">
        <button
          className="btn small"
          disabled={!overflow}
          title={t('tf.autoFlowHint')}
          data-testid="frame-autoflow"
          onClick={() => autoFlow(frame.id)}
        >
          {t('tf.autoFlow')}
        </button>
      </div>
    </>
  );
}

const framesCache = new WeakMap<PoulpeDocument, boolean>();

/** Le document a-t-il des cadres de texte (l'habillage y sert) ? */
function hasFrames(doc: PoulpeDocument): boolean {
  const hit = framesCache.get(doc);
  if (hit !== undefined) return hit;
  const visit = (nodes: readonly SceneNode[]): boolean =>
    nodes.some(
      (n) => (n.type === 'text' && (!!n.frame || !!n.next)) || (n.type === 'group' && visit(n.children)),
    );
  const out = doc.artboards.some((a) => visit(a.children));
  framesCache.set(doc, out);
  return out;
}

/** Ajouté à la fin de la barre contextuelle (outils Déplacer, Texte artistique et Cadre de texte). */
export function TextFlowExtra() {
  const t = useT();
  // La sélection et le document changent ce qui est montré : la barre suit l'éditeur.
  const { doc } = useEditor();
  const tool = useUi((s) => s.tool);
  const persona = useUi((s) => s.persona);
  const editing = useUi((s) => s.editingTextId);
  if (persona === 'photo' || editing) return null;
  if (tool !== 'select' && tool !== 'text' && tool !== 'frameText') return null;
  const targets = tool === 'select' ? wrapTargets() : [];
  const showWrap =
    targets.length > 0 && (persona === 'layout' || hasFrames(doc) || targets.some((n) => n.wrap));
  const frame = targetFrames()[0] ?? null;
  const convert = tool === 'select' && convertibleShapes().length > 0;
  if (!showWrap && !frame && !convert) return null;
  const node = targets[0];
  return (
    <>
      <span className="tsep" />
      {showWrap && node && (
        <Popover
          label={t('tf.wrap')}
          title={t('tf.wrapTitle')}
          testId="wrap-button"
          active={!!node.wrap && node.wrap.type !== 'through'}
        >
          <WrapPanel node={node} />
        </Popover>
      )}
      {frame && (
        <Popover label={t('tf.frame')} title={t('tf.frameTitle')} testId="frame-settings">
          <FramePanel frame={frame} />
        </Popover>
      )}
      {convert && (
        <button className="btn small" data-testid="to-text-frame" onClick={convertToTextFrame}>
          {t('tf.toTextFrame')}
        </button>
      )}
    </>
  );
}
