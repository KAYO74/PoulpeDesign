import {
  artboardAt,
  findArtboard,
  fromSubpaths,
  setPathCommands,
  smartMarks,
  type Artboard,
  type Paint,
  type PathCommand,
  type PathNode,
  type Stroke,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { editor, ui } from '../../store';

/* Outils partagés par la plume, le crayon, le pinceau vectoriel, le cutter et le constructeur de formes. */

/** Distance de prise d'un nœud, en pixels d'écran. */
export const HIT = 7;

/** Un geste d'outil sur le canevas (voir `ToolDelegate`). */
export interface SubTool {
  readonly busy: boolean;
  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean;
  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean;
  pointerUp(e: PointerEvent, p: Vec, s: Vec): boolean;
  cancel(): void;
  key?(e: KeyboardEvent): boolean;
  draw(ctx: CanvasRenderingContext2D, color: string): void;
}

/** Distance entre deux points du monde, en pixels d'écran. */
export function screenDist(c: CanvasController, a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * c.view.zoom;
}

export function constrain45(from: Vec, p: Vec): Vec {
  const dx = p.x - from.x,
    dy = p.y - from.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy) * Math.cos(Math.atan2(dy, dx) - ang);
  return { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
}

/** Plan de travail sous le point, ou le plan actif. Il devient le plan actif. */
export function pickArtboard(p: Vec): Artboard | null {
  const doc = editor.doc;
  const ab = artboardAt(doc, p) ?? findArtboard(doc, editor.getState().activeArtboardId);
  if (ab) editor.setActiveArtboard(ab.id);
  return ab;
}

/** Contour visible pour les tracés dessinés : celui des réglages, ou un trait sombre de 2 px. */
export function drawnStroke(): Stroke {
  const s = ui.get().defaults.stroke;
  return s.paint.type === 'none'
    ? { paint: { type: 'solid', color: '#1a1a1d' }, width: 2 }
    : { ...s, width: Math.max(0.5, s.width) };
}

/** Couleur de contour courante (pinceau vectoriel) : celle des réglages, ou un gris sombre. */
export function strokePaint(): Paint {
  const p = ui.get().defaults.stroke.paint;
  return p.type === 'none' ? { type: 'solid', color: '#1a1a1d' } : structuredClone(p);
}

/**
 * Le pointeur donne une vraie pression : un stylet, ou des valeurs qui varient (une souris donne
 * toujours 0,5 bouton enfoncé, parfois 0).
 */
export function realPressure(pen: boolean, pressures: number[]): boolean {
  return pen || pressures.some((v) => v > 0 && Math.abs(v - 0.5) > 1e-3);
}

/** Couleur CSS approchée d'une peinture, pour les aperçus pendant le geste. */
export function paintCss(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if ('stops' in p && p.stops.length) return p.stops[0].color;
  return '#808080';
}

/** Écrit des sous-tracés dans un tracé (brouillon), avec ses nœuds intelligents. */
export function writeSubpaths(n: PathNode, sps: SubPath[]): void {
  setPathCommands(n, fromSubpaths(sps));
  const marks = smartMarks(sps);
  if (marks.length) n.smartNodes = marks;
  else delete n.smartNodes;
}

/** Trace des commandes du monde sur le calque d'interface (en pixels d'écran). */
export function traceCommands(ctx: CanvasRenderingContext2D, c: CanvasController, cmds: PathCommand[]): void {
  const S = (x: number, y: number) => c.toScreen({ x, y });
  ctx.beginPath();
  for (const k of cmds) {
    if (k.op === 'M') {
      const q = S(k.x, k.y);
      ctx.moveTo(q.x, q.y);
    } else if (k.op === 'L') {
      const q = S(k.x, k.y);
      ctx.lineTo(q.x, q.y);
    } else if (k.op === 'C') {
      const a = S(k.x1, k.y1),
        b = S(k.x2, k.y2),
        q = S(k.x, k.y);
      ctx.bezierCurveTo(a.x, a.y, b.x, b.y, q.x, q.y);
    } else ctx.closePath();
  }
}

/** Ligne brisée du monde sur le calque d'interface. */
export function tracePolyline(ctx: CanvasRenderingContext2D, c: CanvasController, pts: Vec[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = c.toScreen(p);
    if (i) ctx.lineTo(q.x, q.y);
    else ctx.moveTo(q.x, q.y);
  });
}

/** Objets rencontrés le long d'une ligne brisée (monde), du premier au dernier, sans doublon. */
export function alongPolyline(c: CanvasController, pts: Vec[]): string[] {
  const seen = new Set<string>();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)],
      b = pts[i];
    const steps = Math.max(1, Math.ceil(screenDist(c, a, b) / 3));
    for (let k = i ? 1 : 0; k <= steps; k++) {
      const q = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      const hit = c.hitTest(q, false);
      if (hit && !hit.locked) seen.add(hit.id);
    }
  }
  return [...seen];
}
