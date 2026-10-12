import {
  cachedSvgPath,
  cloneSubpaths,
  createPath,
  exactBounds,
  findNode,
  markSmart,
  nearestSegment,
  pathScale,
  pathToSvg,
  pathToWorld,
  pressureProfile,
  sculptSubpath,
  segmentCount,
  simplifyPoints,
  toSubpaths,
  worldToPath,
  type PathNode,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { t } from '../../i18n';
import { editor, ui } from '../../store';
import {
  HIT,
  drawnStroke,
  pickArtboard,
  realPressure,
  screenDist,
  tracePolyline,
  writeSubpaths,
  type SubTool,
} from './common';
import { pathsState } from './state';

/*
 * Crayon : main levée lissée, épaisseur d'après la pression du stylet, fermeture automatique, et
 * mode Sculpter d'Affinity (un trait parti d'une courbe sélectionnée la prolonge ou la remodèle).
 */

/** Départ d'un trait sur la courbe sélectionnée : sous-tracé et position (n° de segment + t). */
interface SculptStart {
  node: PathNode;
  si: number;
  u0: number;
}

interface PencilStroke {
  points: Vec[];
  pressures: number[];
  /** Le pointeur est un stylet (sa pression a un sens). */
  pen: boolean;
  artboardId: string;
  sculpt: SculptStart | null;
}

/** Tolérance du lissage (monde), d'après le réglage 0 à 100. */
export function smoothingTolerance(c: CanvasController, smoothing: number): number {
  return (0.3 + (smoothing / 100) * 8) / c.view.zoom;
}

export class PencilTool implements SubTool {
  private stroke: PencilStroke | null = null;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.stroke;
  }

  /** Position sur une courbe ouverte ou fermée du tracé sélectionné, sous le point écran (Sculpter). */
  private curveAt(n: PathNode, sps: SubPath[], s: Vec, si?: number): { si: number; u: number } | null {
    const near = (w: Vec) => {
      const q = this.c.toScreen(w);
      return Math.hypot(q.x - s.x, q.y - s.y);
    };
    // Les extrémités des tracés ouverts passent en premier : on prolonge.
    for (let i = 0; i < sps.length; i++) {
      const sp = sps[i];
      if ((si !== undefined && i !== si) || sp.closed || sp.anchors.length < 2) continue;
      if (near(pathToWorld(n, sp.anchors[0])) <= HIT + 1) return { si: i, u: 0 };
      if (near(pathToWorld(n, sp.anchors[sp.anchors.length - 1])) <= HIT + 1)
        return { si: i, u: segmentCount(sp) };
    }
    const pool =
      si === undefined ? sps : sps.map((sp, i) => (i === si ? sp : { anchors: [], closed: false }));
    const hit = nearestSegment(pool, worldToPath(n, this.c.toWorld(s.x, s.y)));
    if (!hit || near(pathToWorld(n, hit.point)) > HIT) return null;
    return { si: hit.si, u: hit.seg + hit.t };
  }

  private sculptStart(s: Vec): SculptStart | null {
    if (!pathsState.get().pencilSculpt || editor.selection.length !== 1) return null;
    const n = findNode(editor.doc, editor.selection[0])?.node;
    if (n?.type !== 'path' || n.locked || !n.visible) return null;
    const at = this.curveAt(n, toSubpaths(cachedSvgPath(n.d)), s);
    return at ? { node: n, si: at.si, u0: at.u } : null;
  }

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    const ab = pickArtboard(p);
    if (!ab) return true;
    this.stroke = {
      points: [p],
      pressures: [e.pressure],
      pen: e.pointerType === 'pen',
      artboardId: ab.id,
      sculpt: this.sculptStart(s),
    };
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec): boolean {
    const st = this.stroke;
    if (!st) return false;
    const last = st.points[st.points.length - 1];
    if (screenDist(this.c, last, p) >= 1.5) {
      st.points.push(p);
      st.pressures.push(e.pressure);
      this.c.requestDraw();
    }
    return true;
  }

  pointerUp(): boolean {
    const st = this.stroke;
    if (!st) return false;
    this.stroke = null;
    if (st.points.length >= 2 && !(st.sculpt && this.sculpt(st, st.sculpt))) this.newCurve(st);
    this.c.requestDraw();
    return true;
  }

  cancel(): void {
    this.stroke = null;
  }

  /** Mode Sculpter : le trait prolonge ou remplace un morceau du sous-tracé de départ. */
  private sculpt(st: PencilStroke, start: SculptStart): boolean {
    const n = start.node;
    const sps = cloneSubpaths(markSmart(toSubpaths(cachedSvgPath(n.d)), n.smartNodes));
    const sp = sps[start.si];
    if (!sp) return false;
    const { kx, ky } = pathScale(n);
    const tol = smoothingTolerance(this.c, ui.get().pencilSmoothing) / ((Math.abs(kx) + Math.abs(ky)) / 2);
    const drawn = toSubpaths(
      simplifyPoints(
        st.points.map((p) => worldToPath(n, p)),
        tol,
      ),
    )[0]?.anchors;
    if (!drawn || drawn.length < 2) return false;
    const endS = this.c.toScreen(st.points[st.points.length - 1]);
    const end = this.curveAt(n, sps, endS, start.si);
    const res = sculptSubpath(sp, start.u0, end?.u ?? null, drawn);
    if (!res) return false;
    sps[start.si] = res;
    editor.apply('history.sculpt', (d) => {
      const m = findNode(d, n.id)?.node;
      if (m?.type === 'path') writeSubpaths(m, sps);
      return [n.id];
    });
    return true;
  }

  private newCurve(st: PencilStroke): void {
    const pts = st.points;
    const opts = pathsState.get();
    const closed =
      opts.pencilAutoClose && pts.length > 8 && screenDist(this.c, pts[0], pts[pts.length - 1]) < 10;
    const cmds = simplifyPoints(pts, smoothingTolerance(this.c, ui.get().pencilSmoothing), closed);
    const b = exactBounds(cmds);
    if (!b) return;
    const stroke = drawnStroke();
    // Stylet : la pression devient un profil de largeur le long du trait.
    const profile =
      opts.pencilPressure && realPressure(st.pen, st.pressures) ? pressureProfile(pts, st.pressures) : null;
    if (profile) stroke.profile = profile;
    const node = createPath(
      { ...b, d: pathToSvg(cmds), viewBox: b, name: t('name.curve') },
      { ...ui.get().defaults, stroke },
    );
    node.fill = { type: 'none' };
    editor.apply('history.pencil', (d) => {
      (d.artboards.find((a) => a.id === st.artboardId) ?? d.artboards[0]).children.push(node);
      return [node.id];
    });
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    const st = this.stroke;
    if (!st) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    tracePolyline(ctx, this.c, st.points);
    ctx.stroke();
    if (st.sculpt) {
      // Le départ sur la courbe : le trait va la modifier.
      const q = this.c.toScreen(st.points[0]);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
