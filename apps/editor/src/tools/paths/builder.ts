import {
  RegionFinder,
  applyShapeBuilder,
  builderShapes,
  type PoulpeDocument,
  type Region,
  type ShapeBuilderMode,
  type Vec,
} from '@poulpe/core';
import type { CanvasController } from '../../canvas/controller';
import { t } from '../../i18n';
import { editor, toast } from '../../store';
import { screenDist, traceCommands, type SubTool } from './common';
import { pathsState } from './state';

/*
 * Constructeur de formes, comme dans Affinity Designer : avec plusieurs formes sélectionnées qui
 * se chevauchent, la zone sous le pointeur s'éclaire. Cliquer ou glisser à travers des zones les
 * réunit en une forme (Ajouter), les retire (Soustraire, ou Alt) ou en fait une forme à part (Créer).
 */

/** Mode choisi au clavier : + ajoute, - soustrait, * crée (pavé numérique compris). */
const MODE_KEYS: Record<string, ShapeBuilderMode> = { '+': 'add', '-': 'subtract', '*': 'create' };

export class ShapeBuilderTool implements SubTool {
  /** Zones de la sélection, recalculées quand le document ou la sélection change. */
  private source: {
    doc: PoulpeDocument;
    selection: string[];
    ids: string[];
    finder: RegionFinder | null;
  } | null = null;
  private hover: Region | null = null;
  private alt = false;
  private drag: {
    last: Vec;
    mode: ShapeBuilderMode;
    picked: Map<string, { region: Region; at: Vec }>;
  } | null = null;

  constructor(private readonly c: CanvasController) {}

  get busy(): boolean {
    return !!this.drag;
  }

  /** Les zones des formes sélectionnées (au moins deux formes fermées), ou null. */
  finder(): RegionFinder | null {
    const { doc, selection } = editor.getState();
    const s = this.source;
    if (s && s.doc === doc && s.selection === selection) return s.finder;
    const list = builderShapes(doc, selection);
    const finder = list.length >= 2 ? new RegionFinder(list.map((l) => l.shape)) : null;
    this.source = { doc, selection, ids: list.map((l) => l.id), finder };
    return finder;
  }

  private mode(alt: boolean): ShapeBuilderMode {
    return alt ? 'subtract' : pathsState.get().builderMode;
  }

  /** Ajoute les zones rencontrées entre le dernier point et `p` (tous les 4 pixels d'écran). */
  private collect(p: Vec): void {
    const g = this.drag;
    const f = this.finder();
    if (!g || !f) return;
    const steps = Math.max(1, Math.ceil(screenDist(this.c, g.last, p) / 4));
    for (let k = 1; k <= steps; k++) {
      const q = {
        x: g.last.x + ((p.x - g.last.x) * k) / steps,
        y: g.last.y + ((p.y - g.last.y) * k) / steps,
      };
      const r = f.at(q);
      if (r && r.cmds.length && !g.picked.has(r.id)) g.picked.set(r.id, { region: r, at: q });
    }
    g.last = p;
  }

  pointerDown(e: PointerEvent, p: Vec): boolean {
    if (!this.finder()) {
      // Moins de deux formes : un clic choisit les formes (Maj ajoute), comme l'outil Déplacer.
      const hit = this.c.hitTest(p, false);
      const sel = editor.selection;
      if (!hit) {
        if (!e.shiftKey) editor.select([]);
      } else if (e.shiftKey)
        editor.select(sel.includes(hit.id) ? sel.filter((id) => id !== hit.id) : [...sel, hit.id]);
      else editor.select([hit.id]);
      if (this.finder() === null && editor.selection.length) toast(t('paths.builderNeedsTwo'));
      return true;
    }
    this.drag = { last: p, mode: this.mode(e.altKey), picked: new Map() };
    this.collect(p);
    return true;
  }

  pointerMove(e: PointerEvent, p: Vec): boolean {
    this.alt = e.altKey;
    if (this.drag) {
      this.collect(p);
      this.c.requestDraw();
      return true;
    }
    const f = this.finder();
    const r = f?.at(p) ?? null;
    if (r?.id !== this.hover?.id) this.c.requestDraw();
    this.hover = r;
    return !!f;
  }

  pointerUp(_e: PointerEvent, p: Vec): boolean {
    const g = this.drag;
    if (!g) return false;
    this.collect(p);
    this.drag = null;
    const points = [...g.picked.values()].map((v) => v.at);
    const ids = this.source?.ids ?? [];
    if (points.length)
      editor.apply(
        'history.shapeBuilder',
        (d) => applyShapeBuilder(d, ids, points, g.mode, t('name.curve')) ?? undefined,
      );
    this.hover = null;
    return true;
  }

  cancel(): void {
    this.drag = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.drag) {
      this.drag = null;
      this.c.requestDraw();
      return true;
    }
    const mode = MODE_KEYS[e.key];
    if (!mode || e.altKey) return false;
    pathsState.set({ builderMode: mode });
    this.c.requestDraw();
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    const g = this.drag;
    const regions = g ? [...g.picked.values()].map((v) => v.region) : this.hover ? [this.hover] : [];
    if (!regions.length) return;
    const subtract = (g?.mode ?? this.mode(this.alt)) === 'subtract';
    const tint = subtract ? '#e5484d' : color;
    ctx.save();
    ctx.fillStyle = tint;
    ctx.strokeStyle = tint;
    ctx.lineWidth = 1.5;
    for (const r of regions) {
      traceCommands(ctx, this.c, r.cmds);
      ctx.globalAlpha = 0.28;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    ctx.restore();
  }
}
