import { FORMAT_PRESETS, findArtboard, findNode, isStyled, localToWorld, type SceneNode } from '@poulpe/core';
import { setPaint, updateArtboard, updateSelected } from '../actions';
import { useT } from '../i18n';
import { editor, ui, useEditor, useUi, type ToolId } from '../store';
import { getController } from './Viewport';
import { Icon, type IconName } from './Icon';
import type { NodeAction } from '../canvas/pathTools';
import { convertToCurves, removeTextFromPath, setTextPathOffset } from '../vectorActions';
import { canLinkSelection, linkSelection } from '../layoutActions';
import { NumberField, Select, paintPreview } from './fields';
import { PhotoContext } from './PhotoContext';
import { CONTEXT_EXTRAS, contextFor } from '../tools/registry';
import { isPhotoTool } from '../photo/photoTools';

const SHAPES: ToolId[] = ['rect', 'ellipse', 'polygon', 'star', 'line'];

function PaintSwatches({ node }: { node: SceneNode | null }) {
  const t = useT();
  const defaults = useUi((s) => s.defaults);
  const target = useUi((s) => s.colorTarget);
  const fill = node && isStyled(node) ? node.fill : defaults.fill;
  const stroke = node && isStyled(node) ? node.stroke : defaults.stroke;
  const setWidth = (w: number) => {
    if (node)
      updateSelected('history.style', (n) => void (isStyled(n) && (n.stroke = { ...n.stroke, width: w })), {
        deep: true,
      });
    else ui.set({ defaults: { ...defaults, stroke: { ...defaults.stroke, width: w } } });
  };
  return (
    <>
      <span className="ctx-label">{t('ctx.fill')}</span>
      <button
        className={`chip${target === 'fill' ? ' on' : ''}`}
        style={{ background: paintPreview(fill) }}
        aria-label={t('ctx.fill')}
        title={t('ctx.fill')}
        onClick={() => ui.set({ colorTarget: 'fill' })}
        onDoubleClick={() => setPaint('fill', { type: 'none' })}
      />
      <span className="ctx-label">{t('ctx.stroke')}</span>
      <button
        className={`chip ring${target === 'stroke' ? ' on' : ''}`}
        style={{ background: paintPreview(stroke.paint) }}
        aria-label={t('ctx.stroke')}
        title={t('ctx.stroke')}
        onClick={() => ui.set({ colorTarget: 'stroke' })}
      />
      <NumberField
        value={stroke.width}
        min={0}
        max={500}
        step={1}
        unit="px"
        width={96}
        onChange={setWidth}
        label={t('stroke.width')}
      />
    </>
  );
}

export function ContextBar() {
  const t = useT();
  const { doc, selection, activeArtboardId } = useEditor();
  const tool = useUi((s) => s.tool);
  const defaults = useUi((s) => s.defaults);
  const cropId = useUi((s) => s.cropId);
  const smoothing = useUi((s) => s.pencilSmoothing);
  const cornerRadius = useUi((s) => s.cornerRadiusTool);
  const cornerKind = useUi((s) => s.cornerKind);
  const node = selection.length === 1 ? (findNode(doc, selection[0])?.node ?? null) : null;
  const ab = findArtboard(doc, activeArtboardId);

  const toolName = t(`tool.${tool}`);
  let content: React.ReactNode;
  const Own = contextFor(tool);

  if (Own) {
    content = <Own />;
  } else if (isPhotoTool(tool)) {
    content = <PhotoContext tool={tool} />;
  } else if (tool === 'pen' || tool === 'pencil') {
    content = (
      <>
        <PaintSwatches node={null} />
        {tool === 'pencil' && (
          <label className="field">
            <span className="field-label">{t('ctx.smoothing')}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={smoothing}
              aria-label={t('ctx.smoothing')}
              data-testid="pencil-smoothing"
              onChange={(e) => ui.set({ pencilSmoothing: Number(e.target.value) })}
            />
          </label>
        )}
        <span className="ctx-dim">{t(tool === 'pen' ? 'ctx.penHint' : 'ctx.pencilHint')}</span>
      </>
    );
  } else if (tool === 'corner') {
    content = (
      <>
        <NumberField
          label={t('ctx.cornerRadius')}
          value={cornerRadius}
          min={0}
          max={500}
          unit="px"
          testId="corner-radius"
          onChange={(cornerRadiusTool) => ui.set({ cornerRadiusTool })}
        />
        <Select
          label={t('ctx.cornerKind')}
          value={cornerKind}
          testId="corner-kind"
          options={(['round', 'chamfer'] as const).map((k) => ({ value: k, label: t(`ctx.corner.${k}`) }))}
          onChange={(k) => ui.set({ cornerKind: k })}
        />
        <span className="ctx-dim">{t('ctx.cornerHint')}</span>
      </>
    );
  } else if (tool === 'scissors' || tool === 'knife' || tool === 'shapeBuilder') {
    content = <span className="ctx-dim">{t(`ctx.${tool}Hint`)}</span>;
  } else if (tool === 'artboard' && ab) {
    const preset = FORMAT_PRESETS.find((f) => f.width === ab.width && f.height === ab.height)?.id ?? 'custom';
    content = (
      <>
        <span className="ctx-dim">{ab.name}</span>
        <Select
          label={t('ctx.artboardFormat')}
          value={preset}
          options={[
            { value: 'custom', label: t('new.custom') },
            ...FORMAT_PRESETS.map((f) => ({
              value: f.id,
              label: `${t(`format.${f.id}`)} · ${f.width} × ${f.height}`,
            })),
          ]}
          onChange={(id) => {
            const f = FORMAT_PRESETS.find((p) => p.id === id);
            if (f) updateArtboard(ab.id, { width: f.width, height: f.height });
          }}
        />
        <NumberField
          label={t('transform.w')}
          value={ab.width}
          min={1}
          max={20000}
          unit="px"
          width={90}
          onChange={(v) => updateArtboard(ab.id, { width: v })}
        />
        <NumberField
          label={t('transform.h')}
          value={ab.height}
          min={1}
          max={20000}
          unit="px"
          width={90}
          onChange={(v) => updateArtboard(ab.id, { height: v })}
        />
        <span className="ctx-label">{t('document.background')}</span>
        <button
          className="chip"
          style={{ background: paintPreview(ab.background) }}
          aria-label={t('document.background')}
          onClick={() => {
            const cur = ab.background;
            updateArtboard(ab.id, {
              background: cur.type === 'none' ? { type: 'solid', color: '#ffffff' } : { type: 'none' },
            });
          }}
        />
      </>
    );
  } else if (node || SHAPES.includes(tool) || tool === 'text' || (!selection.length && tool === 'select')) {
    const showNew = !selection.length;
    const kind: string = node?.type ?? (tool === 'text' ? 'text' : tool);
    const shape = node ?? null;
    content = (
      <>
        <span className="ctx-dim">
          {selection.length > 1
            ? t('ctx.selected', { n: selection.length })
            : node
              ? node.name
              : showNew && tool !== 'select'
                ? t('ctx.newObjects')
                : t('ctx.noSelection')}
        </span>
        {(node || tool !== 'select' || !selection.length) && <PaintSwatches node={node} />}
        {kind === 'rect' && (
          <NumberField
            label={t('ctx.cornerRadius')}
            value={shape?.type === 'rect' ? shape.cornerRadius : defaults.cornerRadius}
            min={0}
            unit="px"
            width={84}
            onChange={(v) =>
              shape
                ? updateSelected('history.style', (n) => void (n.type === 'rect' && (n.cornerRadius = v)))
                : ui.set({ defaults: { ...defaults, cornerRadius: v } })
            }
          />
        )}
        {kind === 'polygon' && (
          <NumberField
            label={t('ctx.sides')}
            value={shape?.type === 'polygon' ? shape.sides : defaults.sides}
            min={3}
            max={64}
            width={70}
            onChange={(v) =>
              shape
                ? updateSelected(
                    'history.style',
                    (n) => void (n.type === 'polygon' && (n.sides = Math.round(v))),
                  )
                : ui.set({ defaults: { ...defaults, sides: Math.round(v) } })
            }
          />
        )}
        {shape?.type === 'image' && (
          <>
            <button
              className="btn small"
              aria-pressed={cropId === shape.id}
              onClick={() => ui.set({ cropId: cropId === shape.id ? null : shape.id })}
              data-testid="crop"
            >
              {cropId === shape.id ? t('ctx.cropDone') : t('ctx.crop')}
            </button>
            <button
              className="btn small"
              disabled={!shape.crop}
              onClick={() => {
                const n = shape;
                const c = n.crop;
                if (!c) return;
                // Revient à l'image entière, en gardant l'échelle et la position de l'image.
                updateSelected('history.crop', (m) => {
                  if (m.type !== 'image') return;
                  const fw = n.width / c.width,
                    fh = n.height / c.height;
                  const center = localToWorld(n, { x: -c.x * fw + fw / 2, y: -c.y * fh + fh / 2 });
                  m.width = fw;
                  m.height = fh;
                  m.x = center.x - fw / 2;
                  m.y = center.y - fh / 2;
                  delete m.crop;
                });
              }}
            >
              {t('ctx.resetCrop')}
            </button>
          </>
        )}
        {kind === 'star' && (
          <>
            <NumberField
              label={t('ctx.points')}
              value={shape?.type === 'star' ? shape.points : defaults.points}
              min={3}
              max={64}
              width={70}
              onChange={(v) =>
                shape
                  ? updateSelected(
                      'history.style',
                      (n) => void (n.type === 'star' && (n.points = Math.round(v))),
                    )
                  : ui.set({ defaults: { ...defaults, points: Math.round(v) } })
              }
            />
            <NumberField
              label={t('ctx.innerRatio')}
              value={Math.round((shape?.type === 'star' ? shape.innerRatio : defaults.innerRatio) * 100)}
              min={5}
              max={100}
              unit="%"
              width={84}
              onChange={(v) =>
                shape
                  ? updateSelected(
                      'history.style',
                      (n) => void (n.type === 'star' && (n.innerRatio = v / 100)),
                    )
                  : ui.set({ defaults: { ...defaults, innerRatio: v / 100 } })
              }
            />
          </>
        )}
        {tool === 'direct' && node?.type === 'path' && !node.locked && <NodeButtons single />}
        {tool === 'direct' && selection.length > 1 && <NodeButtons single={false} />}
        {tool === 'direct' &&
          node &&
          node.type !== 'path' &&
          node.type !== 'image' &&
          node.type !== 'group' && (
            <button className="btn small" data-testid="convert-curves" onClick={() => void convertToCurves()}>
              {t('layer.convertToCurves')}
            </button>
          )}
        {shape?.type === 'text' && shape.path && (
          <>
            <label className="field">
              <span className="field-label">{t('ctx.pathOffset')}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={Math.round(shape.path.offset * 1000) / 10}
                aria-label={t('ctx.pathOffset')}
                data-testid="path-offset"
                onChange={(e) => setTextPathOffset(Number(e.target.value) / 100, true)}
                onPointerUp={() => editor.commit('history.textPath')}
                onKeyUp={() => editor.commit('history.textPath')}
              />
            </label>
            <button className="btn small" onClick={removeTextFromPath}>
              {t('text.offPath')}
            </button>
          </>
        )}
        {/* Police, taille et cadre d'un texte : barre du texte (tools/text), ajoutée à la fin. */}
        {canLinkSelection() && (
          <button className="btn small" data-testid="link-frames" onClick={linkSelection}>
            {t('text.link')}
          </button>
        )}
      </>
    );
  }

  return (
    <div className="contextbar" role="region" aria-label={toolName}>
      <b className="ctx-tool">{toolName}</b>
      {content}
      {CONTEXT_EXTRAS.map((Extra, i) => (
        <Extra key={i} />
      ))}
    </div>
  );
}

/** Bouton à icône de la barre de l'outil Nœud (l'infobulle donne son nom). */
function NodeBtn({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  testId,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  testId: string;
}) {
  return (
    <button
      className="btn small icon"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon name={icon} />
    </button>
  );
}

/**
 * Barre de l'outil Nœud, comme dans Affinity : convertir les nœuds, actions sur la courbe, cadre de
 * transformation, aimantation et sens du tracé.
 */
function NodeButtons({ single }: { single: boolean }) {
  const t = useT();
  const keys = useUi((s) => s.nodeSelection);
  const opts = useUi((s) => s.nodeOptions);
  const run = (kind: NodeAction) => getController()?.paths.editNodes(kind);
  const toggle = (k: keyof typeof opts) => ui.set({ nodeOptions: { ...opts, [k]: !opts[k] } });
  const none = !single || !keys.length;
  return (
    <>
      <span className="ctx-label">{t('node.convert')}</span>
      <span className="ctx-group">
        <NodeBtn
          icon="nodeSharp"
          label={t('node.sharp')}
          disabled={none}
          onClick={() => run('sharp')}
          testId="node-sharp"
        />
        <NodeBtn
          icon="nodeSmooth"
          label={t('node.smooth')}
          disabled={none}
          onClick={() => run('smooth')}
          testId="node-smooth"
        />
        <NodeBtn
          icon="nodeSmart"
          label={t('node.smart')}
          disabled={none}
          onClick={() => run('smart')}
          testId="node-smart"
        />
      </span>
      <span className="ctx-label">{t('node.actions')}</span>
      <span className="ctx-group">
        <NodeBtn
          icon="splitCurve"
          label={t('node.split')}
          disabled={none}
          onClick={() => run('split')}
          testId="node-split"
        />
        <NodeBtn
          icon="breakCurve"
          label={t('node.break')}
          disabled={none}
          onClick={() => run('break')}
          testId="node-break"
        />
        <NodeBtn
          icon="closeCurve"
          label={t('node.close')}
          disabled={!single}
          onClick={() => run('toggleClosed')}
          testId="node-close"
        />
        <NodeBtn
          icon="smoothCurve"
          label={t('node.smoothCurve')}
          disabled={!single}
          onClick={() => run('smoothCurve')}
          testId="node-smooth-curve"
        />
        <NodeBtn icon="joinCurves" label={t('node.join')} onClick={() => run('join')} testId="node-join" />
        <NodeBtn
          icon="reverseCurve"
          label={t('node.reverse')}
          disabled={!single}
          onClick={() => run('reverse')}
          testId="node-reverse"
        />
        <NodeBtn
          icon="trash"
          label={t('node.delete')}
          disabled={none}
          onClick={() => run('delete')}
          testId="node-delete"
        />
      </span>
      <span className="ctx-group">
        <NodeBtn
          icon="nodeTransform"
          label={t('node.transform')}
          pressed={opts.transform}
          onClick={() => toggle('transform')}
          testId="node-transform"
        />
      </span>
      <span className="ctx-label">{t('node.snap')}</span>
      <span className="ctx-group">
        <NodeBtn
          icon="alignNodes"
          label={t('node.alignNodes')}
          pressed={opts.alignNodes}
          onClick={() => toggle('alignNodes')}
          testId="node-align"
        />
        <NodeBtn
          icon="snapHandles"
          label={t('node.snapHandles')}
          pressed={opts.snapHandles}
          onClick={() => toggle('snapHandles')}
          testId="node-snap-handles"
        />
      </span>
      <span className="ctx-group">
        <NodeBtn
          icon="orientation"
          label={t('node.orientation')}
          pressed={opts.orientation}
          onClick={() => toggle('orientation')}
          testId="node-orientation"
        />
      </span>
      <span className="ctx-dim">{t('ctx.nodeHint')}</span>
    </>
  );
}
