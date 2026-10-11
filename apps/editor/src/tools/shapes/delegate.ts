import {
  acceptsCorners,
  cornerSites,
  findNode,
  isStyled,
  localToWorld,
  setCorners,
  syncShape,
  worldToLocal,
  type CornerSite,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { t } from '../../i18n';
import { editor, toast, ui, type ToolId } from '../../store';
import { SHAPE_FAMILY } from '../../toolCatalog';
import type { ToolDelegate } from '../types';
import { handlesOf, type HandleDrag, type ShapeHandle } from './handles';
import { shapesStore } from './state';

/*
 * Gestes des outils de forme sur le canevas : poignées rouges des formes (outil Déplacer et
 * outils de forme) et outil Coin non destructif.
 */

const HIT = 7;
/** Écart minimal (pixels d'écran) entre une poignée d'arrondi et son coin. */
const MIN_OFFSET = 14;
/** Couleur des poignées de réglage, comme les poignées rouges d'Affinity. */
const RED = '#e5484d';

/** Le seul objet sélectionné, s'il est modifiable. */
function single(): SceneNode | null {
  const sel = editor.selection;
  if (sel.length !== 1) return null;
  const n = findNode(editor.doc, sel[0])?.node;
  return n && !n.locked && n.visible ? n : null;
}

/** Outils qui montrent les poignées rouges de l'objet sélectionné. */
function showsHandles(tool: ToolId): boolean {
  const s = ui.get();
  if (s.persona === 'photo' || s.editingTextId || s.cropId) return false;
  return tool === 'select' || (SHAPE_FAMILY.includes(tool) && tool !== 'line');
}

function dot(ctx: CanvasRenderingContext2D, p: Vec, r: number, fill: string, stroke: string) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

class ParamHandles {
  private drag: (HandleDrag & { id: string; handle: ShapeHandle; moved: boolean; start: Vec }) | null = null;
  private hover: string | null = null;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.drag;
  }

  /** Objet et poignées visibles (rien pendant un autre geste ou pour un objet trop petit à l'écran). */
  private current(): { node: SceneNode; handles: ShapeHandle[] } | null {
    if (!showsHandles(ui.get().tool)) return null;
    const node = single();
    if (!node) return null;
    const z = this.c.view.zoom;
    if (node.width * z < 24 || node.height * z < 24) return null;
    const handles = handlesOf(node, MIN_OFFSET / z);
    return handles.length ? { node, handles } : null;
  }

  private under(s: Vec): { node: SceneNode; handle: ShapeHandle } | null {
    const cur = this.current();
    if (!cur) return null;
    // La dernière poignée est dessinée au-dessus : elle passe en premier.
    for (let i = cur.handles.length - 1; i >= 0; i--) {
      const h = cur.handles[i];
      const q = this.c.toScreen(localToWorld(cur.node, h.at));
      if (Math.hypot(q.x - s.x, q.y - s.y) <= HIT) return { node: cur.node, handle: h };
    }
    return null;
  }

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    const hit = this.under(s);
    if (!hit) return false;
    const l0 = worldToLocal(hit.node, p);
    editor.begin();
    this.drag = {
      id: hit.node.id,
      handle: hit.handle,
      node: hit.node,
      l0,
      turn: { last: 0, total: 0 },
      shift: e.shiftKey,
      moved: false,
      start: s,
    };
    // Spirale : l'angle part de la position de la poignée.
    const n = hit.node;
    const q = {
      x: (l0.x - n.width / 2) / (n.width / 2 || 1),
      y: (l0.y - n.height / 2) / (n.height / 2 || 1),
    };
    const a = Math.atan2(q.x, -q.y);
    this.drag.turn.last = a < 0 ? a + Math.PI * 2 : a;
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    const g = this.drag;
    if (!g) {
      const h = this.under(s);
      const id = h ? h.handle.id : null;
      if (id !== this.hover) {
        this.hover = id;
        this.c.requestDraw();
      }
      if (h) this.c.canvas.style.cursor = 'pointer';
      return !!h;
    }
    if (!g.moved && Math.hypot(s.x - g.start.x, s.y - g.start.y) < 2) return true;
    g.moved = true;
    g.shift = e.shiftKey;
    const l = worldToLocal(g.node, p);
    editor.preview((d) => {
      const n = findNode(d, g.id)?.node;
      if (!n) return;
      g.handle.drag(n, l, g);
      if (n.type === 'path') syncShape(n);
    });
    return true;
  }

  pointerUp(): boolean {
    const g = this.drag;
    if (!g) return false;
    this.drag = null;
    if (g.moved) editor.commit('history.shapeParams');
    else editor.cancel();
    return true;
  }

  cancel(): void {
    if (this.drag) editor.cancel();
    this.drag = null;
  }

  doubleClick(s: Vec): boolean {
    const hit = this.under(s);
    if (!hit) return false;
    editor.apply('history.shapeParams', (d) => {
      const n = findNode(d, hit.node.id)?.node;
      if (!n) return;
      hit.handle.reset(n);
      if (n.type === 'path') syncShape(n);
    });
    return true;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const cur = this.current();
    if (!cur) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const h of cur.handles) {
      const q = this.c.toScreen(localToWorld(cur.node, h.at));
      const on = this.drag?.handle.id === h.id || (!this.drag && this.hover === h.id);
      dot(ctx, q, on ? 5.5 : 4.5, RED, '#ffffff');
    }
    ctx.restore();
  }
}

interface CornerDrag {
  id: string;
  node: SceneNode;
  keys: string[];
  /** Nœud saisi (repère local), rayon de départ et distance de départ du pointeur au nœud. */
  vertex: Vec;
  r0: number;
  d0: number;
  start: Vec;
  moved: boolean;
}

/** Outil Coin : rayon et forme posés sur chaque coin, sans toucher au contour de base. */
class CornerTool {
  private drag: CornerDrag | null = null;
  private hover: string | null = null;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.drag;
  }

  private active(): boolean {
    return ui.get().tool === 'corner' && ui.get().persona !== 'photo';
  }

  /** Objet sélectionné qui accepte des coins, et ses coins. */
  private target(): { node: SceneNode; sites: CornerSite[] } | null {
    const node = single();
    if (!node || !acceptsCorners(node)) return null;
    return { node, sites: cornerSites(node) };
  }

  private siteUnder(s: Vec): { node: SceneNode; site: CornerSite; sites: CornerSite[] } | null {
    const tg = this.target();
    if (!tg) return null;
    let best: { site: CornerSite; d: number } | null = null;
    for (const site of tg.sites) {
      const q = this.c.toScreen(localToWorld(tg.node, site.p));
      const d = Math.hypot(q.x - s.x, q.y - s.y);
      if (d <= HIT + 2 && (!best || d < best.d)) best = { site, d };
    }
    return best ? { node: tg.node, site: best.site, sites: tg.sites } : null;
  }

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    if (!this.active()) return false;
    let found = this.siteUnder(s);
    if (!found) {
      const hit = this.c.hitTest(p, true);
      if (!hit || hit.locked) {
        editor.select([]);
        return true;
      }
      editor.select([hit.id]);
      const sites = acceptsCorners(hit) ? cornerSites(hit) : [];
      if (!sites.length) {
        if (isStyled(hit)) toast(t('vector.noCorner'));
        return true;
      }
      // Clic sur l'objet : le coin le plus proche.
      const l = worldToLocal(hit, p);
      const site = sites.reduce((a, b) =>
        Math.hypot(b.p.x - l.x, b.p.y - l.y) < Math.hypot(a.p.x - l.x, a.p.y - l.y) ? b : a,
      );
      found = { node: hit, site, sites };
    }
    const { node, site, sites } = found;
    // Alt : tous les coins de l'objet à la fois.
    const keys = e.altKey ? sites.map((c) => c.key) : [site.key];
    const l = worldToLocal(node, p);
    editor.begin();
    this.drag = {
      id: node.id,
      node,
      keys,
      vertex: site.p,
      r0: site.corner?.radius ?? 0,
      d0: Math.hypot(l.x - site.p.x, l.y - site.p.y),
      start: s,
      moved: false,
    };
    shapesStore.set({ active: { id: node.id, keys } });
    return true;
  }

  private apply(radius: number): void {
    const g = this.drag!;
    const type = shapesStore.get().cornerType;
    editor.preview((d) => {
      const n = findNode(d, g.id)?.node;
      if (n) setCorners(n, g.keys, radius, type);
      return [g.id];
    });
  }

  pointerMove(_e: PointerEvent, p: Vec, s: Vec): boolean {
    if (!this.active()) return false;
    const g = this.drag;
    if (!g) {
      const h = this.siteUnder(s);
      const id = h ? h.site.key : null;
      if (id !== this.hover) {
        this.hover = id;
        this.c.requestDraw();
      }
      return false;
    }
    if (!g.moved && Math.hypot(s.x - g.start.x, s.y - g.start.y) < 3) return true;
    g.moved = true;
    const l = worldToLocal(g.node, p);
    const r = Math.max(
      0,
      Math.round((g.r0 + Math.hypot(l.x - g.vertex.x, l.y - g.vertex.y) - g.d0) * 10) / 10,
    );
    shapesStore.set({ cornerRadius: r });
    this.apply(r);
    return true;
  }

  pointerUp(): boolean {
    const g = this.drag;
    if (!g) return false;
    // Un simple clic pose le rayon de la barre contextuelle.
    if (!g.moved) this.apply(shapesStore.get().cornerRadius);
    this.drag = null;
    editor.commit('history.corner');
    return true;
  }

  cancel(): void {
    if (this.drag) editor.cancel();
    this.drag = null;
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    if (!this.active()) return;
    const tg = this.target();
    if (!tg) return;
    const act = shapesStore.get().active;
    const keys = new Set(act?.id === tg.node.id ? act.keys : []);
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const site of tg.sites) {
      const q = this.c.toScreen(localToWorld(tg.node, site.p));
      const big = keys.has(site.key) || this.hover === site.key;
      dot(ctx, q, big ? 5.5 : 4, site.corner ? color : '#ffffff', site.corner ? '#ffffff' : color);
    }
    ctx.restore();
  }
}

export function shapesDelegate(c: CanvasController): ToolDelegate {
  const handles = new ParamHandles(c);
  const corner = new CornerTool(c);
  return {
    get busy() {
      return handles.busy || corner.busy;
    },
    pointerDown: (e, p, s) => corner.pointerDown(e, p, s) || handles.pointerDown(e, p, s),
    pointerMove: (e, p, s) => corner.pointerMove(e, p, s) || handles.pointerMove(e, p, s),
    pointerUp: () => corner.pointerUp() || handles.pointerUp(),
    cancel: () => {
      corner.cancel();
      handles.cancel();
    },
    doubleClick: (_e, _p, s) => handles.doubleClick(s),
    key: (e) => {
      if (e.key !== 'Escape' || !(handles.busy || corner.busy)) return false;
      corner.cancel();
      handles.cancel();
      c.requestDraw();
      return true;
    },
    draw: (ctx, color) => {
      handles.draw(ctx);
      corner.draw(ctx, color);
    },
  };
}
