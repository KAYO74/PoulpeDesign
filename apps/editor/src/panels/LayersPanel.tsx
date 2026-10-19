import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { BLEND_MODES, findNode, moveNodesTo, type BlendMode, type SceneNode } from '@poulpe/core';
import { deleteArtboard, deleteSelection, updateSelected } from '../actions';
import { AdjustmentMenu } from '../components/AdjustmentMenu';
import { COMMANDS, runCommand } from '../commands';
import { toggleMaskEdit } from '../photo/photoActions';
import { images } from '../photo/pixels';
import { NumberField, Select } from '../components/fields';
import { Icon, type IconName } from '../components/Icon';
import { useT } from '../i18n';
import { editor, ui, useEditor, useUi } from '../store';
import { Item, Sep, Sub } from '../components/MenuBar';
import { layerRows, rangeBetween, type LayerRow } from '../layers';

const TYPE_ICON: Record<SceneNode['type'], IconName> = {
  rect: 'rect',
  ellipse: 'ellipse',
  polygon: 'polygon',
  star: 'star',
  line: 'line',
  path: 'path',
  text: 'text',
  image: 'image',
  group: 'folder',
  symbol: 'symbol',
  adjustment: 'adjust',
};

/** Vignette d'un masque de calque : blanc = visible, noir = caché. */
function MaskThumb({ node, active, onClick }: { node: SceneNode; active: boolean; onClick: () => void }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const { doc } = useEditor();
  const mask = node.mask!;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const draw = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      const img = images().get(doc, mask.assetId);
      if (!img) return false;
      const tmp = document.createElement('canvas');
      tmp.width = c.width;
      tmp.height = c.height;
      const tc = tmp.getContext('2d')!;
      tc.drawImage(img, 0, 0, c.width, c.height);
      tc.globalCompositeOperation = 'source-in';
      tc.fillStyle = '#fff';
      tc.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(tmp, 0, 0);
      return true;
    };
    if (!draw()) {
      const id = setTimeout(draw, 300);
      return () => clearTimeout(id);
    }
  }, [doc, mask.assetId]);
  return (
    <button
      className={`mask-thumb${active ? ' on' : ''}${mask.enabled ? '' : ' off'}`}
      title={t('layers.mask')}
      aria-label={t('layers.mask')}
      aria-pressed={active}
      data-testid={`mask-${node.id}`}
      onClick={(e) => {
        e.stopPropagation();
        editor.select([node.id]);
        toggleMaskEdit(node.id);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <canvas ref={ref} width={20} height={14} onClick={onClick} />
    </button>
  );
}

/** Hauteur fixe d'une ligne : permet de n'afficher que les lignes visibles. */
const ROW = 28;
/** En dessous de ce nombre de lignes, toute la liste est affichée. */
const VIRTUAL_MIN = 150;
const OVERSCAN = 12;

/** Où les calques glissés vont tomber : un parent et une position dans ses enfants. */
/** Point de chute : entre deux calques, dans un groupe (`into`) ou sur un calque pour les fusionner (`onto`). */
type Drop = { parentId: string; index: number; into?: string; onto?: string } | null;

/** Menu ouvert : celui d'un calque, celui d'un plan de travail, ou le choix après un lâcher sur un calque. */
type MenuState = { x: number; y: number; kind: 'node' | 'artboard' | 'merge'; id?: string } | null;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

/** Plage des lignes visibles dans la zone qui défile (virtualisation de la liste). */
function useVisibleRange(listRef: React.RefObject<HTMLElement | null>, count: number): [number, number] {
  const virtual = count >= VIRTUAL_MIN;
  const [range, setRange] = useState<[number, number]>([0, virtual ? 60 : count]);
  useLayoutEffect(() => {
    if (!virtual) {
      setRange([0, count]);
      return;
    }
    const list = listRef.current;
    const scroller = scrollParent(list);
    if (!list || !scroller) {
      setRange([0, count]);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const first = Math.floor(-top / ROW);
      const visible = Math.ceil(scroller.clientHeight / ROW);
      const start = Math.max(0, first - OVERSCAN);
      const end = Math.min(count, first + visible + OVERSCAN);
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [listRef, count, virtual]);
  return virtual ? range : [0, count];
}

interface RowHandlers {
  select(id: string, e: React.MouseEvent): void;
  menu(id: string, e: React.MouseEvent): void;
  dragStart(id: string, e: React.DragEvent): void;
  /** Calcule où tomberaient les calques glissés sur cette ligne ; false si c'est impossible. */
  dragOver(row: LayerRow, el: HTMLElement, clientY: number): boolean;
  drop(e: React.DragEvent): void;
  artboardMenu(id: string, e: React.MouseEvent): void;
  toggleCollapse(id: string): void;
  rename(id: string | null, name?: string): void;
  setProp(id: string, label: string, fn: (n: SceneNode) => void): void;
}

type DropMark = 'above' | 'below' | 'into' | null;

const NodeRow = memo(function NodeRow({
  node,
  depth,
  open,
  sel,
  mark,
  dragging,
  renaming,
  maskActive,
  h,
}: {
  node: SceneNode;
  depth: number;
  open: boolean;
  sel: boolean;
  mark: DropMark;
  dragging: boolean;
  renaming: boolean;
  maskActive: boolean;
  h: React.MutableRefObject<RowHandlers>;
}) {
  const t = useT();
  const n = node;
  const isGroup = n.type === 'group';
  return (
    <li
      role="treeitem"
      aria-level={depth}
      aria-selected={sel}
      aria-expanded={isGroup ? open : undefined}
      data-layer-id={n.id}
    >
      <div
        className={`layer${sel ? ' sel' : ''}${!n.visible ? ' hidden' : ''}${dragging ? ' dragging' : ''}${mark ? ` drop-${mark}` : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={!renaming}
        onDragStart={(e) => h.current.dragStart(n.id, e)}
        onClick={(e) => h.current.select(n.id, e)}
        onContextMenu={(e) => h.current.menu(n.id, e)}
        onDoubleClick={() => h.current.rename(n.id)}
      >
        {isGroup ? (
          <button
            className="twisty"
            aria-label={open ? '−' : '+'}
            onClick={(e) => (e.stopPropagation(), h.current.toggleCollapse(n.id))}
          >
            <Icon name={open ? 'chevronDown' : 'chevron'} size={12} />
          </button>
        ) : (
          <span className="twisty" />
        )}
        <span className="layer-icon">
          <Icon
            name={
              n.type === 'group' && n.clip
                ? 'mask'
                : n.type === 'path' && n.shape
                  ? n.shape.kind
                  : TYPE_ICON[n.type]
            }
            size={14}
          />
        </span>
        {n.mask && <MaskThumb node={n} active={maskActive} onClick={() => {}} />}
        {renaming ? (
          <input
            className="rename"
            autoFocus
            defaultValue={n.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => h.current.rename(null, e.target.value.trim())}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') h.current.rename(null);
            }}
          />
        ) : (
          <span className="layer-name">{n.name}</span>
        )}
        <button
          className={`layer-btn${n.locked ? ' on' : ''}`}
          aria-pressed={n.locked}
          title={n.locked ? t('layer.unlock') : t('layer.lock')}
          aria-label={n.locked ? t('layer.unlock') : t('layer.lock')}
          onClick={(e) => {
            e.stopPropagation();
            h.current.setProp(n.id, 'history.lock', (m) => void (m.locked = !m.locked));
          }}
        >
          <Icon name={n.locked ? 'lock' : 'unlock'} size={14} />
        </button>
        <button
          className={`layer-btn${!n.visible ? ' on' : ''}`}
          aria-pressed={!n.visible}
          title={n.visible ? t('layer.hide') : t('layer.show')}
          aria-label={n.visible ? t('layer.hide') : t('layer.show')}
          onClick={(e) => {
            e.stopPropagation();
            h.current.setProp(n.id, 'history.visibility', (m) => void (m.visible = !m.visible));
          }}
        >
          <Icon name={n.visible ? 'eye' : 'eyeOff'} size={14} />
        </button>
      </div>
    </li>
  );
});

/** Ids d'un calque et de tous ses descendants. */
function withDescendants(node: SceneNode, out: Set<string>): void {
  out.add(node.id);
  if (node.type === 'group') for (const c of node.children) withDescendants(c, out);
}

export function LayersPanel() {
  const t = useT();
  const { doc, selection, activeArtboardId } = useEditor();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Calques en cours de glissement, avec leurs descendants (on ne peut pas les déposer en eux-mêmes). */
  const [drag, setDrag] = useState<{ ids: string[]; blocked: Set<string> } | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const anchor = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const maskEditId = useUi((s) => s.maskEditId);
  const persona = useUi((s) => s.persona);
  const first = selection.length ? findNode(doc, selection[0])?.node : null;

  const rows = useMemo(() => layerRows(doc, collapsed), [doc, collapsed]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const [start, end] = useVisibleRange(listRef, rows.length);
  const virtual = rows.length >= VIRTUAL_MIN;

  const finishDrop = (e?: React.DragEvent) => {
    if (drag && drop?.onto) {
      // Lâché sur un calque : on propose de les grouper ou de les fusionner.
      const onto = drop.onto;
      editor.select([...drag.ids.filter((i) => i !== onto), onto]);
      setMenu({ x: e?.clientX ?? 0, y: e?.clientY ?? 0, kind: 'merge' });
    } else if (drag && drop) {
      const { ids } = drag;
      editor.apply('history.order', (d) => {
        moveNodesTo(d, ids, drop.parentId, drop.index);
        return ids;
      });
    }
    setDrag(null);
    setDrop(null);
  };

  // La ligne glissée peut sortir de la liste affichée (défilement) : on remet à zéro dans tous les cas.
  useEffect(() => {
    if (!drag) return;
    const reset = () => {
      setDrag(null);
      setDrop(null);
    };
    window.addEventListener('dragend', reset);
    return () => window.removeEventListener('dragend', reset);
  }, [drag]);

  const h = useRef<RowHandlers>(null!);
  h.current = {
    select(id, e) {
      if (e.shiftKey && anchor.current) {
        const range = rangeBetween(rows, anchor.current, id);
        editor.select(e.metaKey || e.ctrlKey ? [...new Set([...selection, ...range])] : range);
        return;
      }
      anchor.current = id;
      if (e.metaKey || e.ctrlKey)
        editor.select(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
      else editor.select([id]);
    },
    menu(id, e) {
      e.preventDefault();
      if (!selection.includes(id)) {
        anchor.current = id;
        editor.select([id]);
      }
      setMenu({ x: e.clientX, y: e.clientY, kind: 'node' });
    },
    artboardMenu(id, e) {
      e.preventDefault();
      editor.setActiveArtboard(id);
      editor.select([]);
      setMenu({ x: e.clientX, y: e.clientY, kind: 'artboard', id });
    },
    dragStart(id, e) {
      const ids = selection.includes(id) ? selection.filter((s) => findNode(doc, s)) : [id];
      if (!selection.includes(id)) editor.select([id]);
      const blocked = new Set<string>();
      for (const i of ids) {
        const n = findNode(doc, i)?.node;
        if (n) withDescendants(n, blocked);
      }
      setDrag({ ids, blocked });
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ids.join(','));
      if (ids.length > 1) {
        // Étiquette « 3 calques » sous le pointeur.
        const ghost = document.createElement('div');
        ghost.className = 'layer-drag-ghost';
        ghost.textContent = t('layers.dragCount', { n: ids.length });
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, -8, -8);
        setTimeout(() => ghost.remove(), 0);
      }
    },
    dragOver(row, el, clientY) {
      if (!drag) return false;
      if (row.kind === 'artboard') {
        const next = { parentId: row.artboard.id, index: row.artboard.children.length, into: row.key };
        setDrop((d) => (d && d.into === next.into ? d : next));
        return true;
      }
      if (row.kind !== 'node' || drag.blocked.has(row.key)) return false;
      const r = el.getBoundingClientRect();
      const y = (clientY - r.top) / r.height;
      const n = row.node;
      let next: Drop;
      if (n.type === 'group' && y > 0.3 && y < 0.7)
        next = { parentId: n.id, index: n.children.length, into: n.id };
      else if (y > 0.3 && y < 0.7) next = { parentId: row.parentId, index: row.index, onto: n.id };
      else next = { parentId: row.parentId, index: y < 0.5 ? row.index + 1 : row.index };
      setDrop((d) =>
        d &&
        d.parentId === next!.parentId &&
        d.index === next!.index &&
        d.into === next!.into &&
        d.onto === next!.onto
          ? d
          : next,
      );
      return true;
    },
    drop(e) {
      e.preventDefault();
      finishDrop(e);
    },
    toggleCollapse(id) {
      setCollapsed((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    },
    rename(id, name) {
      if (id) return setRenaming(id);
      const target = renaming;
      setRenaming(null);
      const n = target ? findNode(editor.doc, target)?.node : null;
      if (n && name && name !== n.name) this.setProp(n.id, 'history.rename', (m) => void (m.name = name));
    },
    setProp(id, label, fn) {
      editor.apply(label, (d) => {
        const n = findNode(d, id)?.node;
        if (n) fn(n);
      });
    },
  };

  /** Fait défiler la liste pour montrer une ligne (navigation au clavier). */
  const reveal = useCallback(
    (index: number) => {
      const scroller = scrollParent(listRef.current);
      const list = listRef.current;
      if (!scroller || !list) return;
      const top =
        list.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop +
        index * ROW;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + ROW > scroller.scrollTop + scroller.clientHeight)
        scroller.scrollTop = top + ROW - scroller.clientHeight;
    },
    [listRef],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || (e.target as HTMLElement).closest('input')) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const nodes = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === 'node');
      if (!nodes.length) return;
      const last = selection[selection.length - 1];
      const at = nodes.findIndex(({ r }) => r.key === last);
      const next = at < 0 ? 0 : Math.max(0, Math.min(nodes.length - 1, at + (e.key === 'ArrowUp' ? -1 : 1)));
      const id = nodes[next].r.key;
      if (e.shiftKey) editor.select([...selection.filter((s) => s !== id), id]);
      else {
        anchor.current = id;
        editor.select([id]);
      }
      reveal(nodes[next].i);
    } else if (e.key === 'F2' && selection.length === 1) {
      e.preventDefault();
      setRenaming(selection[0]);
    } else if (e.key === 'ContextMenu' && selection.length) {
      e.preventDefault();
      const el = listRef.current?.querySelector(`[data-layer-id="${selection[0]}"]`);
      const r = (el ?? e.currentTarget).getBoundingClientRect();
      setMenu({ x: r.left + 24, y: r.bottom, kind: 'node' });
    }
  };

  const markOf = (row: LayerRow): DropMark => {
    if (!drop) return null;
    if (drop.onto) return drop.onto === row.key ? 'into' : null;
    if (drop.into) return drop.into === row.key ? 'into' : null;
    if (row.kind !== 'node' || drop.parentId !== row.parentId) return null;
    if (drop.index === row.index + 1) return 'above';
    if (drop.index === row.index) return 'below';
    return null;
  };

  const renderRow = (row: LayerRow) => {
    if (row.kind === 'node') {
      return (
        <NodeRow
          key={row.key}
          node={row.node}
          depth={row.depth}
          open={row.node.type === 'group' && !collapsed.has(row.key)}
          sel={selected.has(row.key)}
          mark={markOf(row)}
          dragging={!!drag && drag.blocked.has(row.key)}
          renaming={renaming === row.key}
          maskActive={maskEditId === row.key}
          h={h}
        />
      );
    }
    if (row.kind === 'empty')
      return (
        <li key={row.key} role="none" className="layer-empty">
          <p className="empty indent">{t('layers.empty')}</p>
        </li>
      );
    const ab = row.artboard;
    return (
      <li key={row.key} role="treeitem" aria-level={0} aria-expanded data-layer-id={ab.id}>
        <div
          className={`layer artboard${ab.id === activeArtboardId ? ' active' : ''}${markOf(row) ? ' drop-into' : ''}`}
          onClick={() => {
            editor.setActiveArtboard(ab.id);
            editor.select([]);
          }}
          onContextMenu={(e) => h.current.artboardMenu(ab.id, e)}
        >
          <span className="layer-icon">
            <Icon name="artboard" size={14} />
          </span>
          <span className="layer-name">{ab.name}</span>
          <span className="layer-meta num">
            {ab.width} × {ab.height}
          </span>
        </div>
      </li>
    );
  };

  /** Ligne survolée pendant un glissement, retrouvée depuis l'élément sous le pointeur. */
  const rowAt = (target: EventTarget): { row: LayerRow; el: HTMLElement } | null => {
    const li = (target as HTMLElement).closest?.('[data-layer-id]') as HTMLElement | null;
    const div = li?.firstElementChild as HTMLElement | null;
    if (!li || !div) return null;
    const row = rows.find((r) => r.kind !== 'empty' && r.key === li.dataset.layerId);
    return row ? { row, el: div } : null;
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!drag) return;
    // Défilement automatique près des bords de la zone.
    const scroller = scrollParent(listRef.current);
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (e.clientY < r.top + 24) scroller.scrollTop -= 12;
      else if (e.clientY > r.bottom - 24) scroller.scrollTop += 12;
    }
    const hit = rowAt(e.target);
    if (hit && h.current.dragOver(hit.row, hit.el, e.clientY)) e.preventDefault();
  };

  return (
    <div className="panel-body layers-panel">
      <div className="picker-row">
        <NumberField
          label={t('layers.opacity')}
          value={first ? Math.round(first.opacity * 100) : null}
          disabled={!first}
          min={0}
          max={100}
          unit="%"
          width={96}
          testId="layer-opacity"
          onChange={(v) => updateSelected('history.style', (n) => void (n.opacity = v / 100))}
        />
        <Select<BlendMode>
          label={t('layers.blend')}
          value={first?.blendMode ?? 'normal'}
          options={BLEND_MODES.map((m) => ({ value: m, label: t(`blend.${m}`) }))}
          onChange={(m) => updateSelected('history.style', (n) => void (n.blendMode = m))}
        />
      </div>
      <ul
        ref={listRef}
        className={`layer-tree${virtual ? ' virtual' : ''}${drag ? ' dragging' : ''}`}
        role="tree"
        aria-label={t('studio.layers')}
        aria-multiselectable
        tabIndex={0}
        data-testid="layer-tree"
        style={virtual ? { height: rows.length * ROW, paddingTop: start * ROW } : undefined}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDrop={(e) => h.current.drop(e)}
      >
        {rows.slice(start, end).map(renderRow)}
      </ul>
      <Menu.Root open={!!menu} onOpenChange={(o) => !o && setMenu(null)} modal={false}>
        <Menu.Trigger asChild>
          <span
            aria-hidden
            className="context-anchor"
            style={{ position: 'fixed', left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="menu" align="start" sideOffset={2} data-testid="layer-menu">
            {menu?.kind === 'artboard' && (
              <>
                <Item id="document.addArtboard" />
                <Menu.Item
                  className="menu-item"
                  disabled={doc.artboards.length < 2}
                  data-testid="artboard-delete"
                  onSelect={() => deleteArtboard(menu.id)}
                >
                  <span className="menu-check" />
                  <span className="menu-label">{t('document.deleteArtboard')}</span>
                </Menu.Item>
              </>
            )}
            {menu?.kind === 'merge' && (
              <>
                <Item id="layer.group" />
                <Sep />
                <Item id="geometry.unite" />
                <Item id="geometry.subtract" />
                <Item id="geometry.intersect" />
                <Item id="geometry.exclude" />
                <Sep />
                <Item id="layer.mergeSelected" />
              </>
            )}
            {menu?.kind === 'node' && (
              <>
                <Item id="arrange.front" />
                <Item id="arrange.forward" />
                <Item id="arrange.backward" />
                <Item id="arrange.back" />
                <Sep />
                <Item id="edit.duplicate" />
                <Item id="layer.group" />
                <Item id="layer.ungroup" />
                <Sub label={t('layers.merge')}>
                  <Item id="geometry.unite" />
                  <Item id="geometry.subtract" />
                  <Item id="geometry.intersect" />
                  <Item id="geometry.exclude" />
                  <Item id="geometry.divide" />
                  <Sep />
                  <Item id="layer.mergeSelected" />
                </Sub>
                <Menu.Item
                  className="menu-item"
                  disabled={selection.length !== 1}
                  onSelect={() => setRenaming(selection[0])}
                >
                  <span className="menu-check" />
                  <span className="menu-label">{t('layer.rename')}</span>
                  <span className="menu-shortcut">F2</span>
                </Menu.Item>
                <Sep />
                <Item id="layer.lock" />
                <Item id="layer.hide" />
                <Sep />
                <Item id="edit.delete" />
              </>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <div className="layer-actions">
        {persona === 'photo' && (
          <>
            <button
              className="ib small"
              title={t('layer.newPixel')}
              aria-label={t('layer.newPixel')}
              onClick={() => runCommand('layer.newPixel')}
            >
              <Icon name="pixelLayer" size={14} />
            </button>
            <button
              className="ib small"
              title={t('layer.addMask')}
              aria-label={t('layer.addMask')}
              disabled={!COMMANDS['layer.addMask'].enabled()}
              onClick={() => runCommand('layer.addMask')}
            >
              <Icon name="addMask" size={14} />
            </button>
            <AdjustmentMenu small />
          </>
        )}
        <button
          className="ib small"
          title={t('layer.group')}
          aria-label={t('layer.group')}
          data-testid="layers-group"
          disabled={!selection.length}
          onClick={() => runCommand('layer.group')}
        >
          <Icon name="folder" size={14} />
        </button>
        <span className="spacer" />
        <button
          className="ib small"
          title={t('edit.delete')}
          aria-label={t('edit.delete')}
          data-testid="layers-delete"
          disabled={!selection.length}
          onClick={() => {
            if (ui.get().maskEditId && selection.includes(ui.get().maskEditId!)) ui.set({ maskEditId: null });
            deleteSelection();
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}
