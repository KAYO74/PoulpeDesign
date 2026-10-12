import { setPaint } from '../actions';
import { toolKeyOf } from '../commands';
import { useT } from '../i18n';
import { startPlaceImage } from '../tools/frames/frameActions';
import { setTool, ui, useEditor, useUi, type ToolId } from '../store';
import { activeWorkspace, useActiveWorkspace } from '../workspaces';
import { TOOL_CATALOG, smallGroups, toolGroupsFor, toolPersona, withFamilies } from '../toolCatalog';
import { setPersona } from '../photo/persona';
import { findNode, isStyled } from '@poulpe/core';
import { paintPreview } from './fields';
import { Icon, type IconName } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FloatingFrame } from '../panels/FloatingFrame';
import { dockPanel, floatPanel, startPanelDrag, usePanels } from '../panels/panelLayout';

/** Outils d'une colonne personnalisée, rangés par famille dans l'ordre du catalogue. */
function customGroups(tools: ToolId[]): ToolId[][] {
  const groups = TOOL_CATALOG.map((c) => c.tools.filter((id) => tools.includes(id))).filter(
    (g) => g.length > 0,
  );
  // Outils hors du catalogue (anciens espaces de travail) : gardés à la fin, comme dans `smallGroups`.
  const rest = tools.filter((id) => !TOOL_CATALOG.some((c) => c.tools.includes(id)));
  if (rest.length) groups.push(rest);
  return groups;
}

/**
 * Choisit un outil ; dans un espace mixte, un outil pixel passe l'éditeur en mode Photo et un outil
 * vectoriel le ramène en Dessin (ou Mise en page), sans quitter l'espace de travail.
 */
export function pickTool(id: ToolId): void {
  const ws = activeWorkspace();
  const need = toolPersona(id);
  const persona = ui.get().persona;
  if (ws && need === 'photo' && persona !== 'photo') setPersona('photo', ws.tools);
  if (ws && need === 'draw' && persona === 'photo')
    setPersona(ws.base === 'photo' ? 'draw' : ws.base, ws.tools);
  if (id === 'image') void startPlaceImage();
  else setTool(id);
}

/** Au-delà de ce nombre d'outils, la colonne passe sur deux rangées (comme dans Affinity). */
const TWO_COLUMNS = 18;

export function ToolColumn() {
  const t = useT();
  const tool = useUi((s) => s.tool);
  const target = useUi((s) => s.colorTarget);
  const defaults = useUi((s) => s.defaults);
  const persona = useUi((s) => s.persona);
  const brushColor = useUi((s) => s.brushColor);
  const brushColor2 = useUi((s) => s.brushColor2);
  const { doc, selection } = useEditor();
  const photo = persona === 'photo';
  const custom = useActiveWorkspace()?.tools ?? null;
  const grouped = useUi((s) => s.settings.toolsLayout) === 'groups';
  const groups = custom ? (grouped ? smallGroups : customGroups)(custom) : toolGroupsFor(persona);
  const keyOf = (id: ToolId) => {
    const need = toolPersona(id);
    return toolKeyOf(id, need === 'photo' || (!need && photo) ? 'photo' : photo ? 'draw' : persona);
  };
  const columns = useUi((s) => s.settings.toolsColumns);
  const locked = useUi((s) => s.settings.toolsLocked);
  const floatingState = usePanels((s) => !!s.floating.tools);
  // Verrouillée, la colonne reste ancrée même si une palette flottante avait été enregistrée.
  const floating = floatingState && !locked;
  const node = selection.length ? findNode(doc, selection[0])?.node : null;
  const styled = node && isStyled(node) ? node : null;
  const fill = styled ? styled.fill : defaults.fill;
  const stroke = styled ? styled.stroke.paint : defaults.stroke.paint;
  const side = useUi((s) => s.settings.toolsSide);
  const dropping = useUi((s) => s.panelDock === 'tools');
  const ref = useRef<HTMLDivElement>(null);
  const shown = grouped ? groups.length : withFamilies(groups.flat()).length;
  const two = columns === 'two' || (columns === 'auto' && shown > TWO_COLUMNS);
  const [menu, setMenu] = useState<{ group: ToolId[]; rect: DOMRect } | null>(null);
  const [tip, setTip] = useState<{ id: ToolId; more: boolean; rect: DOMRect } | null>(null);
  const tipTimer = useRef(0);
  const showTip = (id: ToolId, more: boolean, el: HTMLElement) => {
    clearTimeout(tipTimer.current);
    // Une bulle déjà ouverte passe tout de suite à l'outil survolé.
    const delay = tip ? 0 : 550;
    tipTimer.current = window.setTimeout(() => setTip({ id, more, rect: el.getBoundingClientRect() }), delay);
  };
  const hideTip = (now = false) => {
    clearTimeout(tipTimer.current);
    if (now) setTip(null);
    else tipTimer.current = window.setTimeout(() => setTip(null), 200);
  };
  useEffect(() => () => clearTimeout(tipTimer.current), []);
  useEffect(() => {
    // Le dernier outil choisi dans un groupe reste celui affiché par son bouton.
    const g = groups.find((gr) => gr.includes(tool));
    if (g && g.length > 1) rememberInGroup(g, tool);
    const slot = g && withFamilies(g).find((sl) => sl.includes(tool));
    if (slot && slot.length > 1 && slot.join() !== g.join()) rememberInGroup(slot, tool);
  }, [tool, groups]);
  const toolButton = (id: ToolId, group?: ToolId[]) => {
    const key = keyOf(id);
    const label = `${t(`tool.${id}`)}${key ? ` (${key})` : ''}`;
    const many = !!group && group.length > 1;
    let press: number | undefined;
    const open = (el: HTMLElement) => setMenu({ group: group!, rect: el.getBoundingClientRect() });
    return (
      <button
        key={id}
        className={`tool${many ? ' has-more' : ''}`}
        aria-pressed={tool === id}
        aria-haspopup={many ? 'menu' : undefined}
        aria-label={label}
        data-testid={`tool-${id}`}
        onClick={() => pickTool(id)}
        onPointerEnter={(e) => showTip(id, many, e.currentTarget)}
        onFocus={(e) => showTip(id, many, e.currentTarget)}
        onBlur={() => hideTip()}
        onContextMenu={
          many
            ? (e) => {
                e.preventDefault();
                open(e.currentTarget);
              }
            : undefined
        }
        onPointerDown={(e) => {
          hideTip(true);
          if (!many) return;
          const el = e.currentTarget;
          press = window.setTimeout(() => open(el), 450);
        }}
        onPointerUp={many ? () => clearTimeout(press) : undefined}
        onPointerLeave={() => {
          clearTimeout(press);
          hideTip();
        }}
      >
        <Icon name={id as IconName} />
        {many && (
          <span
            className="tool-more"
            data-testid={`toolgroup-more-${group![0]}`}
            onClick={(e) => {
              e.stopPropagation();
              open(e.currentTarget.parentElement!);
            }}
          />
        )}
      </button>
    );
  };
  const column = (
    <div
      ref={floating ? undefined : ref}
      className={`toolcol${two && !floating ? ' two' : ''}${floating ? ' floating' : ''}`}
      role="toolbar"
      aria-orientation={floating ? undefined : 'vertical'}
      aria-label={t('panel.tools')}
      data-testid="toolcol"
    >
      {!floating && !locked && (
        <div
          className="toolcol-grip panel-handle"
          title={t('panel.floatHint')}
          data-testid="toolcol-grip"
          onPointerDown={(e) => startPanelDrag(e, 'tools', ref.current)}
          onDoubleClick={() => {
            const r = ref.current!.getBoundingClientRect();
            startFloatAt(side === 'left' ? r.right + 24 : r.left - 140, r.top + 20, r.height);
          }}
        >
          <span className="panel-grip" aria-hidden="true" />
        </div>
      )}
      {grouped ? (
        <div className="toolgroup">
          {groups.map((group) => toolButton(group.includes(tool) ? tool : shownInGroup(group), group))}
        </div>
      ) : (
        groups.map((group, gi) => (
          <div className="toolgroup" key={gi}>
            {withFamilies(group).map((slot) =>
              slot.length > 1
                ? toolButton(slot.includes(tool) ? tool : shownInGroup(slot), slot)
                : toolButton(slot[0]),
            )}
          </div>
        ))
      )}
      {tip && !menu && (
        <ToolTip
          id={tip.id}
          shortcut={keyOf(tip.id)}
          more={tip.more}
          rect={tip.rect}
          side={side}
          onEnter={() => clearTimeout(tipTimer.current)}
          onLeave={() => hideTip()}
          onClose={() => hideTip(true)}
        />
      )}
      {menu && (
        <ToolMenu
          group={menu.group}
          rect={menu.rect}
          side={side}
          current={tool}
          keyOf={keyOf}
          onClose={() => setMenu(null)}
        />
      )}
      {photo ? (
        <div className="fillstroke">
          <button
            className="fs-stroke"
            style={{ background: brushColor2 }}
            title={t('ctx.secondary')}
            aria-label={t('ctx.secondary')}
            onClick={() => ui.set({ brushColor: brushColor2, brushColor2: brushColor })}
          />
          <button
            className="fs-fill on"
            style={{ background: brushColor }}
            title={t('ctx.primary')}
            aria-label={t('ctx.primary')}
            data-testid="brush-color"
          />
          <button
            className="fs-swap"
            title={t('ctx.swapColors')}
            aria-label={t('ctx.swapColors')}
            onClick={() => ui.set({ brushColor: brushColor2, brushColor2: brushColor })}
          >
            <Icon name="swap" size={12} />
          </button>
        </div>
      ) : (
        <div className="fillstroke">
          <button
            className={`fs-stroke${target === 'stroke' ? ' on' : ''}`}
            style={{ background: paintPreview(stroke) }}
            title={t('color.stroke')}
            aria-label={t('color.stroke')}
            onClick={() => ui.set({ colorTarget: 'stroke' })}
          />
          <button
            className={`fs-fill${target === 'fill' ? ' on' : ''}`}
            style={{ background: paintPreview(fill) }}
            title={t('color.fill')}
            aria-label={t('color.fill')}
            onClick={() => ui.set({ colorTarget: 'fill' })}
          />
          <button
            className="fs-swap"
            title={t('color.swap')}
            aria-label={t('color.swap')}
            onClick={() => {
              setPaint('fill', stroke);
              setPaint('stroke', fill);
            }}
          >
            <Icon name="swap" size={12} />
          </button>
        </div>
      )}
    </div>
  );
  if (!floating)
    return (
      <>
        {column}
        {dropping && <div className={`dock-band tools ${side}`} aria-hidden="true" />}
      </>
    );
  return (
    <FloatingFrame id="tools" label={t('panel.tools')} className="tools-float">
      <div
        ref={ref}
        className="float-head panel-handle"
        title={t('panel.dockHint')}
        onPointerDown={(e) => startPanelDrag(e, 'tools', ref.current?.parentElement ?? null)}
        onDoubleClick={() => dockPanel('tools')}
      >
        <span className="panel-grip" aria-hidden="true" />
        <button
          className="ib small"
          data-no-drag
          title={t('panel.dock')}
          aria-label={t('panel.dock')}
          data-testid="dock-tools"
          onClick={() => dockPanel('tools')}
        >
          <Icon name={side === 'left' ? 'sideLeft' : 'sideRight'} size={12} />
        </button>
      </div>
      {column}
    </FloatingFrame>
  );
}

/** Double-clic sur la poignée : la colonne devient une palette flottante de deux colonnes. */
function startFloatAt(x: number, y: number, h: number): void {
  floatPanel('tools', { x, y, w: 92, h: Math.min(h, 640) });
}

/* Outil affiché par chaque groupe (le dernier choisi), retenu d'une session à l'autre. */
const GROUP_KEY = 'poulpe.toolGroups';
let lastInGroup: Record<string, ToolId> = (() => {
  try {
    return JSON.parse(localStorage.getItem(GROUP_KEY) ?? '{}') as Record<string, ToolId>;
  } catch {
    return {};
  }
})();

function shownInGroup(group: ToolId[]): ToolId {
  const last = lastInGroup[group.join(',')];
  return last && group.includes(last) ? last : group[0];
}

function rememberInGroup(group: ToolId[], id: ToolId): void {
  const key = group.join(',');
  if (lastInGroup[key] === id) return;
  lastInGroup = { ...lastInGroup, [key]: id };
  try {
    localStorage.setItem(GROUP_KEY, JSON.stringify(lastInGroup));
  } catch {
    /* stockage indisponible */
  }
}

/** Menu des outils d'un groupe, ouvert à côté de son bouton, du côté du document. */
function ToolMenu({
  group,
  rect,
  side,
  current,
  keyOf,
  onClose,
}: {
  group: ToolId[];
  rect: DOMRect;
  side: 'left' | 'right';
  current: ToolId;
  keyOf: (id: ToolId) => string | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus();
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
    };
    // Le clic qui a ouvert le menu ne doit pas le refermer.
    const id = setTimeout(() => window.addEventListener('pointerdown', down, true), 0);
    window.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, []);
  const style: React.CSSProperties =
    side === 'right'
      ? { right: window.innerWidth - rect.left + 4, top: rect.top }
      : { left: rect.right + 4, top: rect.top };
  return createPortal(
    <div className="tool-menu" role="menu" ref={ref} style={style} data-testid="tool-menu">
      {group.map((id) => (
        <button
          key={id}
          role="menuitemradio"
          aria-checked={current === id}
          data-testid={`toolmenu-${id}`}
          onClick={() => {
            pickTool(id);
            onClose();
          }}
        >
          <Icon name={id as IconName} />
          <span className="tool-menu-label">{t(`tool.${id}`)}</span>
          <span className="tool-menu-key">{keyOf(id) ?? ''}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Texte d'aide avec des passages **en gras** (gestes et touches). */
function rich(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

/** Bulle d'aide d'un outil, comme dans Affinity : nom et raccourci, rôle, gestes, « En savoir plus ». */
function ToolTip({
  id,
  shortcut,
  more,
  rect,
  side,
  onEnter,
  onLeave,
  onClose,
}: {
  id: ToolId;
  shortcut?: string;
  more: boolean;
  rect: DOMRect;
  side: 'left' | 'right';
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const desc = t(`tip.${id}.desc`);
  const howKey = `tip.${id}.how`;
  const how = t(howKey);
  const top = Math.max(8, Math.min(rect.top - 4, window.innerHeight - 320));
  const style =
    side === 'left' ? { top, left: rect.right + 10 } : { top, right: window.innerWidth - rect.left + 10 };
  return createPortal(
    <div
      className="tool-tip"
      role="tooltip"
      style={style}
      data-testid="tool-tip"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="tool-tip-title">
        {t('tip.tool', { name: t(`tool.${id}`) })}
        {shortcut ? ` [${shortcut}]` : ''}
      </div>
      {desc !== `tip.${id}.desc` && <p className="tool-tip-desc">{desc}</p>}
      {(how !== howKey || more) && (
        <p className="tool-tip-how">
          {how !== howKey && rich(how)}
          {more && <span className="tool-tip-group">{t('tool.groupMore')}</span>}
        </p>
      )}
      <button
        className="tool-tip-more"
        onClick={() => {
          onClose();
          ui.set({ dialog: 'help', helpTab: 'start' });
        }}
      >
        {t('tip.more')}
      </button>
    </div>,
    document.body,
  );
}
