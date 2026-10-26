import {
  hatchTile,
  isElliptical,
  linearPoints,
  radialFrame,
  rgbaToCss,
  sampleStops,
  type Paint,
  type PoulpeDocument,
} from '@poulpe/core';
import { makeCanvas, type AnyCanvas, type AnyCtx, type Ctx } from './canvas';
import type { ImageSource } from './images';

/*
 * Peintures sur la toile : couleurs unies, dégradés (linéaires, radiaux, elliptiques, coniques)
 * et motifs d'image, dans le repère local d'un objet.
 *
 * `fillEverywhere` est interne au paquet (masque de transparence, voir effects.ts) : index.ts ne
 * la réexporte pas.
 */

/** Style de peinture dans le repère local d'un objet de taille w × h. */
export function canvasPaint(
  ctx: Ctx,
  paint: Paint,
  w: number,
  h: number,
  doc?: PoulpeDocument,
  images?: ImageSource,
): string | CanvasGradient | CanvasPattern | null {
  switch (paint.type) {
    case 'none':
      return null;
    case 'solid':
      return rgbaToCss(paint.color);
    case 'linear': {
      const [a, b] = linearPoints(paint, w, h);
      // Début et fin confondus : la toile ne peindrait rien.
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) b.x += 1e-3;
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), rgbaToCss(s.color));
      return g;
    }
    case 'radial': {
      if (isElliptical(paint) && Math.abs((paint.ratio ?? 1) - 1) > 1e-3)
        return ellipticalPattern(ctx, paint, w, h);
      const f = radialFrame(paint, w, h);
      const g = ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, f.r);
      for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), rgbaToCss(s.color));
      return g;
    }
    case 'conic': {
      const cx = paint.cx * w,
        cy = paint.cy * h;
      // `createConicGradient` manque à quelques navigateurs : on approche alors par des secteurs.
      const make = (
        ctx as unknown as { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }
      ).createConicGradient;
      if (typeof make !== 'function') return conicFallback(ctx, paint, w, h);
      const g = make.call(ctx, (paint.angle * Math.PI) / 180, cx, cy);
      for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), rgbaToCss(s.color));
      return g;
    }
    case 'pattern': {
      if (!doc || !images) return null;
      const img = images.get(doc, paint.assetId);
      if (!img) return null;
      const pat = ctx.createPattern(img as CanvasImageSource, 'repeat');
      if (!pat) return null;
      const k = Math.max(0.01, paint.scale);
      pat.setTransform(
        new DOMMatrix()
          .translate((paint.x ?? 0) * w, (paint.y ?? 0) * h)
          .rotate(paint.angle)
          .scale(k, k),
      );
      return pat;
    }
    case 'hatch':
      return hatchPattern(ctx, paint);
  }
}

/**
 * Hachures : la tuile est dessinée à la résolution de l'écran (nombre entier de pixels, sans
 * jointure visible), puis répétée et tournée.
 */
function hatchPattern(ctx: Ctx, paint: Extract<Paint, { type: 'hatch' }>): CanvasPattern | null {
  const { size, shapes } = hatchTile(paint);
  const t = ctx.getTransform();
  const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
  const n = Math.max(2, Math.min(512, Math.round(size * scale)));
  const k = n / size;
  const tile = makeCanvas(n, n);
  const c = tile.ctx;
  if (paint.background) {
    c.fillStyle = rgbaToCss(paint.background);
    c.fillRect(0, 0, n, n);
  }
  c.fillStyle = rgbaToCss(paint.color);
  for (const s of shapes) {
    if (s.kind === 'rect') c.fillRect(s.x * k, s.y * k, s.w * k, s.h * k);
    else {
      c.beginPath();
      c.arc(s.cx * k, s.cy * k, s.r * k, 0, Math.PI * 2);
      c.fill();
    }
  }
  const pat = ctx.createPattern(tile.canvas as CanvasImageSource, 'repeat');
  if (!pat) return null;
  pat.setTransform(new DOMMatrix().rotate(paint.angle).scale(1 / k, 1 / k));
  return pat;
}

type RadialPaint = Extract<Paint, { type: 'radial' }>;

/** Repère d'un dégradé elliptique : le cercle de rayon `r` centré en 0 devient l'ellipse dans la boîte. */
function ellipseMatrix(f: ReturnType<typeof radialFrame>): DOMMatrix {
  return new DOMMatrix().translate(f.cx, f.cy).rotate(f.angle).scale(1, f.ratio);
}

function radialStops(g: CanvasGradient, paint: RadialPaint): CanvasGradient {
  for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), rgbaToCss(s.color));
  return g;
}

/** Images des dégradés elliptiques, gardées tant que la peinture et la taille ne changent pas. */
const ellipseCache = new WeakMap<RadialPaint, { key: string; canvas: AnyCanvas }>();

/**
 * Dégradé elliptique : la toile ne sait faire que des cercles. Le cercle est peint dans une image
 * qui couvre la boîte (et une marge pour les contours), puis étiré en ellipse par un motif.
 */
function ellipticalPattern(ctx: Ctx, paint: RadialPaint, w: number, h: number): CanvasPattern | null {
  const f = radialFrame(paint, w, h);
  const m = ellipseMatrix(f);
  const inv = m.inverse();
  // Zone à couvrir, ramenée dans le repère du cercle.
  const pad = Math.max(w, h) * 0.5 + 4;
  let k = f.r * 1.01;
  for (const [x, y] of [
    [-pad, -pad],
    [w + pad, -pad],
    [w + pad, h + pad],
    [-pad, h + pad],
  ]) {
    const q = inv.transformPoint(new DOMPoint(x, y));
    k = Math.max(k, Math.abs(q.x), Math.abs(q.y));
  }
  const t = ctx.getTransform();
  const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
  const n = Math.max(16, Math.min(1024, Math.ceil(2 * k * scale * Math.max(1, f.ratio))));
  const key = `${w}|${h}|${n}|${k}`;
  let hit = Object.isFrozen(paint) ? ellipseCache.get(paint) : undefined;
  if (!hit || hit.key !== key) {
    const tile = makeCanvas(n, n);
    const px = n / (2 * k);
    tile.ctx.fillStyle = radialStops(
      tile.ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, f.r * px),
      paint,
    );
    tile.ctx.fillRect(0, 0, n, n);
    hit = { key, canvas: tile.canvas };
    if (Object.isFrozen(paint)) ellipseCache.set(paint, hit);
  }
  const pat = ctx.createPattern(hit.canvas as CanvasImageSource, 'no-repeat');
  if (!pat) return null;
  pat.setTransform(m.translate(-k, -k).scale((2 * k) / n));
  return pat;
}

/**
 * Peint toute la zone visible avec une peinture exprimée dans le repère courant (boîte w × h) :
 * sert au masque de transparence, qui doit couvrir l'objet et ses effets. Les dégradés
 * elliptiques y sont exacts (repère étiré au lieu d'une image).
 */
export function fillEverywhere(ctx: AnyCtx, paint: Paint, w: number, h: number): void {
  if (paint.type === 'radial' && isElliptical(paint)) {
    const f = radialFrame(paint, w, h);
    const e = ellipseMatrix(f);
    ctx.transform(e.a, e.b, e.c, e.d, e.e, e.f);
    ctx.fillStyle = radialStops(ctx.createRadialGradient(0, 0, 0, 0, 0, f.r), paint);
  } else {
    const style = canvasPaint(ctx, paint, w, h);
    if (!style) return;
    ctx.fillStyle = style;
  }
  // Coins de la toile ramenés dans le repère courant : le rectangle les couvre tous.
  const inv = ctx.getTransform().inverse();
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const pts = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ].map(([x, y]) => inv.transformPoint(new DOMPoint(x, y)));
  const x0 = Math.min(...pts.map((p) => p.x)),
    y0 = Math.min(...pts.map((p) => p.y));
  const x1 = Math.max(...pts.map((p) => p.x)),
    y1 = Math.max(...pts.map((p) => p.y));
  ctx.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
}

/** Dégradé conique dessiné en secteurs, pour les navigateurs sans `createConicGradient`. */
function conicFallback(
  ctx: Ctx,
  paint: Extract<Paint, { type: 'conic' }>,
  w: number,
  h: number,
): CanvasPattern | null {
  const size = Math.max(1, Math.ceil(Math.max(w, h)));
  const tile = makeCanvas(size, size);
  const cx = paint.cx * w,
    cy = paint.cy * h;
  const r = Math.hypot(w, h);
  const steps = 90;
  for (let i = 0; i < steps; i++) {
    const a0 = ((paint.angle + (i * 360) / steps) * Math.PI) / 180;
    const a1 = ((paint.angle + ((i + 1.02) * 360) / steps) * Math.PI) / 180;
    tile.ctx.beginPath();
    tile.ctx.moveTo(cx, cy);
    tile.ctx.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    tile.ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    tile.ctx.closePath();
    tile.ctx.fillStyle = rgbaToCss(sampleStops(paint.stops, (i + 0.5) / steps));
    tile.ctx.fill();
  }
  return ctx.createPattern(tile.canvas as CanvasImageSource, 'no-repeat');
}
