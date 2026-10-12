import {
  SHAPE_PARAMS,
  acceptsCorners,
  findNode,
  setCornerType,
  setCorners,
  shapeParam,
  syncShape,
  type CornerType,
  type RectNode,
  type SceneNode,
  type ShapeKind,
} from '@poulpe/core';
import { updateSelected } from '../../actions';
import { NumberField, Select } from '../../components/fields';
import { Icon } from '../../components/Icon';
import { useT } from '../../i18n';
import { editor, ui, useEditor, useStore, useUi } from '../../store';
import { SHAPE_FAMILY } from '../../toolCatalog';
import { isShapeKind } from './make';
import { CORNER_TYPES, shapesStore } from './state';

/*
 * Barres contextuelles des outils de forme : réglages de la forme sélectionnée (ou des nouvelles
 * formes quand rien n'est sélectionné), coins des rectangles, outil Coin.
 */

function CornerTypeSelect({
  value,
  onChange,
  testId,
}: {
  value: CornerType;
  onChange: (v: CornerType) => void;
  testId: string;
}) {
  const t = useT();
  return (
    <Select
      label={t('corner.type')}
      value={value}
      testId={testId}
      options={CORNER_TYPES.map((k) => ({ value: k, label: t(`corner.type.${k}`) }))}
      onChange={onChange}
    />
  );
}

/** Champs des réglages d'une forme paramétrique. */
function ParamFields({
  kind,
  value,
  onChange,
}: {
  kind: ShapeKind;
  value: (key: string) => number;
  onChange: (key: string, v: number) => void;
}) {
  const t = useT();
  return (
    <>
      {SHAPE_PARAMS[kind].map((def) => {
        const k = def.unit === '%' ? 100 : 1;
        return (
          <NumberField
            key={def.key}
            label={t(`shape.param.${def.key}`)}
            value={Math.round(value(def.key) * k * 100) / 100}
            min={def.min * k}
            max={def.max * k}
            unit={def.unit || undefined}
            decimals={def.int || def.unit === '%' ? 0 : def.key === 'turns' ? 2 : 1}
            step={def.key === 'turns' ? 0.25 : 1}
            width={70}
            testId={`shape-param-${def.key}`}
            onChange={(v) => onChange(def.key, v / k)}
          />
        );
      })}
    </>
  );
}

const CORNER_LABELS = ['corner.tl', 'corner.tr', 'corner.br', 'corner.bl'];

/** Coins d'un rectangle : rayon commun ou un rayon par coin, et forme des coins. */
function RectCorners({ node }: { node: RectNode }) {
  const t = useT();
  const linked = !node.radii;
  const edit = (fn: (n: RectNode) => void) =>
    updateSelected('history.style', (n) => void (n.type === 'rect' && fn(n)));
  return (
    <>
      <button
        className="btn small icon"
        aria-pressed={linked}
        title={t('corner.link')}
        aria-label={t('corner.link')}
        data-testid="rect-link"
        onClick={() =>
          edit((n) => {
            if (n.radii) {
              n.cornerRadius = n.radii[0];
              delete n.radii;
            } else n.radii = [n.cornerRadius, n.cornerRadius, n.cornerRadius, n.cornerRadius];
          })
        }
      >
        <Icon name={linked ? 'link' : 'unlink'} />
      </button>
      {linked ? (
        <NumberField
          label={t('ctx.cornerRadius')}
          value={node.cornerRadius}
          min={0}
          unit="px"
          decimals={1}
          width={84}
          testId="rect-radius"
          onChange={(v) => edit((n) => void (n.cornerRadius = v))}
        />
      ) : (
        <span className="ctx-group">
          {[0, 1, 2, 3].map((i) => (
            <NumberField
              key={i}
              label={t(CORNER_LABELS[i])}
              value={node.radii![i]}
              min={0}
              decimals={1}
              width={56}
              testId={`rect-radius-${i}`}
              onChange={(v) =>
                edit((n) => {
                  if (!n.radii) return;
                  const radii = [...n.radii] as [number, number, number, number];
                  radii[i] = v;
                  n.radii = radii;
                })
              }
            />
          ))}
        </span>
      )}
      <CornerTypeSelect
        value={node.cornerType ?? 'round'}
        testId="rect-corner-type"
        onChange={(v) => edit((n) => setCornerType(n, v))}
      />
    </>
  );
}

/** Réglages de l'objet sélectionné (rectangle, polygone, étoile ou forme paramétrique). */
function NodeParams({ node }: { node: SceneNode }) {
  const t = useT();
  if (node.type === 'rect') return <RectCorners node={node} />;
  if (node.type === 'polygon')
    return (
      <>
        <NumberField
          label={t('ctx.sides')}
          value={node.sides}
          min={3}
          max={64}
          width={70}
          testId="polygon-sides"
          onChange={(v) =>
            updateSelected('history.style', (n) => void (n.type === 'polygon' && (n.sides = Math.round(v))))
          }
        />
        <NumberField
          label={t('shape.curve')}
          value={Math.round((node.curve ?? 0) * 100)}
          min={-100}
          max={100}
          unit="%"
          width={70}
          testId="polygon-curve"
          onChange={(v) =>
            updateSelected('history.style', (n) => {
              if (n.type !== 'polygon') return;
              if (v) n.curve = v / 100;
              else delete n.curve;
            })
          }
        />
      </>
    );
  if (node.type === 'star')
    return (
      <>
        <NumberField
          label={t('ctx.points')}
          value={node.points}
          min={3}
          max={64}
          width={70}
          testId="star-points"
          onChange={(v) =>
            updateSelected('history.style', (n) => void (n.type === 'star' && (n.points = Math.round(v))))
          }
        />
        <NumberField
          label={t('ctx.innerRatio')}
          value={Math.round(node.innerRatio * 100)}
          min={5}
          max={100}
          unit="%"
          width={84}
          testId="star-inner"
          onChange={(v) =>
            updateSelected('history.style', (n) => void (n.type === 'star' && (n.innerRatio = v / 100)))
          }
        />
      </>
    );
  if (node.type === 'path' && node.shape) {
    const spec = node.shape;
    return (
      <ParamFields
        kind={spec.kind}
        value={(k) => shapeParam(spec, k)}
        onChange={(key, v) =>
          updateSelected('history.shapeParams', (n) => {
            if (n.type !== 'path' || n.shape?.kind !== spec.kind) return;
            n.shape.params[key] = v;
            syncShape(n);
          })
        }
      />
    );
  }
  return null;
}

/** Réglages des nouveaux objets de l'outil actif. */
function ToolDefaults({ tool }: { tool: string }) {
  const t = useT();
  const defaults = useUi((s) => s.defaults);
  const st = useStore(shapesStore, (s) => s);
  if (tool === 'rect')
    return (
      <NumberField
        label={t('ctx.cornerRadius')}
        value={defaults.cornerRadius}
        min={0}
        unit="px"
        width={84}
        onChange={(v) => ui.set({ defaults: { ...defaults, cornerRadius: v } })}
      />
    );
  if (tool === 'roundRect')
    return (
      <>
        <NumberField
          label={t('ctx.cornerRadius')}
          value={st.roundRadius}
          min={0}
          unit="px"
          width={84}
          testId="round-radius"
          onChange={(v) => shapesStore.set({ roundRadius: v })}
        />
        <CornerTypeSelect
          value={st.roundType}
          testId="round-corner-type"
          onChange={(v) => shapesStore.set({ roundType: v })}
        />
      </>
    );
  if (tool === 'polygon')
    return (
      <NumberField
        label={t('ctx.sides')}
        value={defaults.sides}
        min={3}
        max={64}
        width={70}
        onChange={(v) => ui.set({ defaults: { ...defaults, sides: Math.round(v) } })}
      />
    );
  if (tool === 'star')
    return (
      <>
        <NumberField
          label={t('ctx.points')}
          value={defaults.points}
          min={3}
          max={64}
          width={70}
          onChange={(v) => ui.set({ defaults: { ...defaults, points: Math.round(v) } })}
        />
        <NumberField
          label={t('ctx.innerRatio')}
          value={Math.round(defaults.innerRatio * 100)}
          min={5}
          max={100}
          unit="%"
          width={84}
          onChange={(v) => ui.set({ defaults: { ...defaults, innerRatio: v / 100 } })}
        />
      </>
    );
  if (isShapeKind(tool)) {
    const spec = { kind: tool, params: st.params[tool] ?? {} };
    return (
      <ParamFields
        kind={tool}
        value={(k) => shapeParam(spec, k)}
        onChange={(key, v) =>
          shapesStore.set((s) => ({ params: { ...s.params, [tool]: { ...s.params[tool], [key]: v } } }))
        }
      />
    );
  }
  return null;
}

/** Ajouté à la barre contextuelle : réglages des formes (outil Déplacer et outils de forme). */
export function ShapeContextExtra() {
  const tool = useUi((s) => s.tool);
  const persona = useUi((s) => s.persona);
  const { doc, selection } = useEditor();
  if (persona === 'photo' || (tool !== 'select' && !SHAPE_FAMILY.includes(tool))) return null;
  const node = selection.length === 1 ? (findNode(doc, selection[0])?.node ?? null) : null;
  if (node) return node.locked ? null : <NodeParams node={node} />;
  if (!selection.length && tool !== 'select') return <ToolDefaults tool={tool} />;
  return null;
}

/** Objets sélectionnés qui acceptent des coins. */
function cornerTargets(): string[] {
  const doc = editor.doc;
  return editor.selection.filter((id) => {
    const n = findNode(doc, id)?.node;
    return !!n && !n.locked && acceptsCorners(n);
  });
}

/** Barre de l'outil Coin : rayon, forme, et application à tous les coins. */
export function CornerContext() {
  const t = useT();
  const st = useStore(shapesStore, (s) => s);
  const { selection } = useEditor();
  const any = selection.length > 0 && cornerTargets().length > 0;
  // Les derniers coins touchés de l'objet sélectionné suivent les champs.
  const active = st.active && selection.length === 1 && st.active.id === selection[0] ? st.active : null;
  const apply = (radius: number | null, type: CornerType | null, all: boolean) => {
    const ids = new Set(cornerTargets());
    updateSelected('history.corner', (n) => {
      if (!ids.has(n.id)) return;
      const keys = all ? null : active?.keys;
      if (radius !== null && (all || keys)) setCorners(n, keys ?? null, radius, type ?? st.cornerType);
      else if (type) setCornerType(n, type, keys ?? null);
    });
  };
  return (
    <>
      <NumberField
        label={t('ctx.cornerRadius')}
        value={st.cornerRadius}
        min={0}
        max={5000}
        unit="px"
        decimals={1}
        testId="corner-radius"
        onChange={(cornerRadius) => {
          shapesStore.set({ cornerRadius });
          if (active) apply(cornerRadius, null, false);
        }}
      />
      <CornerTypeSelect
        value={st.cornerType}
        testId="corner-kind"
        onChange={(cornerType) => {
          shapesStore.set({ cornerType });
          if (any) apply(null, cornerType, false);
        }}
      />
      <button
        className="btn small"
        disabled={!any}
        data-testid="corner-apply-all"
        onClick={() => apply(st.cornerRadius, st.cornerType, true)}
      >
        {t('corner.applyAll')}
      </button>
      <button
        className="btn small"
        disabled={!any}
        data-testid="corner-clear"
        onClick={() => apply(0, null, true)}
      >
        {t('corner.clear')}
      </button>
      <span className="ctx-dim">{t('corner.hint')}</span>
    </>
  );
}
