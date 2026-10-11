import { gradientPosition, luma, parseColor, type RGBA, type Vec } from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { copyDrawable, makeCanvas } from '../../photo/pixels';
import { ui } from '../../store';
import type { ToolDelegate } from '../types';
import { pixelStore } from './store';
import { pixelTarget, type PixelTarget } from './target';

/*
 * Outil Dégradé de la Persona Photo : glisser sur le calque peint un dégradé de la couleur
 * principale à la couleur secondaire (linéaire, radial, elliptique ou conique), limité à la
 * sélection de pixels, avec aperçu pendant le geste et une seule étape d'historique. Dans un
 * masque de calque (ou la sélection, en masque rapide), le dégradé va de la luminosité de l'une à
 * celle de l'autre. Maj : direction par pas de 15°.
 */

interface Drag {
  tg: PixelTarget;
  a: Vec;
  b: Vec;
  work: HTMLCanvasElement;
  grad: HTMLCanvasElement;
  raf: number;
}

/** Couleurs des deux extrémités : telles quelles, ou en opacité blanche pour un masque. */
function stops(tg: PixelTarget): [RGBA, RGBA] {
  const { brushColor, brushColor2 } = ui.get();
  const stop = (c: string): RGBA => {
    const p = parseColor(c);
    return tg.which === 'pixels' ? p : { r: 255, g: 255, b: 255, a: luma(p.r, p.g, p.b) / 255 };
  };
  const pair: [RGBA, RGBA] = [stop(brushColor), stop(brushColor2)];
  return pixelStore.get().gradientReverse ? [pair[1], pair[0]] : pair;
}

const css = (c: RGBA) => `rgba(${c.r},${c.g},${c.b},${c.a.toFixed(4)})`;

/** Peint le dégradé dans `grad`, puis le pose sur les pixels de départ dans `work`. */
function paint(d: Drag): void {
  const { tg, a, b, work, grad } = d;
  const s = pixelStore.get();
  const W = work.width,
    H = work.height;
  const [c0, c1] = stops(tg);
  const gc = grad.getContext('2d')!;
  gc.save();
  gc.setTransform(1, 0, 0, 1, 0, 0);
  gc.clearRect(0, 0, W, H);
  // Le chemin couvre toute la toile ; le dégradé est décrit en coordonnées du document.
  gc.beginPath();
  gc.rect(0, 0, W, H);
  const m = tg.toPx;
  const vx = b.x - a.x,
    vy = b.y - a.y;
  const len = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx);
  const aspect = Math.max(0.05, s.gradientAspect / 100);
  let style: CanvasGradient | null = null;
  if (s.gradientKind === 'linear') {
    gc.setTransform(m);
    style = gc.createLinearGradient(a.x, a.y, b.x, b.y);
  } else if (s.gradientKind === 'radial') {
    gc.setTransform(m);
    style = gc.createRadialGradient(a.x, a.y, 0, a.x, a.y, len);
  } else if (s.gradientKind === 'elliptical') {
    gc.setTransform(
      m
        .translate(a.x, a.y)
        .rotate((angle * 180) / Math.PI)
        .scale(1, aspect),
    );
    style = gc.createRadialGradient(0, 0, 0, 0, 0, len);
  } else if (typeof gc.createConicGradient === 'function') {
    gc.setTransform(m);
    style = gc.createConicGradient(angle, a.x, a.y);
  }
  if (style) {
    style.addColorStop(0, css(c0));
    style.addColorStop(1, css(c1));
    gc.fillStyle = style;
    gc.fill();
  } else {
    // Navigateur sans dégradé conique : calcul pixel par pixel.
    const inv = m.inverse();
    const [p0, p1] = [c0, c1];
    const img = gc.createImageData(W, H);
    const out = img.data;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const q = inv.transformPoint(new DOMPoint(x + 0.5, y + 0.5));
        const k = gradientPosition('conical', q, a, b);
        const o = (y * W + x) * 4;
        out[o] = p0.r + (p1.r - p0.r) * k;
        out[o + 1] = p0.g + (p1.g - p0.g) * k;
        out[o + 2] = p0.b + (p1.b - p0.b) * k;
        out[o + 3] = 255 * (p0.a + (p1.a - p0.a) * k);
      }
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.putImageData(img, 0, 0);
  }
  gc.setTransform(1, 0, 0, 1, 0, 0);
  if (tg.sel) {
    gc.globalCompositeOperation = 'destination-in';
    gc.drawImage(tg.sel, 0, 0);
  }
  gc.restore();

  const wc = work.getContext('2d')!;
  wc.save();
  wc.setTransform(1, 0, 0, 1, 0, 0);
  wc.globalCompositeOperation = 'copy';
  wc.drawImage(tg.base, 0, 0);
  wc.globalAlpha = Math.max(0, Math.min(1, s.gradientOpacity / 100));
  if (tg.which === 'pixels') {
    wc.globalCompositeOperation = 'source-over';
    wc.drawImage(grad, 0, 0);
  } else {
    // Masque : on va vers la valeur du dégradé (opacité), dans la sélection.
    wc.globalCompositeOperation = 'destination-out';
    if (tg.sel) wc.drawImage(tg.sel, 0, 0);
    else wc.fillRect(0, 0, W, H);
    wc.globalCompositeOperation = 'lighter';
    wc.drawImage(grad, 0, 0);
  }
  wc.restore();
}

/** Maj : direction par pas de 15°. */
function constrain(a: Vec, p: Vec): Vec {
  const len = Math.hypot(p.x - a.x, p.y - a.y);
  const step = Math.PI / 12;
  const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / step) * step;
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

export function gradientDelegate(c: CanvasController): ToolDelegate {
  let drag: Drag | null = null;
  const active = () => ui.get().tool === 'pixelGradient' && ui.get().persona === 'photo';

  const render = () => {
    if (!drag) return;
    drag.raf = 0;
    paint(drag);
    drag.tg.live(drag.work);
    c.requestDraw();
  };

  return {
    get busy() {
      return !!drag;
    },
    pointerDown(e, p) {
      if (!active()) return false;
      if (ui.get().busy) return true;
      const tg = pixelTarget(p, { create: true, mask: true, quickMask: true });
      if (!tg) return true;
      drag = {
        tg,
        a: p,
        b: p,
        work: copyDrawable(tg.base),
        grad: makeCanvas(tg.base.width, tg.base.height),
        raf: 0,
      };
      return true;
    },
    pointerMove(e, p) {
      if (!drag) return false;
      drag.b = e.shiftKey ? constrain(drag.a, p) : p;
      if (!drag.raf) drag.raf = requestAnimationFrame(render);
      c.requestDraw();
      return true;
    },
    pointerUp() {
      const d = drag;
      if (!d) return false;
      drag = null;
      if (d.raf) cancelAnimationFrame(d.raf);
      const z = ui.get().view.zoom;
      if (Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) * z < 3) {
        d.tg.live(null);
        return true;
      }
      paint(d);
      d.tg.commit(d.work, 'history.pixelGradient');
      d.tg.live(null);
      return true;
    },
    cancel() {
      if (!drag) return;
      if (drag.raf) cancelAnimationFrame(drag.raf);
      drag.tg.live(null);
      drag = null;
    },
    draw(ctx) {
      if (!drag) return;
      const a = c.toScreen(drag.a),
        b = c.toScreen(drag.b);
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      for (const [q, col] of [
        [a, ui.get().brushColor],
        [b, ui.get().brushColor2],
      ] as const) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}
