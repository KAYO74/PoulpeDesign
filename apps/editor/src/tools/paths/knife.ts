import { applyKnifePath, topLevelIds, type Vec } from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { t } from '../../i18n';
import { editor, toast } from '../../store';
import { alongPolyline, constrain45, screenDist, tracePolyline, type SubTool } from './common';

/*
 * Cutter : le trait dessiné à main levée coupe les objets partout où il les traverse (Maj : ligne
 * droite, à 45°). Sans sélection, il coupe ce qu'il rencontre.
 */

export class KnifeTool implements SubTool {
  private cut: { points: Vec[]; straight: boolean } | null = null;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.cut;
  }

  pointerDown(_e: PointerEvent, p: Vec): boolean {
    this.cut = { points: [p], straight: false };
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec): boolean {
    const g = this.cut;
    if (!g) return false;
    if (e.shiftKey) {
      g.points = [g.points[0], constrain45(g.points[0], p)];
      g.straight = true;
    } else if (g.straight) {
      g.points = [g.points[0], p];
      g.straight = false;
    } else if (screenDist(this.c, g.points[g.points.length - 1], p) >= 2) g.points.push(p);
    this.c.requestDraw();
    return true;
  }

  pointerUp(_e: PointerEvent, p: Vec): boolean {
    const g = this.cut;
    if (!g) return false;
    this.cut = null;
    const last = g.points[g.points.length - 1];
    const pts = g.straight || screenDist(this.c, last, p) < 0.5 ? g.points : [...g.points, p];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += screenDist(this.c, pts[i - 1], pts[i]);
    if (len < 4) {
      toast(t('vector.drawLine'));
      return true;
    }
    const doc = editor.doc;
    const ids = editor.selection.length ? topLevelIds(doc, editor.selection) : alongPolyline(this.c, pts);
    let made: string[] | null = null;
    if (ids.length)
      editor.apply('history.knife', (d) => {
        // Coupe très fine (un vingtième de pixel à l'écran) : les morceaux se touchent à l'œil.
        made = applyKnifePath(d, ids, pts, t('name.curve'), 0.05 / this.c.view.zoom);
        return made ?? undefined;
      });
    if (!made) toast(t('vector.cutNothing'));
    return true;
  }

  cancel(): void {
    this.cut = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== 'Escape' || !this.cut) return false;
    this.cut = null;
    this.c.requestDraw();
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    const g = this.cut;
    if (!g || g.points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    tracePolyline(ctx, this.c, g.points);
    ctx.stroke();
    ctx.restore();
  }
}
