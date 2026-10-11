import {
  ellipseRatio,
  findNode,
  gradientHandles,
  isGradient,
  isStyled,
  localToWorld,
  newGradient,
  rgbaToCss,
  sampleOpacity,
  sampleStops,
  topLevelIds,
  transparencyFrame,
  withHandles,
  worldToLocal,
  type HandlePaint,
  type Paint,
  type PoulpeDocument,
  type SceneNode,
  type Transparency,
  type Vec,
} from '@poulpe/core';
import { editor, ui } from '../../store';
import type { CanvasController } from '../../canvas/controller';
import { paintStore } from './state';

/*
 * Outils Remplissage [G] et Transparence [Y], comme dans Affinity : glisser sur l'objet trace le
 * dégradé ; ensuite, tant que l'outil est actif, la ligne du dégradé reste affichée sur l'objet
 * sélectionné avec ses poignées et ses arrêts, qui se déplacent, s'ajoutent et se retirent.
 * Chaque geste s'annule en une fois.
 */

export type GradientMode = 'fill' | 'transparency';
type Frame = { x: number; y: number; width: number; height: number; rotation: number };

/** Rayon de prise des poignées et des arrêts, et distance de prise de la ligne (pixels d'écran). */
const GRAB = 8;
const LINE_GRAB = 5;
/** Un arrêt tiré plus loin que cela de la ligne est retiré. */
const OFF_LINE = 40;

const modeOf = (): GradientMode | null => {
  const s = ui.get();
  if (s.persona === 'photo') return null;
  return s.tool === 'gradient' ? 'fill' : s.tool === 'transparency' ? 'transparency' : null;
};

/** Boîte où s'exprime la peinture : celle de l'objet, ou de son contenu pour la transparence d'un groupe. */
export function frameOf(n: SceneNode, mode: GradientMode): Frame {
  return mode === 'transparency'
    ? transparencyFrame(n)
    : { x: n.x, y: n.y, width: n.width, height: n.height, rotation: n.rotation };
}

/** Peinture que l'outil modifie : remplissage ou contour (selon la cible), ou la transparence. */
export function editedPaint(n: SceneNode, mode: GradientMode): HandlePaint | null {
  if (mode === 'transparency') return n.transparency ?? null;
  if (!isStyled(n)) return null;
  const p = ui.get().colorTarget === 'fill' ? n.fill : n.stroke.paint;
  return isGradient(p) || p.type === 'pattern' ? p : null;
}

/** Remplace la peinture modifiée (dans un brouillon). */
export function writePaint(n: SceneNode, mode: GradientMode, p: HandlePaint | Paint | null): void {
  if (mode === 'transparency') {
    if (p && (p.type === 'linear' || p.type === 'radial' || p.type === 'conic'))
      n.transparency = p as Transparency;
    else delete n.transparency;
    return;
  }
  if (!isStyled(n) || !p) return;
  if (ui.get().colorTarget === 'fill') n.fill = p as Paint;
  else n.stroke = { ...n.stroke, paint: p as Paint };
}

/** Largeur de l'image d'un motif, qui sert d'unité à sa poignée. */
export function tileOf(doc: PoulpeDocument, p: HandlePaint): number {
  return p.type === 'pattern' ? (doc.assets[p.assetId]?.width ?? 100) : 100;
}

/** Objets stylés de la sélection (dans les groupes aussi). */
export function styledIn(doc: PoulpeDocument, ids: string[]): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (n: SceneNode) => {
    if (n.type === 'group') n.children.forEach(visit);
    else if (isStyled(n) && !n.locked) out.push(n);
  };
  for (const id of ids) {
    const n = findNode(doc, id)?.node;
    if (n) visit(n);
  }
  return out;
}

/** Objets que touche un geste : les objets stylés pour le remplissage, les objets entiers pour la transparence. */
function targetsIn(doc: PoulpeDocument, ids: string[], mode: GradientMode): SceneNode[] {
  if (mode === 'fill') return styledIn(doc, ids);
  return topLevelIds(doc, ids)
    .map((id) => findNode(doc, id)?.node)
    .filter((n): n is SceneNode => !!n && !n.locked && n.type !== 'adjustment');
}

/** Objet dont la ligne de dégradé est affichée : le seul objet sélectionné, s'il a un dégradé. */
export function gradientTarget(
  mode: GradientMode,
): { node: SceneNode; paint: HandlePaint; frame: Frame; tile: number } | null {
  const sel = editor.selection;
  if (sel.length !== 1) return null;
  const node = findNode(editor.doc, sel[0])?.node;
  if (!node || node.locked || !node.visible) return null;
  const paint = editedPaint(node, mode);
  if (!paint) return null;
  return { node, paint, frame: frameOf(node, mode), tile: tileOf(editor.doc, paint) };
}

function firstColor(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if (isGradient(p) && p.stops.length) return p.stops[0].color;
  return '#000000';
}

/** Angle par pas de 45° (Maj). */
function constrain(a: Vec, b: Vec): Vec {
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

type Part = 'a' | 'b' | 'c' | 'stop' | 'line';

interface Drag {
  part: Part | 'create';
  mode: GradientMode;
  ids: string[];
  start: Vec;
  current: Vec;
  startScreen: Vec;
  moved: boolean;
  /** Le document a changé dès l'appui (arrêt ajouté sur la ligne). */
  changed?: boolean;
  /** Peinture au début du geste. */
  base?: HandlePaint;
  stop?: number;
  /** L'arrêt glissé est sorti de la ligne : il sera retiré. */
  off?: boolean;
}

export class GradientTool {
  private drag: Drag | null = null;
  private hover: Part | null = null;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.drag;
  }

  /** Poignées du dégradé affiché, en pixels d'écran. */
  private screenHandles(t: NonNullable<ReturnType<typeof gradientTarget>>): { a: Vec; b: Vec; c?: Vec } {
    const h = gradientHandles(t.paint, t.frame.width, t.frame.height, t.tile);
    const S = (p: Vec) => this.c.toScreen(localToWorld(t.frame, p));
    return { a: S(h.a), b: S(h.b), c: h.c && S(h.c) };
  }

  /** Partie du dégradé affiché sous le pointeur (pixels d'écran). */
  private partAt(mode: GradientMode, s: Vec): { part: Part; stop?: number; t?: number } | null {
    const tg = gradientTarget(mode);
    if (!tg) return null;
    const { a, b, c } = this.screenHandles(tg);
    const near = (q: Vec) => Math.hypot(q.x - s.x, q.y - s.y) <= GRAB;
    if (c && near(c)) return { part: 'c' };
    const stops = 'stops' in tg.paint ? (tg.paint.stops as { offset: number }[]) : [];
    const at = (o: number) => ({ x: a.x + (b.x - a.x) * o, y: a.y + (b.y - a.y) * o });
    // Arrêts du milieu d'abord : ceux des bouts sont sous les poignées.
    let best = -1;
    let bestD = GRAB;
    stops.forEach((st, i) => {
      if (st.offset < 0.001 || st.offset > 0.999) return;
      const q = at(st.offset);
      const d = Math.hypot(q.x - s.x, q.y - s.y);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) return { part: 'stop', stop: best };
    if (near(b)) return { part: 'b' };
    if (near(a)) return { part: 'a' };
    if (!stops.length) return null;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1) return null;
    const t = Math.max(0, Math.min(1, ((s.x - a.x) * dx + (s.y - a.y) * dy) / l2));
    const q = at(t);
    return Math.hypot(q.x - s.x, q.y - s.y) <= LINE_GRAB ? { part: 'line', t } : null;
  }

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    const mode = modeOf();
    if (!mode) return false;
    const hit = this.partAt(mode, s);
    const tg = gradientTarget(mode);
    if (hit && tg) {
      const base = tg.paint;
      const stops = 'stops' in base ? (base.stops as { offset: number }[]) : [];
      let stop = hit.stop;
      if (hit.part === 'a' || hit.part === 'b') {
        // La poignée de début ou de fin choisit aussi l'arrêt qui s'y trouve.
        const want = hit.part === 'a' ? 0 : 1;
        let best = -1;
        stops.forEach((st, i) => {
          if (Math.abs(st.offset - want) < 0.001 && best < 0) best = i;
        });
        if (best >= 0) paintStore.set({ stop: best });
      }
      editor.begin();
      let current = base;
      let changed = false;
      if (hit.part === 'line') {
        // Clic sur la ligne : un nouvel arrêt, de la couleur (ou l'opacité) du dégradé à cet endroit.
        const t = Math.round(hit.t! * 1000) / 1000;
        current = addStop(base, t);
        stop = stops.length;
        changed = true;
        editor.preview((d) => {
          const n = findNode(d, tg.node.id)?.node;
          if (n) writePaint(n, mode, current);
        });
      }
      if (stop !== undefined) paintStore.set({ stop });
      this.drag = {
        part: hit.part === 'line' ? 'stop' : hit.part,
        mode,
        ids: [tg.node.id],
        start: p,
        current: p,
        startScreen: s,
        moved: false,
        changed,
        base: current,
        stop,
      };
      return true;
    }
    // Clic sur un objet non sélectionné : il est sélectionné d'abord (comme dans Affinity).
    const under = this.c.hitTest(p, false);
    if (under && !editor.selection.includes(under.id)) editor.select([under.id]);
    const ids = topLevelIds(editor.doc, editor.selection);
    if (!ids.length) return true;
    editor.begin();
    this.drag = { part: 'create', mode, ids, start: p, current: p, startScreen: s, moved: false };
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    const g = this.drag;
    if (!g) {
      this.updateHover(s);
      return false;
    }
    if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return true;
    g.moved = true;
    g.current = p;
    if (g.part === 'create') this.previewCreate(g, e.shiftKey);
    else if (g.part === 'stop') this.previewStop(g, s);
    else this.previewHandle(g, p, e.shiftKey);
    this.c.requestDraw();
    return true;
  }

  pointerUp(_e: PointerEvent, p: Vec): boolean {
    const g = this.drag;
    if (!g) return false;
    this.drag = null;
    if (!g.moved && !g.changed) {
      editor.cancel();
      // Clic dans le vide : la sélection s'en va.
      if (g.part === 'create' && !this.c.hitTest(p, false)) editor.select([]);
    } else {
      if (g.part === 'stop' && g.off) paintStore.set({ stop: Math.max(0, (g.stop ?? 0) - 1) });
      editor.commit(
        g.part === 'stop'
          ? 'history.gradientStop'
          : g.mode === 'transparency'
            ? 'history.transparency'
            : 'history.gradient',
      );
    }
    this.c.requestDraw();
    return true;
  }

  cancel(): void {
    if (this.drag) editor.cancel();
    this.drag = null;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeOf();
    if (!mode || (e.key !== 'Delete' && e.key !== 'Backspace') || e.altKey) return false;
    const tg = gradientTarget(mode);
    if (!tg || !('stops' in tg.paint)) return false;
    // Suppr retire l'arrêt choisi (il en reste toujours deux).
    const stops = tg.paint.stops as { offset: number }[];
    const i = Math.min(paintStore.get().stop, stops.length - 1);
    if (stops.length > 2) {
      const next = { ...tg.paint, stops: stops.filter((_, j) => j !== i) } as HandlePaint;
      editor.apply('history.gradientStop', (d) => {
        const n = findNode(d, tg.node.id)?.node;
        if (n) writePaint(n, mode, next);
      });
      paintStore.set({ stop: Math.max(0, i - 1) });
    }
    return true;
  }

  // ————— Aperçus —————

  private previewCreate(g: Drag, shift: boolean): void {
    const b = shift ? constrain(g.start, g.current) : g.current;
    g.current = b;
    const kind = paintStore.get();
    editor.preview((d) => {
      for (const n of targetsIn(d, g.ids, g.mode)) {
        const f = frameOf(n, g.mode);
        const la = worldToLocal(f, g.start),
          lb = worldToLocal(f, b);
        const current = editedPaint(n, g.mode);
        let base: HandlePaint;
        if (current) base = current;
        else if (g.mode === 'transparency')
          base = newGradient(
            kind.transKind,
            [
              { offset: 0, opacity: 1 },
              { offset: 1, opacity: 0 },
            ],
            f.width,
            f.height,
          ) as unknown as HandlePaint;
        else {
          // Premier dégradé de l'objet : de sa couleur vers le blanc, du type choisi dans la barre.
          const k = kind.fillKind;
          const own = isStyled(n) ? (ui.get().colorTarget === 'fill' ? n.fill : n.stroke.paint) : null;
          base = newGradient(
            k === 'radial' || k === 'elliptical' || k === 'conic' ? k : 'linear',
            [
              { offset: 0, color: own ? firstColor(own) : '#000000' },
              { offset: 1, color: '#ffffff' },
            ],
            f.width,
            f.height,
          ) as unknown as HandlePaint;
        }
        writePaint(n, g.mode, withHandles(base, f.width, f.height, la, lb, tileOf(d, base)));
      }
    });
  }

  private previewHandle(g: Drag, p: Vec, shift: boolean): void {
    const base = g.base!;
    editor.preview((d) => {
      const n = findNode(d, g.ids[0])?.node;
      if (!n) return;
      const f = frameOf(n, g.mode);
      const tile = tileOf(d, base);
      const h = gradientHandles(base, f.width, f.height, tile);
      const q = worldToLocal(f, p);
      let next: HandlePaint;
      if (g.part === 'c')
        next = {
          ...base,
          ratio: ellipseRatio(base as { cx: number; cy: number; r: number }, f.width, f.height, q),
        } as HandlePaint;
      else if (g.part === 'b')
        next = withHandles(base, f.width, f.height, h.a, shift ? constrain(h.a, q) : q, tile);
      else if (base.type === 'linear')
        next = withHandles(base, f.width, f.height, shift ? constrain(h.b, q) : q, h.b, tile);
      else {
        // Le centre d'un radial, d'un conique ou d'un motif emmène tout le dégradé.
        const dx = q.x - h.a.x,
          dy = q.y - h.a.y;
        next = withHandles(base, f.width, f.height, q, { x: h.b.x + dx, y: h.b.y + dy }, tile);
      }
      writePaint(n, g.mode, next);
    });
  }

  private previewStop(g: Drag, s: Vec): void {
    const tg = gradientTarget(g.mode);
    if (!tg || g.stop === undefined) return;
    const base = g.base!;
    const stops = (base as { stops: { offset: number }[] }).stops;
    // La ligne vient de la géométrie de départ (elle ne bouge pas pendant le geste).
    const h = gradientHandles(base, tg.frame.width, tg.frame.height, tg.tile);
    const S = (q: Vec) => this.c.toScreen(localToWorld(tg.frame, q));
    const a = S(h.a),
      b = S(h.b);
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((s.x - a.x) * dx + (s.y - a.y) * dy) / l2));
    const dist = Math.abs((s.x - a.x) * dy - (s.y - a.y) * dx) / Math.sqrt(l2);
    g.off = stops.length > 2 && dist > OFF_LINE;
    const i = g.stop;
    const next = {
      ...base,
      stops: g.off
        ? stops.filter((_, j) => j !== i)
        : stops.map((st, j) => (j === i ? { ...st, offset: Math.round(t * 1000) / 1000 } : st)),
    } as HandlePaint;
    editor.preview((d) => {
      const n = findNode(d, g.ids[0])?.node;
      if (n) writePaint(n, g.mode, next);
    });
  }

  /** Partie survolée : le curseur l'annonce (voir `cursor`). */
  private updateHover(s: Vec): void {
    const mode = modeOf();
    this.hover = (mode && this.partAt(mode, s)?.part) ?? null;
  }

  cursor(tool: string): string | null {
    if ((tool !== 'gradient' && tool !== 'transparency') || !this.hover) return null;
    return this.hover === 'line' ? 'copy' : 'move';
  }

  // ————— Dessin (repère de l'écran) —————

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    const mode = modeOf();
    if (!mode) return;
    const g = this.drag;
    ctx.save();
    ctx.lineWidth = 1;
    if (g?.part === 'create') {
      if (g.moved) {
        const a = this.c.toScreen(g.start),
          b = this.c.toScreen(g.current);
        drawLine(ctx, a, b, color);
        for (const q of [a, b]) square(ctx, q, color);
        const label = `${Math.round((Math.atan2(g.current.y - g.start.y, g.current.x - g.start.x) * 180) / Math.PI)}°`;
        ctx.font = '11px system-ui, sans-serif';
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = color;
        ctx.fillRect(b.x + 12, b.y + 12, w, 18);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, b.x + 17, b.y + 25);
      }
      ctx.restore();
      return;
    }
    const tg = gradientTarget(mode);
    if (!tg) {
      ctx.restore();
      return;
    }
    const { a, b, c } = this.screenHandles(tg);
    const p = tg.paint;
    // Cercle ou ellipse d'un dégradé radial, en pointillés.
    if (p.type === 'radial') {
      const rx = Math.hypot(b.x - a.x, b.y - a.y);
      const ry = c ? Math.hypot(c.x - a.x, c.y - a.y) : rx;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, rx, ry, Math.atan2(b.y - a.y, b.x - a.x), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    drawLine(ctx, a, b, color);
    if (c) {
      drawLine(ctx, a, c, color);
      diamond(ctx, c, color);
    }
    square(ctx, a, color);
    if (p.type !== 'pattern') square(ctx, b, color);
    else circle(ctx, b, 5, '#ffffff', color);
    if ('stops' in p) {
      const sel = paintStore.get().stop;
      (p.stops as ({ offset: number; color?: string; opacity?: number } & object)[]).forEach((st, i) => {
        const q = { x: a.x + (b.x - a.x) * st.offset, y: a.y + (b.y - a.y) * st.offset };
        const fill =
          'color' in st && st.color
            ? rgbaToCss(st.color)
            : `rgb(${Array(3)
                .fill(Math.round(255 * Math.max(0, Math.min(1, st.opacity ?? 1))))
                .join(',')})`;
        const on = i === Math.min(sel, p.stops.length - 1);
        circle(ctx, q, on ? 6.5 : 5, fill, on ? color : '#ffffff', on ? 2.5 : 1.5);
        if (!on) {
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 6.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    ctx.restore();
  }
}

/** Ajoute un arrêt en `t`, de la couleur (ou de l'opacité) du dégradé à cet endroit. */
function addStop(p: HandlePaint, t: number): HandlePaint {
  if (!('stops' in p)) return p;
  const stops = p.stops as { offset: number; color?: string; opacity?: number }[];
  if (stops.length && 'opacity' in stops[0]) {
    const op = sampleOpacity(stops as { offset: number; opacity: number }[], t);
    return { ...p, stops: [...stops, { offset: t, opacity: op }] } as HandlePaint;
  }
  const col = sampleStops(stops as { offset: number; color: string }[], t);
  return { ...p, stops: [...stops, { offset: t, color: col }] } as HandlePaint;
}

function drawLine(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, color: string): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function square(ctx: CanvasRenderingContext2D, q: Vec, color: string): void {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
  ctx.strokeRect(q.x - 4, q.y - 4, 8, 8);
}

function diamond(ctx: CanvasRenderingContext2D, q: Vec, color: string): void {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(q.x, q.y - 5.5);
  ctx.lineTo(q.x + 5.5, q.y);
  ctx.lineTo(q.x, q.y + 5.5);
  ctx.lineTo(q.x - 5.5, q.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function circle(
  ctx: CanvasRenderingContext2D,
  q: Vec,
  r: number,
  fill: string,
  stroke: string,
  lw = 1.5,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
