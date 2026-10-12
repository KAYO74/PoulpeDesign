import {
  createPath,
  exactBounds,
  pathToSvg,
  pressureProfile,
  ropeFollow,
  simplifyPoints,
  taperProfile,
  type Vec,
} from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { t } from '../../i18n';
import { editor, ui } from '../../store';
import { paintCss, pickArtboard, realPressure, screenDist, strokePaint, type SubTool } from './common';
import { smoothingTolerance } from './pencil';
import { pathsState } from './state';

/*
 * Pinceau vectoriel : des coups de pinceau à main levée qui restent des courbes, d'épaisseur
 * variable (pression du stylet, ou effilement des deux bouts), avec lissage et stabilisateur à
 * corde, dans la couleur de contour courante.
 */

interface BrushStroke {
  points: Vec[];
  pressures: number[];
  pen: boolean;
  artboardId: string;
}

/** Moyenne glissante des points (le premier et le dernier restent en place). */
function average(pts: Vec[], k: number): Vec[] {
  if (k < 1 || pts.length < 3) return pts;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const win = pts.slice(Math.max(0, i - k), i + k + 1);
    return {
      x: win.reduce((s, q) => s + q.x, 0) / win.length,
      y: win.reduce((s, q) => s + q.y, 0) / win.length,
    };
  });
}

export class VectorBrushTool implements SubTool {
  private stroke: BrushStroke | null = null;
  /** Pointeur survolé (monde) : la taille du pinceau s'y dessine. */
  private at: Vec | null = null;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.stroke;
  }

  pointerDown(e: PointerEvent, p: Vec): boolean {
    const ab = pickArtboard(p);
    if (!ab) return true;
    this.stroke = { points: [p], pressures: [e.pressure], pen: e.pointerType === 'pen', artboardId: ab.id };
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec): boolean {
    this.at = p;
    const st = this.stroke;
    if (!st) {
      this.c.requestDraw();
      return true;
    }
    const last = st.points[st.points.length - 1];
    const rope = pathsState.get().brushStabilizer / this.c.view.zoom;
    // Stabilisateur : le trait suit le pointeur au bout d'une corde, les tremblements disparaissent.
    const q = rope > 0 ? ropeFollow(last, p, rope) : screenDist(this.c, last, p) >= 1.5 ? p : null;
    if (q && screenDist(this.c, last, q) >= 1) {
      st.points.push(q);
      st.pressures.push(e.pressure);
      this.c.requestDraw();
    }
    return true;
  }

  pointerUp(): boolean {
    const st = this.stroke;
    if (!st) return false;
    this.stroke = null;
    if (st.points.length >= 2) this.commit(st);
    this.c.requestDraw();
    return true;
  }

  cancel(): void {
    this.stroke = null;
  }

  /** [ et ] : épaisseur du pinceau, comme dans Affinity. */
  key(e: KeyboardEvent): boolean {
    const step = e.key === ']' ? 1 : e.key === '[' ? -1 : 0;
    if (!step || e.altKey) return false;
    const w = pathsState.get().brushWidth;
    const next = Math.max(0.5, Math.min(500, step > 0 ? w * 1.25 : w / 1.25));
    pathsState.set({ brushWidth: Math.round(next * 10) / 10 });
    this.c.requestDraw();
    return true;
  }

  private commit(st: BrushStroke): void {
    const o = pathsState.get();
    const pts = average(st.points, Math.round((o.brushSmoothing / 100) * 3));
    const cmds = simplifyPoints(pts, smoothingTolerance(this.c, o.brushSmoothing));
    const b = exactBounds(cmds);
    if (!b) return;
    const profile =
      o.brushPressure && realPressure(st.pen, st.pressures)
        ? pressureProfile(st.points, st.pressures)
        : taperProfile(o.brushTaper / 100, o.brushTaper / 100);
    const node = createPath({ ...b, d: pathToSvg(cmds), viewBox: b, name: t('paths.brushName') });
    node.fill = { type: 'none' };
    node.stroke = {
      paint: strokePaint(),
      width: o.brushWidth,
      cap: 'round',
      join: 'round',
      ...(profile ? { profile } : {}),
    };
    node.opacity = Math.max(0, Math.min(1, o.brushOpacity / 100));
    editor.apply('history.vectorBrush', (d) => {
      (d.artboards.find((a) => a.id === st.artboardId) ?? d.artboards[0]).children.push(node);
      return [node.id];
    });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const o = pathsState.get();
    const z = this.c.view.zoom;
    const st = this.stroke;
    ctx.save();
    if (st) {
      // Aperçu du coup de pinceau : sa couleur, son opacité, et la pression du stylet.
      ctx.globalAlpha = o.brushOpacity / 100;
      ctx.strokeStyle = paintCss(strokePaint());
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const usePressure = o.brushPressure && realPressure(st.pen, st.pressures);
      for (let i = 1; i < st.points.length; i++) {
        const a = this.c.toScreen(st.points[i - 1]),
          b = this.c.toScreen(st.points[i]);
        ctx.lineWidth = Math.max(0.5, o.brushWidth * z * (usePressure ? Math.max(0.05, st.pressures[i]) : 1));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else if (this.at && ui.get().tool === 'vectorBrush') {
      // Taille du pinceau sous le pointeur.
      const q = this.c.toScreen(this.at);
      ctx.strokeStyle = 'rgba(128,128,128,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(1, (o.brushWidth * z) / 2), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
