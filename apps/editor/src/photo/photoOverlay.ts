import type { Vec } from '@poulpe/core';
import { brushOptions } from '../tools/brushes/state';
import { brushSettings, isBrushTool, ui } from '../store';
import { photoHooks } from './photoHooks';
import type { PhotoTools } from './photoTools';
import { selectionOutline } from './selection';

/*
 * Aides de la Persona Photo dessinées par-dessus le canevas : aperçu de la gomme magique, fourmis
 * de la sélection, tracés en cours, redressement, perspective, source du tampon, corde du
 * stabilisateur et contour du pinceau. Lit l'état des gestes de PhotoTools sans le modifier.
 */

/** Dessine les aides de la Persona Photo, en pixels d'écran. */
export function drawPhotoOverlay(tools: PhotoTools, ctx: CanvasRenderingContext2D): void {
  const view = ui.get().view;
  const toScreen = (p: Vec) => tools.c.toScreen(p);
  // Aperçu rouge de la gomme magique, posé sur le calque.
  const s = tools.brush.stroke;
  if (s?.tint) {
    ctx.save();
    const dpr = ctx.getTransform().a;
    const screen = new DOMMatrix([dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.panX, dpr * view.panY]);
    ctx.setTransform(screen.multiply(s.toPx.inverse()));
    ctx.drawImage(s.tint, 0, 0);
    ctx.restore();
  }
  // Fourmis de la sélection.
  const outline = photoHooks.hideAnts() ? null : selectionOutline();
  if (outline) {
    const offset = (Date.now() / 60) % 8;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const line of outline.lines) {
      for (let i = 0; i < line.length; i += 2) {
        const sp = toScreen(outline.toDoc(line[i], line[i + 1]));
        if (i === 0) ctx.moveTo(Math.round(sp.x) + 0.5, Math.round(sp.y) + 0.5);
        else ctx.lineTo(Math.round(sp.x) + 0.5, Math.round(sp.y) + 0.5);
      }
    }
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.strokeStyle = '#000000';
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -offset;
    ctx.stroke();
    ctx.restore();
  }
  const dashed = (draw: () => void) => {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    draw();
    ctx.stroke();
    ctx.strokeStyle = '#000000';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  };
  if (tools.marquee) {
    const a = toScreen(tools.marquee.start),
      b = toScreen(tools.marquee.current);
    const x = Math.min(a.x, b.x),
      y = Math.min(a.y, b.y),
      w = Math.abs(b.x - a.x),
      h = Math.abs(b.y - a.y);
    dashed(() => {
      ctx.beginPath();
      if (tools.marquee!.shape === 'rect') ctx.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, w, h);
      else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    });
  }
  if (tools.lasso && tools.lasso.points.length > 1) {
    const pts = tools.lasso.points.map(toScreen);
    dashed(() => {
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    });
  }
  if (tools.poly) {
    const pts = [...tools.poly.points, tools.poly.hover].map(toScreen);
    dashed(() => {
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    });
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    for (const q of pts.slice(0, -1)) {
      ctx.beginPath();
      ctx.rect(q.x - 2.5, q.y - 2.5, 5, 5);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  if (tools.geometry.straight) {
    const a = toScreen(tools.geometry.straight.start),
      b = toScreen(tools.geometry.straight.current);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffd400';
    ctx.stroke();
    ctx.restore();
  }
  if (
    tools.geometry.persp &&
    ui.get().perspectiveId === tools.geometry.persp.nodeId &&
    ui.get().tool === 'perspective'
  ) {
    const q = tools.geometry.persp.quad.map(toScreen);
    ctx.save();
    // Quadrillage 3 × 3 pour aligner les bords de l'objet à redresser.
    ctx.strokeStyle = 'rgba(255, 212, 0, 0.6)';
    ctx.lineWidth = 1;
    const lerp = (a: Vec, b: Vec, k: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    ctx.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      const a = lerp(q[0], q[1], k),
        b = lerp(q[3], q[2], k);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      const c = lerp(q[0], q[3], k),
        d = lerp(q[1], q[2], k);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1a1d';
    for (const p of q) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  // Source du tampon.
  const tool = ui.get().tool;
  if ((tool === 'clone' || tool === 'heal') && tools.brush.cloneSource && ui.get().persona === 'photo') {
    let src = tools.brush.cloneSource;
    // Non aligné : le prochain coup repartira du point source.
    if (tools.brush.cloneOffset && tools.pointer && (brushOptions.get().aligned || tools.brush.stroke))
      src = tools.brush.cloneSourceAt(tools.c.toWorld(tools.pointer.x, tools.pointer.y));
    const q = toScreen(src);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(q.x - 8, q.y);
    ctx.lineTo(q.x + 8, q.y);
    ctx.moveTo(q.x, q.y - 8);
    ctx.lineTo(q.x, q.y + 8);
    ctx.stroke();
    ctx.restore();
  }
  // Stabilisateur en mode corde : la corde tendue entre le pinceau et le pointeur.
  if (tools.pointer && s?.stab?.mode === 'rope') {
    const b0 = s.toPx.inverse().transformPoint(new DOMPoint(s.last.x, s.last.y));
    const b = toScreen({ x: b0.x, y: b0.y });
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(tools.pointer.x, tools.pointer.y);
    ctx.stroke();
    ctx.restore();
  }
  // Contour du pinceau sous le pointeur.
  if (tools.pointer && isBrushTool(tool) && ui.get().persona === 'photo') {
    const r = (brushSettings(tool).size / 2) * view.zoom;
    const { x, y } = tools.pointer;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r - 1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
