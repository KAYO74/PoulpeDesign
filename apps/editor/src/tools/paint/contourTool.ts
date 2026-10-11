import {
  applyOffset,
  baseShapePath,
  cloneWithNewIds,
  findNode,
  isClosedPath,
  removeNodes,
  topLevelIds,
  type Contour,
  type PoulpeDocument,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import { t } from '../../i18n';
import { editor, ui } from '../../store';
import type { CanvasController } from '../../canvas/controller';
import { paintStore } from './state';

/*
 * Outil Contour [O], comme dans Affinity : glisser vers la droite agrandit les formes, vers la
 * gauche les rétrécit. Le contour reste un réglage de l'objet (rayon, jonction, limite d'angle),
 * modifiable ensuite dans la barre de l'outil ; « Convertir en courbes » l'applique. Les lignes et
 * les tracés ouverts, qui n'ont pas d'intérieur, sont décalés pour de bon comme avant.
 */

/** Formes fermées d'un objet (lui-même, ou celles d'un groupe), qui peuvent porter un contour. */
export function closedShapesIn(n: SceneNode): SceneNode[] {
  if (n.locked) return [];
  if (n.type === 'group') return n.children.flatMap(closedShapesIn);
  if (n.type === 'rect' || n.type === 'ellipse' || n.type === 'polygon' || n.type === 'star') return [n];
  if (n.type === 'path' && isClosedPath(baseShapePath(n))) return [n];
  return [];
}

/** Formes fermées de la sélection. */
export function selectedShapes(doc: PoulpeDocument): SceneNode[] {
  return topLevelIds(doc, editor.selection).flatMap((id) => {
    const n = findNode(doc, id)?.node;
    return n ? closedShapesIn(n) : [];
  });
}

/** Contour d'une forme fermée (dans un brouillon) ; une distance nulle le retire. */
export function setContour(n: SceneNode, c: Contour | null): void {
  if (
    n.type !== 'rect' &&
    n.type !== 'ellipse' &&
    n.type !== 'polygon' &&
    n.type !== 'star' &&
    n.type !== 'path'
  )
    return;
  if (!c || Math.abs(c.radius) < 0.05) delete n.contour;
  else n.contour = c;
}

const round = (v: number) => Math.round(v * 10) / 10;

interface Drag {
  ids: string[];
  start: Vec;
  startScreen: Vec;
  moved: boolean;
  distance: number;
  /** Rayon obtenu sur le premier objet, affiché près du pointeur. */
  radius: number | null;
}

export class ContourTool {
  private drag: Drag | null = null;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.drag;
  }

  private active(): boolean {
    const s = ui.get();
    return s.tool === 'contour' && s.persona !== 'photo';
  }

  pointerDown(_e: PointerEvent, p: Vec, s: Vec): boolean {
    if (!this.active()) return false;
    // Clic sur un objet non sélectionné : il est sélectionné d'abord.
    const hit = this.c.hitTest(p, false);
    if (hit && !editor.selection.includes(hit.id)) editor.select([hit.id]);
    const ids = topLevelIds(editor.doc, editor.selection);
    if (!ids.length) return true;
    editor.begin();
    this.drag = { ids, start: p, startScreen: s, moved: false, distance: 0, radius: null };
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    const g = this.drag;
    if (!g) return false;
    if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return true;
    g.moved = true;
    // Glisser vers la droite agrandit le contour, vers la gauche le rétrécit.
    g.distance = round(p.x - g.start.x);
    this.preview(g, e.altKey);
    this.c.requestDraw();
    return true;
  }

  pointerUp(): boolean {
    const g = this.drag;
    if (!g) return false;
    this.drag = null;
    if (!g.moved) editor.cancel();
    else editor.commit('history.contour');
    this.c.requestDraw();
    return true;
  }

  cancel(): void {
    if (this.drag) editor.cancel();
    this.drag = null;
  }

  private preview(g: Drag, keep: boolean): void {
    const d0 = g.distance;
    const defaults = paintStore.get().contour;
    g.radius = null;
    editor.preview((d) => {
      const out: string[] = [];
      for (const id of g.ids) {
        const loc = findNode(d, id);
        if (!loc || loc.node.locked) continue;
        if (!closedShapesIn(loc.node).length) {
          // Ligne ou tracé ouvert : un nouveau tracé autour du trait ; Alt garde l'original.
          if (!d0) continue;
          const r = applyOffset(d, id, d0, defaults.join, t('name.curve'));
          if (!r) continue;
          out.push(r);
          if (!keep) removeNodes(d, [id]);
          continue;
        }
        let target = loc.node;
        if (keep) {
          // Alt : l'original reste, le contour va sur une copie posée au-dessus.
          target = cloneWithNewIds(loc.node);
          loc.parent.children.splice(loc.index + 1, 0, target);
        }
        out.push(target.id);
        for (const m of closedShapesIn(target)) {
          const old = 'contour' in m ? m.contour : undefined;
          const radius = round((old?.radius ?? 0) + d0);
          g.radius ??= radius;
          setContour(m, {
            radius,
            join: old?.join ?? defaults.join,
            miterLimit: old?.miterLimit ?? defaults.miterLimit,
          });
        }
      }
      return out.length ? out : undefined;
    });
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    const g = this.drag;
    if (!g?.moved) return;
    const b = this.c.toScreen({ x: g.start.x + g.distance, y: g.start.y });
    const label = `${g.radius ?? g.distance} px`;
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = color;
    ctx.fillRect(b.x + 12, b.y + 12, w, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, b.x + 17, b.y + 25);
    ctx.restore();
  }
}
