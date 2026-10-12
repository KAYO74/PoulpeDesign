import {
  cachedSvgPath,
  cloneSubpaths,
  createPath,
  exactBounds,
  findNode,
  fromSubpaths,
  isSmooth,
  markSmart,
  moveHandle,
  newId,
  pathToSvg,
  pathToWorld,
  refreshSmart,
  reverseSubpaths,
  smartMarks,
  toSubpaths,
  worldToPath,
  type Anchor,
  type Paint,
  type PathNode,
  type SubPath,
  type Vec,
} from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { cursorFor } from '../../canvas/cursors';
import { collectSnapLines, snapPoint, type SnapLines } from '../../canvas/snapping';
import { t } from '../../i18n';
import { editor, ui } from '../../store';
import {
  HIT,
  constrain45,
  drawnStroke,
  pickArtboard,
  screenDist,
  writeSubpaths,
  type SubTool,
} from './common';
import { pathsState } from './state';

/*
 * Plume, comme dans Affinity Designer : quatre modes (Plume, Intelligent, Polygone, Ligne), aperçu
 * élastique du segment suivant, reprise d'une courbe ouverte sélectionnée par l'une de ses
 * extrémités, et Ctrl (Cmd) pour déplacer les nœuds et poignées du tracé en cours. Tout le tracé
 * s'annule en une fois.
 */

type PenDrag =
  /**
   * Poignée de sortie du nœud posé (Plume) ; `free` : sans toucher à la poignée d'entrée ;
   * `pulled` : le pointeur est sorti de la zone morte autour du nœud.
   */
  | { kind: 'handle'; index: number; free: boolean; pulled?: boolean }
  /** Le nœud posé suit le pointeur (Polygone, Ligne). */
  | { kind: 'move'; index: number }
  /** Ctrl : nœud ou poignée du tracé en cours. */
  | { kind: 'node'; index: number; start: Vec; base: Anchor }
  | { kind: 'grip'; index: number; which: 'in' | 'out' };

interface Draft {
  id: string;
  artboardId: string;
  /** Tracé existant que l'on prolonge (repère des nœuds), ou null pour un nouveau tracé (repère du monde). */
  origin: PathNode | null;
  /** Les autres sous-tracés du tracé prolongé, et la place de celui en cours. */
  others: SubPath[];
  index: number;
  /** Le sous-tracé prolongé a été pris par son premier nœud : il est remis dans son sens à l'écriture. */
  reversed: boolean;
  anchors: Anchor[];
  closed: boolean;
  /** Nœuds déjà présents (tracé prolongé) : Retour arrière ne les retire pas. */
  kept: number;
  drag: PenDrag | null;
  /** Le tracé se termine au relâchement (fermeture, mode Ligne). */
  finishOnUp: boolean;
}

/** Extrémité d'un tracé ouvert sélectionné. */
interface OpenEnd {
  node: PathNode;
  si: number;
  atStart: boolean;
  world: Vec;
}

const pt = (a: Vec): Vec => ({ x: a.x, y: a.y });

export class PenTool implements SubTool {
  private draft: Draft | null = null;
  /** Position du pointeur (monde, aimantée) pour l'aperçu élastique. */
  private hover: Vec | null = null;
  /** Extrémité de courbe sélectionnée sous le pointeur (avant de commencer). */
  private endHover: OpenEnd | null = null;
  private ctrl = false;
  /** Repères d'aimantation, pour ce tracé en cours (ou ce document, sans tracé en cours). */
  private lines: { key: unknown; lines: SnapLines } | null = null;

  constructor(private readonly c: CanvasController) {
    window.addEventListener('poulpe:toolchange', this.finish);
  }

  dispose(): void {
    window.removeEventListener('poulpe:toolchange', this.finish);
  }

  get busy(): boolean {
    return !!this.draft;
  }

  // ————— Repères —————

  private toPath(p: Vec): Vec {
    const o = this.draft?.origin;
    return o ? worldToPath(o, p) : pt(p);
  }

  private toWorld(q: Vec): Vec {
    const o = this.draft?.origin;
    return o ? pathToWorld(o, q) : pt(q);
  }

  /** Point du monde aimanté (Maj : angles de 45° depuis le dernier nœud, Alt : sans aimantation). */
  private snap(p: Vec, shift: boolean, alt: boolean, from?: Anchor): Vec {
    const d = this.draft;
    const last = from ?? d?.anchors[d.anchors.length - 1];
    if (shift && last) return constrain45(this.toWorld(last), p);
    if (!this.c.snapping() || alt) return p;
    // Repères des autres objets : ils ne changent pas pendant le tracé. Chaque tracé (même la
    // reprise d'une courbe déjà tracée) les relit dans le document du moment.
    const key = d ?? editor.doc;
    if (this.lines?.key !== key)
      this.lines = { key, lines: collectSnapLines(editor.doc, new Set(d ? [d.id] : [])) };
    return snapPoint(p, this.lines.lines, this.c.snapThreshold(), this.c.gridStep());
  }

  // ————— Reprise d'une courbe —————

  /** Extrémité d'une courbe ouverte sélectionnée sous le point écran. */
  private endAt(s: Vec): OpenEnd | null {
    const doc = editor.doc;
    for (const id of editor.selection) {
      const n = findNode(doc, id)?.node;
      if (n?.type !== 'path' || n.locked || !n.visible) continue;
      const sps = toSubpaths(cachedSvgPath(n.d));
      for (let si = 0; si < sps.length; si++) {
        const sp = sps[si];
        if (sp.closed || !sp.anchors.length) continue;
        for (const atStart of [false, true]) {
          const a = sp.anchors[atStart ? 0 : sp.anchors.length - 1];
          const world = pathToWorld(n, a);
          const q = this.c.toScreen(world);
          if (Math.hypot(q.x - s.x, q.y - s.y) <= HIT + 1) return { node: n, si, atStart, world };
        }
      }
    }
    return null;
  }

  private continueFrom(end: OpenEnd): Draft {
    const n = end.node;
    const sps = cloneSubpaths(markSmart(toSubpaths(cachedSvgPath(n.d)), n.smartNodes));
    if (end.atStart) reverseSubpaths(sps, [end.si]);
    const sp = sps[end.si];
    const loc = findNode(editor.doc, n.id)!;
    this.draft = {
      id: n.id,
      artboardId: loc.artboard.id,
      origin: n,
      others: sps.filter((_, i) => i !== end.si),
      index: end.si,
      reversed: end.atStart,
      anchors: sp.anchors,
      closed: false,
      kept: sp.anchors.length,
      drag: null,
      finishOnUp: false,
    };
    return this.draft;
  }

  // ————— Écriture du tracé (aperçu du geste) —————

  private subpaths(d: Draft): SubPath[] {
    const own: SubPath = { anchors: d.anchors, closed: d.closed };
    const sps = cloneSubpaths([...d.others.slice(0, d.index), own, ...d.others.slice(d.index)]);
    if (d.reversed) reverseSubpaths(sps, [d.index]);
    return sps;
  }

  private update(): void {
    const d = this.draft;
    if (!d) return;
    refreshSmart([{ anchors: d.anchors, closed: d.closed }]);
    const sps = this.subpaths(d);
    editor.preview((doc) => {
      if (d.origin) {
        const n = findNode(doc, d.id)?.node;
        if (n?.type === 'path') writeSubpaths(n, sps);
        return [d.id];
      }
      const cmds = fromSubpaths(sps);
      const a0 = d.anchors[0];
      const b = exactBounds(cmds) ?? { x: a0.x, y: a0.y, width: 0, height: 0 };
      const geom = {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        d: pathToSvg(cmds),
        viewBox: { ...b },
      };
      const marks = smartMarks(sps);
      // Une autre commande (opacité au clavier, couleur…) a pu valider le geste en cours : le tracé
      // est alors déjà dans la base de l'aperçu, on le met à jour au lieu d'en ajouter un second.
      const found = findNode(doc, d.id)?.node;
      if (found) {
        if (found.type !== 'path') return [d.id];
        Object.assign(found, geom);
        if (d.closed) found.fill = ui.get().defaults.fill;
        if (marks.length) found.smartNodes = marks;
        else delete found.smartNodes;
        return [d.id];
      }
      const ab = doc.artboards.find((a) => a.id === d.artboardId) ?? doc.artboards[0];
      const n = createPath(
        { ...geom, name: t('name.curve') },
        { ...ui.get().defaults, stroke: drawnStroke() },
      );
      n.id = d.id;
      const fill: Paint = d.closed ? ui.get().defaults.fill : { type: 'none' };
      n.fill = fill;
      if (marks.length) n.smartNodes = marks;
      ab.children.push(n);
      return [d.id];
    });
  }

  /** Termine le tracé en cours (Entrée, Échap, changement d'outil, double-clic). */
  finish = (): void => {
    const d = this.draft;
    if (!d) return;
    this.draft = null;
    this.hover = null;
    const added = d.anchors.length - d.kept;
    const enough = d.origin ? added > 0 || d.closed : d.anchors.length >= 2;
    if (!enough || !editor.inGesture) editor.cancel();
    else {
      editor.commit('history.pen');
      editor.select([d.id]);
    }
    this.c.requestDraw();
  };

  // ————— Ctrl : nœuds et poignées du tracé en cours —————

  private gripDown(s: Vec): void {
    const d = this.draft;
    if (!d) return;
    const near = (v: Vec) => {
      const q = this.c.toScreen(this.toWorld(v));
      return Math.hypot(q.x - s.x, q.y - s.y) <= HIT;
    };
    for (let i = d.anchors.length - 1; i >= 0; i--) {
      const a = d.anchors[i];
      for (const which of ['out', 'in'] as const) {
        const h = a[which];
        if (h && near(h)) {
          d.drag = { kind: 'grip', index: i, which };
          return;
        }
      }
    }
    for (let i = d.anchors.length - 1; i >= 0; i--) {
      const a = d.anchors[i];
      if (near(a)) {
        d.drag = { kind: 'node', index: i, start: this.c.toWorld(s.x, s.y), base: structuredClone(a) };
        return;
      }
    }
  }

  // ————— Évènements —————

  pointerDown(e: PointerEvent, p: Vec, s: Vec): boolean {
    const mode = pathsState.get().penMode;
    this.ctrl = e.ctrlKey || e.metaKey;
    if (this.ctrl) {
      // Ctrl (Cmd) : on modifie le tracé en cours au lieu de poser un nœud, comme dans Affinity.
      this.gripDown(s);
      return true;
    }
    let d = this.draft;
    if (!d) {
      const end = this.endAt(s);
      if (end) {
        d = this.continueFrom(end);
        this.endHover = null;
        const last = d.anchors.length - 1;
        if (mode === 'line') {
          d.anchors.push({ ...this.toPath(p), in: null, out: null });
          d.drag = { kind: 'move', index: last + 1 };
          d.finishOnUp = true;
        } else if (mode === 'pen') d.drag = { kind: 'handle', index: last, free: true };
        this.update();
        return true;
      }
      const ab = pickArtboard(p);
      if (!ab) return true;
      d = this.draft = {
        id: newId(),
        artboardId: ab.id,
        origin: null,
        others: [],
        index: 0,
        reversed: false,
        anchors: [],
        closed: false,
        kept: 0,
        drag: null,
        finishOnUp: false,
      };
    }
    const a = d.anchors;
    if (
      mode !== 'line' &&
      a.length >= 2 &&
      !d.closed &&
      screenDist(this.c, this.toWorld(a[0]), p) <= HIT + 1
    ) {
      // Clic sur le premier nœud : le tracé se ferme (un nouveau tracé prend le remplissage courant).
      d.closed = true;
      d.finishOnUp = true;
      d.drag = mode === 'pen' ? { kind: 'handle', index: 0, free: false } : null;
      this.update();
      return true;
    }
    if (mode !== 'line' && a.length > d.kept && screenDist(this.c, this.toWorld(a[a.length - 1]), p) <= 3) {
      // Second clic au même endroit (double-clic) : fin du tracé ouvert.
      this.finish();
      return true;
    }
    const q = this.toPath(this.snap(p, e.shiftKey, e.altKey));
    if (mode === 'line') {
      // Une ligne droite par glisser : du dernier nœud (ou du point pressé) jusqu'au relâchement.
      if (!a.length) a.push({ ...q, in: null, out: null });
      a.push({ ...q, in: null, out: null });
      d.drag = { kind: 'move', index: a.length - 1 };
      d.finishOnUp = true;
    } else {
      a.push({ ...q, in: null, out: null, ...(mode === 'smart' ? { smart: true } : {}) });
      d.drag =
        mode === 'polygon'
          ? { kind: 'move', index: a.length - 1 }
          : { kind: 'handle', index: a.length - 1, free: false };
    }
    this.update();
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec, s: Vec): boolean {
    this.ctrl = e.ctrlKey || e.metaKey;
    this.c.canvas.style.cursor = cursorFor(this.ctrl ? 'direct' : 'pen');
    const d = this.draft;
    if (!d) {
      const end = this.endAt(s);
      if (end?.world !== this.endHover?.world) this.c.requestDraw();
      this.endHover = end;
      return true;
    }
    const g = d.drag;
    if (!g) {
      this.hover = this.ctrl ? null : this.snap(p, e.shiftKey, e.altKey);
      this.c.requestDraw();
      return true;
    }
    const a = d.anchors[g.index];
    if (g.kind === 'handle') {
      // Zone morte de 3 px : un clic un peu tremblé ne change pas les poignées, même celles que le
      // nœud a déjà (fermeture sur le premier nœud, reprise d'une courbe).
      if (!g.pulled) {
        if (screenDist(this.c, this.toWorld(a), p) < 3) return true;
        g.pulled = true;
      }
      const q = this.toPath(e.shiftKey ? constrain45(this.toWorld(a), p) : p);
      // Tirer une poignée fait d'un nœud intelligent un nœud lisse ; Alt casse la symétrie.
      delete a.smart;
      const mirror = g.free || e.altKey ? false : 'symmetric';
      if (d.closed && g.index === 0 && d.finishOnUp) {
        // En refermant, on règle la poignée d'arrivée sur le premier nœud.
        moveHandle(a, 'in', { x: 2 * a.x - q.x, y: 2 * a.y - q.y }, mirror);
      } else moveHandle(a, 'out', q, mirror);
    } else if (g.kind === 'move') {
      const prev = d.anchors[g.index - 1];
      const q = this.toPath(this.snap(p, e.shiftKey, e.altKey, prev));
      a.x = q.x;
      a.y = q.y;
    } else if (g.kind === 'node') {
      const from = this.toPath(g.start),
        to = this.toPath(p);
      const dx = to.x - from.x,
        dy = to.y - from.y;
      a.x = g.base.x + dx;
      a.y = g.base.y + dy;
      a.in = g.base.in && { x: g.base.in.x + dx, y: g.base.in.y + dy };
      a.out = g.base.out && { x: g.base.out.x + dx, y: g.base.out.y + dy };
    } else {
      delete a.smart;
      moveHandle(a, g.which, this.toPath(p), isSmooth(a) && !e.altKey ? 'angle' : false);
    }
    this.update();
    return true;
  }

  pointerUp(): boolean {
    const d = this.draft;
    if (!d) return false;
    const g = d.drag;
    d.drag = null;
    if (g?.kind === 'move' && d.finishOnUp) {
      // Mode Ligne : un simple clic ne trace rien.
      const a = d.anchors[g.index],
        prev = d.anchors[g.index - 1];
      if (prev && screenDist(this.c, this.toWorld(a), this.toWorld(prev)) < 3) {
        d.anchors.splice(g.index, 1);
        if (d.anchors.length <= Math.max(1, d.kept) && !d.origin) d.anchors.length = 0;
      }
    }
    if (d.finishOnUp) this.finish();
    return true;
  }

  cancel(): void {
    if (this.draft) this.draft.drag = null;
  }

  /** Entrée / Échap terminent le tracé, Retour arrière retire le dernier nœud posé. */
  key(e: KeyboardEvent): boolean {
    const d = this.draft;
    if (!d) return false;
    if (e.key === 'Enter' || e.key === 'Escape') {
      this.finish();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (d.anchors.length > d.kept) d.anchors.pop();
      if (d.anchors.length <= d.kept) {
        this.draft = null;
        editor.cancel();
      } else this.update();
      this.c.requestDraw();
      return true;
    }
    return false;
  }

  // ————— Dessin (repère de l'écran) —————

  /** Aperçu du segment suivant, du dernier nœud jusqu'au pointeur, selon le mode. */
  private rubberBand(ctx: CanvasRenderingContext2D, d: Draft, hover: Vec): void {
    const mode = pathsState.get().penMode;
    const last = d.anchors[d.anchors.length - 1];
    const S = (v: Vec) => this.c.toScreen(this.toWorld(v));
    const h = this.toPath(hover);
    ctx.beginPath();
    if (mode === 'smart') {
      // Les nœuds intelligents se recalculent avec le nœud à venir : les deux derniers segments bougent.
      const sp: SubPath = cloneSubpaths([{ anchors: d.anchors, closed: false }])[0];
      sp.anchors.push({ ...h, in: null, out: null, smart: true });
      refreshSmart([sp]);
      const n = sp.anchors.length;
      const first = sp.anchors[Math.max(0, n - 3)];
      const s0 = S(first);
      ctx.moveTo(s0.x, s0.y);
      for (let i = Math.max(1, n - 2); i < n; i++) {
        const a = sp.anchors[i - 1],
          b = sp.anchors[i];
        const c1 = S(a.out ?? a),
          c2 = S(b.in ?? b),
          q = S(b);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, q.x, q.y);
      }
    } else {
      const s0 = S(last),
        s1 = S(h);
      ctx.moveTo(s0.x, s0.y);
      if (mode === 'pen' && last.out) {
        const c1 = S(last.out);
        ctx.bezierCurveTo(c1.x, c1.y, s1.x, s1.y, s1.x, s1.y);
      } else ctx.lineTo(s1.x, s1.y);
    }
    ctx.stroke();
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    const d = this.draft;
    const ring = (w: Vec) => {
      const q = this.c.toScreen(w);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    };
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    if (!d) {
      if (this.endHover && ui.get().tool === 'pen') ring(this.endHover.world);
      ctx.restore();
      return;
    }
    const S = (v: Vec) => this.c.toScreen(this.toWorld(v));
    const a = d.anchors;
    if (!a.length) {
      ctx.restore();
      return;
    }
    const last = a[a.length - 1];
    if (this.hover && !d.drag && !d.closed) {
      if (pathsState.get().rubberBand && pathsState.get().penMode !== 'line')
        this.rubberBand(ctx, d, this.hover);
      if (a.length >= 2 && screenDist(this.c, this.toWorld(a[0]), this.hover) <= HIT + 1)
        ring(this.toWorld(a[0]));
    }
    const handle = (n: Anchor, h: Vec | null) => {
      if (!h) return;
      const qa = S(n),
        qh = S(h);
      ctx.beginPath();
      ctx.moveTo(qa.x, qa.y);
      ctx.lineTo(qh.x, qh.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(qh.x, qh.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
    };
    const g = d.drag;
    const active = g ? a[g.index] : last;
    // Ctrl : toutes les poignées, pour pouvoir les saisir.
    for (const n of this.ctrl ? a : [active]) {
      handle(n, n.in);
      handle(n, n.out);
    }
    for (const n of a) {
      const q = S(n);
      ctx.fillStyle = n === active ? color : '#ffffff';
      if (n.smart) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
        ctx.strokeRect(q.x - 2.5, q.y - 2.5, 5, 5);
      }
    }
    ctx.restore();
  }
}
