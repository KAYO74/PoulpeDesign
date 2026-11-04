import { useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { useT, type MessageKey } from '../i18n';
import { useEditor, useUi, type Persona } from '../store';
import { useActiveWorkspace } from '../workspaces';
import { FloatingFrame } from './FloatingFrame';
import {
  DEFAULT_PANELS,
  PANEL_LIMITS,
  dockPanel,
  floatPanel,
  panels,
  startPanelDrag,
  startSplitter,
  tabPanel,
  usePanels,
  type PanelId,
  type StudioGroupId,
} from './panelLayout';
import { STUDIO_TABS, currentTabs, defaultTabs, hideTab, moveTab, tabsKind } from './studioTabs';
import { findNode } from '@poulpe/core';
import { AdjustmentPanel } from './AdjustmentPanel';
import { BrushPanel } from './BrushPanel';
import { HistogramPanel } from './HistogramPanel';
import { CharacterPanel } from './CharacterPanel';
import { ColorPanel } from './ColorPanel';
import { EffectsPanel } from './EffectsPanel';
import { HistoryPanel } from './HistoryPanel';
import { ChannelsPanel } from './ChannelsPanel';
import { LayersPanel } from './LayersPanel';
import { StrokePanel } from './StrokePanel';
import { TransformPanel } from './TransformPanel';
import { MacrosPanel } from '../macros/MacrosPanel';

interface Tab {
  id: string;
  label: MessageKey;
  render: () => React.ReactNode;
}

/** Hauteur d'origine de l'Historique, tant que l'utilisateur ne l'a pas réglée. */
const BASE_H = 150;
/** Place minimale gardée aux Calques (le compartiment souple), même quand on règle les autres. */
const FLEX_MIN = 220;

/** Onglet actif et état replié de chaque groupe, conservés quand il passe d'ancré à flottant. */
const groupState = new Map<string, { active: string | null; open: boolean }>();

/** Rectangle du groupe (ancré ou flottant) qui contient normalement ce panneau. */
function homeRect(group: PanelId): DOMRect | null {
  const el = document.querySelector(`[data-testid="studio-${group}"]`);
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 ? r : null;
}

/**
 * Groupe d'onglets repliable, comme les Studios d'Affinity. Sa barre d'onglets sert de poignée :
 * on la glisse pour détacher le groupe en fenêtre flottante (comme dans Photoshop), on la ramène
 * sur le Studio pour le ré-ancrer. Double-clic sur la barre : détacher / ré-ancrer.
 * Un onglet (Calques, Pinceau, Historique…) glissé hors du groupe devient sa propre fenêtre ;
 * ramené sur son groupe, il y reprend sa place. Double-clic sur un onglet : le détacher seul.
 */
function StudioGroup({
  id,
  stateKey,
  tabs,
  initial = 0,
  floating,
  home,
  grow,
  basis,
  shrink = 1,
}: {
  id: PanelId;
  stateKey: string;
  tabs: Tab[];
  initial?: number;
  floating?: boolean;
  /** Panneau détaché seul : le groupe où il retourne quand on l'ancre. */
  home?: PanelId;
  /** Le compartiment qui prend la place restante (les autres ont une hauteur propre). */
  grow?: boolean;
  /** Hauteur voulue (px) d'un compartiment ancré à hauteur réglable ; null : celle du contenu. */
  basis?: number | null;
  /** Part de la place manquante que ce compartiment cède (0 : aucune, il garde sa hauteur). */
  shrink?: number;
}) {
  const t = useT();
  const side = useUi((s) => s.settings.studioSide);
  const saved = groupState.get(stateKey);
  const [active, setActiveState] = useState<string | null>(saved?.active ?? null);
  const [open, setOpenState] = useState(saved?.open ?? true);
  const ref = useRef<HTMLElement>(null);
  const remember = (a: string | null, o: boolean) => groupState.set(stateKey, { active: a, open: o });
  const setActive = (tab: string) => {
    setActiveState(tab);
    setOpenState(true);
    remember(tab, true);
  };
  const setOpen = (o: boolean) => {
    setOpenState(o);
    remember(active, o);
  };
  // L'onglet actif est retenu par son nom : détacher un autre onglet ne change pas l'affichage.
  const found = tabs.findIndex((tab) => tab.id === active);
  const current = found >= 0 ? found : Math.min(initial, tabs.length - 1);
  /** Détache un onglet en fenêtre seule, à côté du groupe. */
  const detachTab = (tab: string) => {
    const r = ref.current!.getBoundingClientRect();
    const x = side === 'left' ? r.right + 24 : r.left - r.width - 24;
    floatPanel(tabPanel(tab), { x, y: r.top + 20, w: r.width, h: Math.max(r.height, 240) });
  };
  const kind = tabsKind(useUi((s) => s.persona));
  /** Lâché sur un groupe du Studio, le panneau y prend place (Photoshop, Affinity). */
  const dropInto = (tab: string) => (group: StudioGroupId, before: string | null) =>
    moveTab(kind, tab, group, before);
  const tabDown = (e: React.PointerEvent, tab: string) => {
    // Fenêtre d'un panneau seul : son onglet la déplace tout entière.
    if (home) return;
    e.stopPropagation();
    const r = ref.current!.getBoundingClientRect();
    startPanelDrag(e, tabPanel(tab), e.currentTarget as HTMLElement, {
      size: { w: r.width, h: Math.max(r.height, 240) },
      home: () => homeRect(id),
      onGroupDrop: dropInto(tab),
    });
  };
  const toggleFloat = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[role="tab"],[data-no-drag]')) return;
    if (floating) return dockPanel(id);
    const r = ref.current!.getBoundingClientRect();
    const x = side === 'left' ? r.right + 24 : r.left - r.width - 24;
    floatPanel(id, { x, y: r.top + 20, w: r.width, h: Math.max(r.height, 240) });
  };
  // Ancré : le compartiment « souple » garde la place restante ; les autres ont la hauteur réglée
  // avec leur séparateur, et se réduisent à leur barre d'onglets quand on les replie.
  const style: React.CSSProperties | undefined = floating
    ? undefined
    : grow
      ? { flex: '1 1 0', minHeight: open ? FLEX_MIN : 0 }
      : !open
        ? { flex: 'none' }
        : basis != null
          ? {
              flex: `0 ${shrink} ${basis}px`,
              minHeight: 64,
              // Réglé à la main : il garde sa hauteur, sans empêcher les autres d'avoir la leur.
              maxHeight: `calc(100% - ${FLEX_MIN + 64}px)`,
            }
          : { flex: `0 ${shrink} auto` };
  const section = (
    <section
      ref={ref}
      className={`studio-group${open ? ' open' : ''}`}
      data-testid={`studio-${id}`}
      data-group={home ? undefined : id}
      style={style}
    >
      <header
        className="studio-tabs panel-handle"
        role="tablist"
        title={t(floating ? 'panel.dockHint' : 'panel.floatHint')}
        onPointerDown={(e) =>
          startPanelDrag(
            e,
            id,
            ref.current,
            home ? { home: () => homeRect(home), onGroupDrop: dropInto(tabs[0].id) } : {},
          )
        }
        onDoubleClick={toggleFloat}
        onWheel={(e) => {
          // Molette verticale : fait défiler les onglets coupés.
          if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        <span className="panel-grip" aria-hidden="true" />
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={i === current}
            className="studio-tab"
            data-testid={`tab-${tab.id}`}
            data-tab={tab.id}
            title={home ? undefined : t('panel.tabHint')}
            onClick={(e) => {
              setActive(tab.id);
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            onPointerDown={(e) => tabDown(e, tab.id)}
            onDoubleClick={() => (home ? dockPanel(id) : detachTab(tab.id))}
          >
            {t(tab.label)}
          </button>
        ))}
        {/* Toujours visibles à droite, même quand les onglets défilent. */}
        <span className="studio-actions">
          {floating && (
            <button
              className="ib small"
              data-no-drag
              title={t('panel.dock')}
              aria-label={t('panel.dock')}
              data-testid={`dock-${id}`}
              onClick={() => dockPanel(id)}
            >
              <Icon name={side === 'left' ? 'sideLeft' : 'sideRight'} size={12} />
            </button>
          )}
          <button
            className="ib small"
            data-no-drag
            data-testid={`collapse-${id}`}
            aria-expanded={open}
            aria-label={open ? '−' : '+'}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'chevronDown' : 'chevron'} size={12} />
          </button>
          {home && (
            <button
              className="ib small"
              data-no-drag
              title={t('panel.close')}
              aria-label={t('panel.close')}
              data-testid={`close-${id}`}
              onClick={() => hideTab(kind, tabs[0].id)}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </span>
      </header>
      {open && (
        <div className="studio-content" role="tabpanel">
          {tabs[current].render()}
        </div>
      )}
    </section>
  );
  if (!floating) return section;
  return (
    <FloatingFrame id={id} label={t(tabs[current].label)} className={open ? '' : 'collapsed'}>
      {section}
    </FloatingFrame>
  );
}

interface GroupDef {
  id: PanelId;
  stateKey: string;
  tabs: Tab[];
  initial?: number;
}

const RENDER: Record<string, () => React.ReactNode> = {
  color: () => <ColorPanel />,
  stroke: () => <StrokePanel />,
  effects: () => <EffectsPanel />,
  transform: () => <TransformPanel />,
  character: () => <CharacterPanel />,
  brush: () => <BrushPanel />,
  adjustment: () => <AdjustmentPanel />,
  histogram: () => <HistogramPanel />,
  layers: () => <LayersPanel />,
  channels: () => <ChannelsPanel />,
  history: () => <HistoryPanel />,
  macros: () => <MacrosPanel />,
};

const TABS: Record<string, Tab> = Object.fromEntries(
  STUDIO_TABS.map((tab) => [tab.id, { ...tab, render: RENDER[tab.id] }]),
);

/** Onglets du Studio d'une Persona, dans l'ordre (pour la boîte « Espace de travail »). */
export function studioTabsFor(persona: Persona): { id: string; label: MessageKey }[] {
  const def = defaultTabs(tabsKind(persona));
  return [...def.top, ...def.bottom, ...def.base].map((id) => TABS[id]);
}

/** Tous les onglets du Studio, toutes Personas confondues (espaces de travail mixtes). */
export function studioTabsAll(): { id: string; label: MessageKey }[] {
  return STUDIO_TABS;
}

/** Groupes du Studio de la Persona, et panneaux détachés seuls (avec leur groupe d'origine). */
function useGroups(): {
  groups: GroupDef[];
  detached: { tab: Tab; home: PanelId }[];
  empty: PanelId[];
} {
  const editingText = useUi((s) => s.tool === 'text');
  const persona = useUi((s) => s.persona);
  useActiveWorkspace();
  const floating = usePanels((s) => s.floating);
  const kind = tabsKind(persona);
  usePanels((s) => s.tabs[kind]);
  const cur = currentTabs(kind);
  const { doc, selection } = useEditor();
  const adjusting = selection.length === 1 && findNode(doc, selection[0])?.node.type === 'adjustment';
  const detached: { tab: Tab; home: PanelId }[] = [];
  const pick = (ids: string[], home: PanelId) =>
    ids
      .map((id) => TABS[id])
      .filter((tab) => {
        if (!tab) return false;
        if (!floating[tabPanel(tab.id)]) return true;
        detached.push({ tab, home });
        return false;
      });
  const photo = kind === 'photo';
  const focus = photo ? (adjusting ? 'adjustment' : null) : editingText ? 'character' : null;
  const top = pick(cur.top, 'studio-top');
  const groups: GroupDef[] = [
    {
      id: 'studio-top',
      stateKey: `${photo ? 'photo' : 'draw'}${focus && top.some((tab) => tab.id === focus) ? `-${focus}` : ''}`,
      initial: Math.max(
        0,
        top.findIndex((tab) => tab.id === focus),
      ),
      tabs: top,
    },
    {
      id: 'studio-bottom',
      stateKey: photo ? 'layers' : 'layers-draw',
      tabs: pick(cur.bottom, 'studio-bottom'),
    },
    {
      id: 'studio-base',
      stateKey: 'history',
      tabs: pick(cur.base, 'studio-base'),
    },
  ];
  return {
    groups: groups.filter((g) => g.tabs.length > 0),
    detached,
    empty: groups.filter((g) => g.tabs.length === 0).map((g) => g.id),
  };
}

export function Studio() {
  const t = useT();
  const { groups, detached, empty } = useGroups();
  const side = useUi((s) => s.settings.studioSide);
  const dropping = useUi((s) => s.panelDock !== null && s.panelDock !== 'tools');
  const floating = usePanels((s) => s.floating);
  const width = usePanels((s) => s.studioW);
  const topH = usePanels((s) => s.topH);
  const baseH = usePanels((s) => s.baseH);
  const asideRef = useRef<HTMLElement>(null);
  const docked = groups.filter((g) => !floating[g.id]);
  const loose = groups.filter((g) => floating[g.id]);
  // Les Calques (compartiment du milieu) prennent la place restante ; sinon le dernier compartiment.
  const flexId = docked.some((g) => g.id === 'studio-bottom') ? 'studio-bottom' : docked.at(-1)?.id;
  /** Groupe vidé de ses panneaux : une place où en déposer un. */
  const emptyGroup = (g: PanelId) => (
    <div key={g} className="studio-empty" data-group={g} data-testid={`empty-${g}`}>
      {t('panel.dropHere')}
    </div>
  );
  /** Séparateur entre deux compartiments : il règle celui des deux qui n'est pas « souple ». */
  const splitter = (i: number) => {
    const above = docked[i - 1];
    const below = docked[i];
    const sized = below.id === flexId ? above : below;
    const key = sized.id === 'studio-base' ? 'baseH' : 'topH';
    const dir = sized === above ? 1 : -1;
    return (
      <div
        key={`split-${sized.id}`}
        className="split-v"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('panel.resize')}
        data-testid={sized.id === 'studio-base' ? 'studio-split-base' : 'studio-split'}
        onPointerDown={(e) => {
          const aside = asideRef.current!;
          const height = (id: PanelId) =>
            aside.querySelector(`[data-group="${id}"]`)?.getBoundingClientRect().height ?? 0;
          // L'autre compartiment à hauteur propre cède jusqu'à son minimum, sauf s'il a été réglé à la main.
          const other = docked.find((g) => g.id !== flexId && g.id !== sized.id);
          const otherSet = other?.id === 'studio-top' ? topH !== null : baseH !== null;
          const keep = other ? (otherSet ? height(other.id) : 64) : 0;
          const total = aside.getBoundingClientRect().height;
          startSplitter(
            e,
            key,
            dir,
            [PANEL_LIMITS.minH, Math.max(PANEL_LIMITS.minH, total - FLEX_MIN - keep)],
            height(sized.id),
          );
        }}
        onDoubleClick={() => panels.set({ [key]: null })}
      />
    );
  };
  return (
    <>
      {docked.length > 0 && (
        <aside
          ref={asideRef}
          className={`studio${dropping ? ' drop-target' : ''}`}
          aria-label="Studio"
          data-testid="studio"
          style={{ width }}
        >
          {empty.includes('studio-top') && emptyGroup('studio-top')}
          {docked.map((g, i) => [
            i > 0 && splitter(i),
            <StudioGroup
              key={g.stateKey}
              {...g}
              grow={g.id === flexId}
              basis={g.id === 'studio-top' ? topH : g.id === 'studio-base' ? (baseH ?? BASE_H) : null}
              shrink={(g.id === 'studio-top' ? topH : g.id === 'studio-base' ? baseH : null) !== null ? 0 : 1}
            />,
          ])}
          {empty.includes('studio-bottom') && emptyGroup('studio-bottom')}
          {empty.includes('studio-base') && emptyGroup('studio-base')}
          <div
            className={`split-h ${side === 'right' ? 'at-left' : 'at-right'}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('panel.resize')}
            data-testid="studio-resize"
            onPointerDown={(e) =>
              startSplitter(e, 'studioW', side === 'right' ? -1 : 1, [...PANEL_LIMITS.studioW], width)
            }
            onDoubleClick={() => panels.set({ studioW: DEFAULT_PANELS.studioW })}
          />
        </aside>
      )}
      {docked.length === 0 && dropping && <div className={`dock-band ${side}`} aria-hidden="true" />}
      {loose.map((g) => (
        <StudioGroup key={g.stateKey} {...g} floating />
      ))}
      {detached.map(({ tab, home }) => (
        <StudioGroup
          key={`tab-${tab.id}`}
          id={tabPanel(tab.id)}
          stateKey={`tab-${tab.id}`}
          tabs={[tab]}
          home={home}
          floating
        />
      ))}
    </>
  );
}
