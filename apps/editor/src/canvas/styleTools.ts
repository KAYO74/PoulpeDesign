import {
  applyOffset,
  findNode,
  flattenCommands,
  isStyled,
  opaque,
  removeNodes,
  topLevelIds,
  worldOutline,
  type GradientStop,
  type Paint,
  type PoulpeDocument,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import { t } from '../i18n';
import { editor, ui, type ToolId } from '../store';
import type { CanvasController } from './controller';

/*
 * Outils qui changent le style des objets sélectionnés en glissant sur le document, comme dans
 * Affinity : Remplissage (dégradé), Transparence (dégradé vers le transparent), Contour (décalage
 * du tracé) et Largeur de trait (profil d'épaisseur). Chaque geste s'annule en une fois.
 */

type StyleTool = 'gradient' | 'transparency' | 'contour' | 'strokeWidth';
const STYLE_TOOLS: ToolId[] = ['gradient', 'transparency', 'contour', 'strokeWidth'];

/** Nombre de points du profil d'épaisseur réglé par l'outil Largeur de trait. */
const PROFILE_POINTS = 11;

interface Drag {
  tool: StyleTool;
  ids: string[];
  a: Vec;
  b: Vec;
  startScreen: Vec;
  moved: boolean;
  /** Contour : distance de décalage en cours (unités du document). */
  distance?: number;
  /** Largeur de trait : objet, point du profil et largeur choisie. */
  width?: { id: string; index: number; at: Vec; value: number };
}

function firstColor(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if ('stops' in p && p.stops.length) return p.stops[0].color;
  return '#000000';
}

/** Objets stylés de la sélection (dans les groupes aussi). */
function styledIn(doc: PoulpeDocument, ids: string[]): SceneNode[] {
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

/** Point le plus proche sur le trait d'un objet : position (0 à 1 le long du tracé) et distance. */
function nearestOnStroke(n: SceneNode, p: Vec): { t: number; at: Vec; dist: number } | null {
  const outline = worldOutline(n);
  if (!outline?.length) return null;
  let best: { t: number; at: Vec; dist: number } | null = null;
  for (const sub of flattenCommands(outline, 0.5)) {
    const pts = sub.closed ? [...sub.points, sub.points[0]] : sub.points;
    const lens = [0];
    for (let i = 1; i < pts.length; i++)
      lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = lens[lens.length - 1] || 1;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const at = { x: a.x + dx * k, y: a.y + dy * k };
      const dist = Math.hypot(p.x - at.x, p.y - at.y);
      if (!best || dist < best.dist) best = { t: (lens[i - 1] + Math.sqrt(l2) * k) / total, at, dist };
    }
  }
  return best;
}

export class StyleTools {
  private drag: Drag | null = null;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.drag;
  }

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    const tool = ui.get().tool;
    if (!STYLE_TOOLS.includes(tool)) return false;
    // Clic sur un objet non sélectionné : on le sélectionne d'abord (comme dans Affinity).
    const hit = this.c.hitTest(p, false);
    if (hit && !editor.selection.includes(hit.id)) editor.select([hit.id]);
    const ids = topLevelIds(editor.doc, editor.selection);
    if (!ids.length) return true;
    let width: Drag['width'];
    if (tool === 'strokeWidth') {
      const target = styledIn(editor.doc, ids).find((n) => isStyled(n) && n.stroke.paint.type !== 'none');
      const near = target && nearestOnStroke(target, p);
      if (!target || !near) return true;
      width = {
        id: target.id,
        index: Math.round(near.t * (PROFILE_POINTS - 1)),
        at: near.at,
        value: 1,
      };
    }
    editor.begin();
    this.drag = { tool: tool as StyleTool, ids, a: p, b: p, startScreen: s, moved: false, width };
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    const g = this.drag;
    if (!g) return false;
    if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return true;
    g.moved = true;
    g.b = p;
    if (e.shiftKey && (g.tool === 'gradient' || g.tool === 'transparency')) {
      // Maj : angle par pas de 45°.
      const ang = Math.round(Math.atan2(p.y - g.a.y, p.x - g.a.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(p.x - g.a.x, p.y - g.a.y);
      g.b = { x: g.a.x + Math.cos(ang) * len, y: g.a.y + Math.sin(ang) * len };
    }
    if (g.tool === 'gradient' || g.tool === 'transparency') this.previewGradient(g);
    else if (g.tool === 'contour') this.previewContour(g, e.altKey);
    else this.previewWidth(g);
    this.c.requestDraw();
    return true;
  }

  pointerUp(): boolean {
    const g = this.drag;
    if (!g) return false;
    this.drag = null;
    if (!g.moved) editor.cancel();
    else editor.commit(g.tool === 'contour' ? 'history.offset' : 'history.style');
    this.c.requestDraw();
    return true;
  }

  cancel(): void {
    if (this.drag) editor.cancel();
    this.drag = null;
  }

  private previewGradient(g: Drag): void {
    const angle = (Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x) * 180) / Math.PI;
    const transparency = g.tool === 'transparency';
    editor.preview((d) => {
      for (const n of styledIn(d, g.ids)) {
        if (!isStyled(n)) continue;
        const fill = n.fill;
        let stops: GradientStop[];
        if (transparency) {
          // Transparence : la couleur du remplissage s'efface jusqu'au transparent.
          const c = opaque(firstColor(fill));
          stops = [
            { offset: 0, color: c },
            { offset: 1, color: `${c}00` },
          ];
        } else if ('stops' in fill && fill.stops.length >= 2) stops = fill.stops;
        else
          stops = [
            { offset: 0, color: firstColor(fill) },
            { offset: 1, color: '#ffffff' },
          ];
        n.fill = { type: 'linear', stops, angle: Math.round(angle * 10) / 10 };
      }
    });
  }

  private previewContour(g: Drag, keep: boolean): void {
    // Glisser vers la droite agrandit le contour, vers la gauche le rétrécit.
    const distance = Math.round((g.b.x - g.a.x) * 10) / 10;
    g.distance = distance;
    if (!distance) return editor.preview(() => undefined);
    editor.preview((d) => {
      const out: string[] = [];
      for (const id of g.ids) {
        const r = applyOffset(d, id, distance, 'round', t('name.curve'));
        if (!r) continue;
        out.push(r);
        // Sans Alt, le contour remplace l'objet ; avec Alt, l'original reste (copie).
        if (!keep) removeNodes(d, [id]);
      }
      return out.length ? out : undefined;
    });
  }

  private previewWidth(g: Drag): void {
    const w = g.width!;
    const base = findNode(editor.getState().doc, w.id)?.node;
    if (!base || !isStyled(base)) return;
    // L'écart entre le pointeur et le point du trait donne la demi-épaisseur voulue.
    const half = Math.max(0.0001, base.stroke.width / 2);
    const dist = Math.hypot(g.b.x - w.at.x, g.b.y - w.at.y);
    w.value = Math.min(20, Math.max(0, dist / half));
    editor.preview((d) => {
      const n = findNode(d, w.id)?.node;
      if (!n || !isStyled(n)) return;
      const old = n.stroke.profile;
      const profile = Array.from({ length: PROFILE_POINTS }, (_, i) =>
        old && old.length >= 2 ? old[Math.round((i / (PROFILE_POINTS - 1)) * (old.length - 1))] : 1,
      );
      profile[w.index] = Math.round(w.value * 100) / 100;
      n.stroke = { ...n.stroke, profile };
    });
  }

  // ————— Dessin (repère de l'écran) —————

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    const g = this.drag;
    if (!g?.moved) return;
    const a = this.c.toScreen(g.tool === 'strokeWidth' ? g.width!.at : g.a),
      b = this.c.toScreen(g.b);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1;
    if (g.tool !== 'contour') {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      for (const q of [a, b]) {
        ctx.fillRect(q.x - 3.5, q.y - 3.5, 7, 7);
        ctx.strokeRect(q.x - 3.5, q.y - 3.5, 7, 7);
      }
    }
    // Valeur en cours, à côté du pointeur.
    const label =
      g.tool === 'contour'
        ? `${g.distance ?? 0} px`
        : g.tool === 'strokeWidth'
          ? `× ${(g.width!.value ?? 1).toFixed(2)}`
          : `${Math.round((Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x) * 180) / Math.PI)}°`;
    ctx.font = '11px system-ui, sans-serif';
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = color;
    ctx.fillRect(b.x + 12, b.y + 12, w, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, b.x + 17, b.y + 25);
    ctx.restore();
  }
}
