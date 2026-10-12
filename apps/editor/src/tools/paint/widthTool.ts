import {
  findNode,
  flattenCommands,
  isStyled,
  localToWorld,
  profilePositions,
  shapePath,
  strokeWidthAt,
  type SceneNode,
  type Stroke,
  type Vec,
} from '@poulpe/core';
import { editor, ui } from '../../store';
import type { CanvasController } from '../../canvas/controller';
import { paintStore } from './state';
import { styledIn } from './gradientTool';

/*
 * Outil Largeur de trait [W] : des points de largeur posés n'importe où le long du trait. Glisser
 * depuis le trait pose un point à cet endroit exact et règle sa largeur ; un point se glisse le
 * long du trait, le bout de sa barre change sa largeur ; Suppr le retire. Le profil est celui du
 * contour principal (`Stroke.profile`, avec ses positions `profilePos`).
 */

/** Rayon de prise des points et des bouts de barre (pixels d'écran). */
const GRAB = 7;

/** Un sous-tracé mis à plat dans le monde, avec sa longueur cumulée (comme le rendu). */
interface Track {
  pts: Vec[];
  lens: number[];
  total: number;
}

/** Point de largeur : position de 0 à 1 le long du tracé et multiplicateur de l'épaisseur. */
export interface WidthPoint {
  t: number;
  w: number;
}

export function widthPoints(stroke: Stroke): WidthPoint[] {
  const p = stroke.profile && stroke.profile.length >= 2 ? stroke.profile : [1, 1];
  const pos = profilePositions({ ...stroke, profile: p });
  return p.map((w, i) => ({ t: pos[i], w }));
}

/** Contour dont les points sont remplacés ; tout à 1 : épaisseur constante. */
export function withWidthPoints(stroke: Stroke, pts: WidthPoint[]): Stroke {
  const s = { ...stroke };
  if (pts.every((p) => Math.abs(p.w - 1) < 1e-3)) {
    delete s.profile;
    delete s.profilePos;
    return s;
  }
  s.profile = pts.map((p) => Math.round(p.w * 100) / 100);
  s.profilePos = pts.map((p) => Math.round(p.t * 10000) / 10000);
  return s;
}

const trackCache = new WeakMap<SceneNode, Track[]>();

/** Sous-tracés d'un objet dans le monde ; un tracé fermé fait tout le tour. */
function tracks(n: SceneNode): Track[] {
  const hit = trackCache.get(n);
  if (hit) return hit;
  const out: Track[] = [];
  for (const sub of flattenCommands(shapePath(n), 0.25)) {
    let src = sub.points;
    if (src.length < 2) continue;
    const a = src[0],
      z = src[src.length - 1];
    if (sub.closed && Math.hypot(a.x - z.x, a.y - z.y) > 1e-9) src = [...src, a];
    const pts = src.map((p) => localToWorld(n, p));
    const lens = [0];
    for (let i = 1; i < pts.length; i++)
      lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    out.push({ pts, lens, total: lens[lens.length - 1] || 1 });
  }
  if (Object.isFrozen(n)) trackCache.set(n, out);
  return out;
}

/** Point du tracé à la position `t` (0 à 1) et normale unitaire. */
function pointAt(tr: Track, t: number): { p: Vec; n: Vec } {
  const s = Math.min(1, Math.max(0, t)) * tr.total;
  let i = 1;
  while (i < tr.pts.length - 1 && tr.lens[i] < s) i++;
  const a = tr.pts[i - 1],
    b = tr.pts[i];
  const seg = tr.lens[i] - tr.lens[i - 1] || 1;
  const f = Math.min(1, Math.max(0, (s - tr.lens[i - 1]) / seg));
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { p: { x: a.x + dx * f, y: a.y + dy * f }, n: { x: -dy / l, y: dx / l } };
}

/** Point du tracé le plus proche : sous-tracé, position et distance (monde). */
function nearest(trs: Track[], p: Vec): { k: number; t: number; at: Vec; dist: number } | null {
  let best: { k: number; t: number; at: Vec; dist: number } | null = null;
  trs.forEach((tr, k) => {
    for (let i = 1; i < tr.pts.length; i++) {
      const a = tr.pts[i - 1],
        b = tr.pts[i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1e-12;
      const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const at = { x: a.x + dx * f, y: a.y + dy * f };
      const dist = Math.hypot(p.x - at.x, p.y - at.y);
      if (!best || dist < best.dist)
        best = { k, t: (tr.lens[i - 1] + Math.sqrt(l2) * f) / tr.total, at, dist };
    }
  });
  return best;
}

/** Objet dont l'outil règle le trait : le premier objet sélectionné qui a un trait visible. */
export function widthTarget(): SceneNode | null {
  return (
    styledIn(editor.doc, editor.selection).find(
      (n) => isStyled(n) && n.stroke.paint.type !== 'none' && n.stroke.width > 0,
    ) ?? null
  );
}

interface Drag {
  id: string;
  /** `width` : largeur du point ; `move` : position du point le long du trait. */
  kind: 'width' | 'move';
  index: number;
  track: number;
  points: WidthPoint[];
  startScreen: Vec;
  moved: boolean;
  /** Le point vient d'être posé : le geste compte même sans glisser. */
  added: boolean;
  label: string;
  at: Vec;
}

export class WidthTool {
  private drag: Drag | null = null;
  private hoverAt: Vec | null = null;
  /** Le pointeur est sur un point de largeur ou le bout de sa barre. */
  private hoverPart = false;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.drag;
  }

  private active(): boolean {
    const s = ui.get();
    return s.tool === 'strokeWidth' && s.persona !== 'photo';
  }

  /** Partie sous le pointeur (pixels d'écran) : bout de barre, point, ou trait. */
  private partAt(n: SceneNode, s: Vec): { kind: 'width' | 'move'; index: number; track: number } | null {
    if (!isStyled(n)) return null;
    const pts = widthPoints(n.stroke);
    const half = n.stroke.width / 2;
    const trs = tracks(n);
    for (let k = 0; k < trs.length; k++) {
      for (let i = 0; i < pts.length; i++) {
        const { p, n: nrm } = pointAt(trs[k], pts[i].t);
        const r = half * pts[i].w;
        for (const sg of [1, -1]) {
          const e = this.c.toScreen({ x: p.x + nrm.x * r * sg, y: p.y + nrm.y * r * sg });
          if (Math.hypot(e.x - s.x, e.y - s.y) <= GRAB) return { kind: 'width', index: i, track: k };
        }
        const q = this.c.toScreen(p);
        // Les points du milieu glissent le long du trait ; ceux des bouts restent aux bouts.
        if (i > 0 && i < pts.length - 1 && Math.hypot(q.x - s.x, q.y - s.y) <= GRAB)
          return { kind: 'move', index: i, track: k };
      }
    }
    return null;
  }

  pointerDown(_e: PointerEvent, p: Vec, s: Vec): boolean {
    if (!this.active()) return false;
    let n = widthTarget();
    const part = n ? this.partAt(n, s) : null;
    if (n && part && isStyled(n)) {
      paintStore.set({ widthPoint: part.index });
      editor.begin();
      const points = widthPoints(n.stroke);
      this.drag = {
        id: n.id,
        ...part,
        points,
        startScreen: s,
        moved: false,
        added: false,
        label: '',
        at: pointAt(tracks(n)[part.track], points[part.index].t).p,
      };
      return true;
    }
    let near = n && this.nearStroke(n, p);
    if (!near) {
      // Ailleurs : on choisit l'objet sous le pointeur, et on part de son trait si on est dessus.
      const hit = this.c.hitTest(p, false);
      editor.select(hit ? [hit.id] : []);
      n = widthTarget();
      near = n && this.nearStroke(n, p);
      if (!near) return true;
    }
    return this.startNew(n!, near, s);
  }

  /** Point du trait sous le pointeur, à une demi-épaisseur près (et quelques pixels). */
  private nearStroke(n: SceneNode, p: Vec): { k: number; t: number; at: Vec; dist: number } | null {
    const near = nearest(tracks(n), p);
    const reach = Math.max(GRAB / this.c.view.zoom, isStyled(n) ? n.stroke.width * 0.75 : 0);
    return near && near.dist <= reach ? near : null;
  }

  /** Nouveau point de largeur à l'endroit exact du trait, dont on règle la largeur en glissant. */
  private startNew(n: SceneNode, near: { k: number; t: number; at: Vec }, s: Vec): boolean {
    if (!isStyled(n)) return true;
    const pts = widthPoints(n.stroke);
    let index = pts.findIndex((q) => Math.abs(q.t - near.t) < 0.004);
    let added = false;
    if (index < 0) {
      const w = strokeWidthAt(n.stroke, near.t);
      index = pts.findIndex((q) => q.t > near.t);
      if (index < 0) index = pts.length;
      pts.splice(index, 0, { t: near.t, w });
      added = true;
    }
    paintStore.set({ widthPoint: index });
    editor.begin();
    this.drag = {
      id: n.id,
      kind: 'width',
      index,
      track: near.k,
      points: pts,
      startScreen: s,
      moved: false,
      added,
      label: '',
      at: near.at,
    };
    if (added) this.write(this.drag);
    return true;
  }

  pointerMove(_e: PointerEvent, p: Vec, s: Vec): boolean {
    const g = this.drag;
    if (!g) {
      this.updateHover(p, s);
      return false;
    }
    if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return true;
    g.moved = true;
    const n = findNode(editor.getState().doc, g.id)?.node;
    if (!n || !isStyled(n)) return true;
    const trs = tracks(n);
    const tr = trs[g.track] ?? trs[0];
    if (!tr) return true;
    if (g.kind === 'width') {
      // L'écart entre le pointeur et le trait donne la demi-épaisseur voulue.
      const at = pointAt(tr, g.points[g.index].t).p;
      g.at = at;
      const half = Math.max(0.0001, n.stroke.width / 2);
      const w = Math.min(20, Math.max(0, Math.hypot(p.x - at.x, p.y - at.y) / half));
      g.points[g.index] = { ...g.points[g.index], w };
      g.label = `${Math.round(w * n.stroke.width * 10) / 10} px`;
    } else {
      const near = nearest([tr], p);
      if (near) {
        const lo = g.points[g.index - 1].t + 0.002,
          hi = g.points[g.index + 1].t - 0.002;
        const t = Math.min(hi, Math.max(lo, near.t));
        g.points[g.index] = { ...g.points[g.index], t };
        g.at = pointAt(tr, t).p;
        g.label = `${Math.round(t * 100)} %`;
      }
    }
    this.write(g);
    this.c.requestDraw();
    return true;
  }

  private write(g: Drag): void {
    const pts = g.points.map((q) => ({ ...q }));
    editor.preview((d) => {
      const n = findNode(d, g.id)?.node;
      if (n && isStyled(n)) n.stroke = withWidthPoints(n.stroke, pts);
    });
  }

  pointerUp(): boolean {
    const g = this.drag;
    if (!g) return false;
    this.drag = null;
    if (!g.moved && !g.added) editor.cancel();
    else editor.commit('history.strokeWidth');
    this.c.requestDraw();
    return true;
  }

  cancel(): void {
    if (this.drag) editor.cancel();
    this.drag = null;
  }

  key(e: KeyboardEvent): boolean {
    if (!this.active() || (e.key !== 'Delete' && e.key !== 'Backspace')) return false;
    const n = widthTarget();
    const i = paintStore.get().widthPoint;
    if (!n || !isStyled(n) || i === null) return false;
    const pts = widthPoints(n.stroke);
    // Les points des bouts restent : Suppr les ramène à l'épaisseur du trait.
    const next =
      i > 0 && i < pts.length - 1
        ? pts.filter((_, j) => j !== i)
        : pts.map((q, j) => (j === i ? { ...q, w: 1 } : q));
    editor.apply('history.strokeWidth', (d) => {
      const m = findNode(d, n.id)?.node;
      if (m && isStyled(m)) m.stroke = withWidthPoints(m.stroke, next);
    });
    paintStore.set({ widthPoint: null });
    return true;
  }

  private updateHover(p: Vec, s: Vec): void {
    if (!this.active()) {
      this.hoverAt = null;
      this.hoverPart = false;
      return;
    }
    const n = widthTarget();
    this.hoverPart = !!n && !!this.partAt(n, s);
    const at = (n && !this.hoverPart && this.nearStroke(n, p)?.at) || null;
    if (at?.x !== this.hoverAt?.x || at?.y !== this.hoverAt?.y) {
      this.hoverAt = at;
      this.c.requestDraw();
    }
  }

  cursor(tool: string): string | null {
    return tool === 'strokeWidth' && this.hoverPart ? 'move' : null;
  }

  // ————— Dessin (repère de l'écran) —————

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    if (!this.active()) return;
    const g = this.drag;
    const n = g ? findNode(editor.doc, g.id)?.node : widthTarget();
    if (!n || !isStyled(n)) return;
    const pts = widthPoints(n.stroke);
    const half = n.stroke.width / 2;
    const sel = paintStore.get().widthPoint;
    ctx.save();
    for (const tr of tracks(n)) {
      pts.forEach((q, i) => {
        const { p, n: nrm } = pointAt(tr, q.t);
        const r = half * q.w;
        const a = this.c.toScreen({ x: p.x + nrm.x * r, y: p.y + nrm.y * r });
        const b = this.c.toScreen({ x: p.x - nrm.x * r, y: p.y - nrm.y * r });
        const m = this.c.toScreen(p);
        ctx.lineWidth = 1;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        for (const e of [a, b]) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(e.x, e.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.fillStyle = i === sel ? color : '#ffffff';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - 5);
        ctx.lineTo(m.x + 5, m.y);
        ctx.lineTo(m.x, m.y + 5);
        ctx.lineTo(m.x - 5, m.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
    }
    if (!g && this.hoverAt) {
      const h = this.c.toScreen(this.hoverAt);
      ctx.strokeStyle = color;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(h.x, h.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (g?.moved && g.label) {
      const b = this.c.toScreen(g.at);
      ctx.font = '11px system-ui, sans-serif';
      const w = ctx.measureText(g.label).width + 10;
      ctx.fillStyle = color;
      ctx.fillRect(b.x + 12, b.y + 12, w, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(g.label, b.x + 17, b.y + 25);
    }
    ctx.restore();
  }
}
