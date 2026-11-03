import {
  findNode,
  isGradient,
  isStyled,
  localToWorld,
  meshIndex,
  newMesh,
  removeMeshLines,
  splitMeshAt,
  worldToLocal,
  type MeshPaint,
  type Paint,
  type PoulpeDocument,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import { editor, ui } from '../../store';
import type { CanvasController } from '../../canvas/controller';
import { paintStore } from './state';

/*
 * Outil Filet [G, 2e appui] (comme le Remplissage en filet d'Affinity et l'outil Filet
 * d'Illustrator) : un clic dans un objet le remplit d'un filet et y pose un point, en ajoutant
 * une rangée et une colonne. Les points se glissent ; leur couleur se choisit dans la barre de
 * l'outil ou le panneau Couleur ; Suppr retire la rangée et la colonne du point choisi.
 */

/** Rayon de prise des points (pixels d'écran). */
const GRAB = 7;

/** Filet de remplissage de l'objet, s'il en a un. */
export function meshOf(n: SceneNode | null | undefined): MeshPaint | null {
  return n && isStyled(n) && n.fill.type === 'mesh' ? n.fill : null;
}

/** Objet dont l'outil montre le filet : le seul objet sélectionné, s'il est stylé. */
export function meshTarget(): SceneNode | null {
  const sel = editor.selection;
  if (sel.length !== 1) return null;
  const n = findNode(editor.doc, sel[0])?.node;
  return n && isStyled(n) && !n.locked && n.visible && n.type !== 'text' ? n : null;
}

/** Couleur de départ d'un filet : celle du remplissage actuel. */
function baseColor(p: Paint): string {
  if (p.type === 'solid') return p.color;
  if (isGradient(p)) return p.stops[0]?.color ?? '#2ba59a';
  if (p.type === 'hatch') return p.color;
  return '#2ba59a';
}

/** Remplit l'objet (brouillon) avec le filet. */
function writeMesh(d: PoulpeDocument, id: string, m: MeshPaint): void {
  const n = findNode(d, id)?.node;
  if (n && isStyled(n)) n.fill = m;
}

interface Drag {
  id: string;
  index: number;
  mesh: MeshPaint;
  startScreen: Vec;
  moved: boolean;
  /** Le filet ou le point vient d'être créé : le geste compte même sans glisser. */
  added: boolean;
}

export class MeshTool {
  private drag: Drag | null = null;
  private hover = false;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.drag;
  }

  private active(): boolean {
    const s = ui.get();
    return s.tool === 'mesh' && s.persona !== 'photo';
  }

  /** Point du filet sous le pointeur (pixels d'écran). */
  private pointAt(n: SceneNode, m: MeshPaint, s: Vec): number {
    let best = -1,
      dist = GRAB;
    m.points.forEach((q, i) => {
      const e = this.c.toScreen(localToWorld(n, { x: q.x * n.width, y: q.y * n.height }));
      const d = Math.hypot(e.x - s.x, e.y - s.y);
      if (d <= dist) {
        best = i;
        dist = d;
      }
    });
    return best;
  }

  private frac(n: SceneNode, p: Vec): Vec {
    const l = worldToLocal(n, p);
    return { x: l.x / Math.max(1e-9, n.width), y: l.y / Math.max(1e-9, n.height) };
  }

  pointerDown(_e: PointerEvent, p: Vec, s: Vec): boolean {
    if (!this.active()) return false;
    let n = meshTarget();
    let m = meshOf(n);
    if (n && m) {
      const i = this.pointAt(n, m, s);
      if (i >= 0) return this.start(n, m, i, s, false);
    }
    const hit = this.c.hitTest(p, true);
    if (!n || hit?.id !== n.id) {
      editor.select(hit ? [hit.id] : []);
      n = meshTarget();
      m = meshOf(n);
      if (!n) return true;
    }
    if (!isStyled(n)) return true;
    // Un objet sans filet le reçoit, d'une seule case de sa couleur.
    const base = m ?? newMesh(baseColor(n.fill));
    const split = splitMeshAt(base, this.frac(n, p));
    if (!split) {
      if (!m) return this.start(n, base, -1, s, true);
      return true;
    }
    return this.start(n, split.mesh, split.index, s, true);
  }

  private start(n: SceneNode, mesh: MeshPaint, index: number, s: Vec, added: boolean): boolean {
    paintStore.set({ meshPoint: index >= 0 ? index : null });
    ui.set({ colorTarget: 'fill' });
    editor.begin();
    this.drag = { id: n.id, index, mesh, startScreen: s, moved: false, added };
    if (added) editor.preview((d) => writeMesh(d, n.id, mesh));
    this.c.requestDraw();
    return true;
  }

  pointerMove(_e: PointerEvent, p: Vec, s: Vec): boolean {
    const g = this.drag;
    if (!g) {
      this.updateHover(s);
      return false;
    }
    if (g.index < 0) return true;
    if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < 3) return true;
    g.moved = true;
    const n = findNode(editor.getState().doc, g.id)?.node;
    if (!n) return true;
    const f = this.frac(n, p);
    const r = (v: number) => Math.round(v * 10000) / 10000;
    g.mesh = {
      ...g.mesh,
      points: g.mesh.points.map((q, i) => (i === g.index ? { x: r(f.x), y: r(f.y) } : q)),
    };
    const mesh = g.mesh;
    editor.preview((d) => writeMesh(d, g.id, mesh));
    this.c.requestDraw();
    return true;
  }

  pointerUp(): boolean {
    const g = this.drag;
    if (!g) return false;
    this.drag = null;
    if (!g.moved && !g.added) editor.cancel();
    else editor.commit('history.mesh');
    this.c.requestDraw();
    return true;
  }

  cancel(): void {
    if (this.drag) editor.cancel();
    this.drag = null;
  }

  key(e: KeyboardEvent): boolean {
    if (!this.active() || (e.key !== 'Delete' && e.key !== 'Backspace')) return false;
    const n = meshTarget();
    const m = meshOf(n);
    const k = paintStore.get().meshPoint;
    if (!n || !m || k === null || k >= m.points.length) return false;
    const w = m.cols + 1;
    const next = removeMeshLines(m, k % w, Math.floor(k / w));
    if (next === m) return true;
    editor.apply('history.mesh', (d) => writeMesh(d, n.id, next));
    paintStore.set({ meshPoint: null });
    return true;
  }

  private updateHover(s: Vec): void {
    if (!this.active()) return;
    const n = meshTarget();
    const m = meshOf(n);
    const h = !!n && !!m && this.pointAt(n, m, s) >= 0;
    if (h !== this.hover) {
      this.hover = h;
      this.c.requestDraw();
    }
  }

  cursor(tool: string): string | null {
    return tool === 'mesh' ? (this.hover ? 'move' : 'crosshair') : null;
  }

  // ————— Dessin (repère de l'écran) —————

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    if (!this.active()) return;
    const g = this.drag;
    const n = g ? findNode(editor.doc, g.id)?.node : meshTarget();
    const m = g ? g.mesh : meshOf(n);
    if (!n || !m) return;
    const scr = m.points.map((q) =>
      this.c.toScreen(localToWorld(n, { x: q.x * n.width, y: q.y * n.height })),
    );
    const sel = g ? g.index : paintStore.get().meshPoint;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let j = 0; j <= m.rows; j++)
      for (let i = 0; i <= m.cols; i++) {
        const q = scr[meshIndex(m, i, j)];
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
    for (let i = 0; i <= m.cols; i++)
      for (let j = 0; j <= m.rows; j++) {
        const q = scr[meshIndex(m, i, j)];
        if (j === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
    ctx.stroke();
    scr.forEach((q, i) => {
      ctx.fillStyle = i === sel ? color : '#ffffff';
      ctx.beginPath();
      ctx.rect(q.x - 3.5, q.y - 3.5, 7, 7);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }
}
