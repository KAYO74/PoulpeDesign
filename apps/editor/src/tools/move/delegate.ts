import {
  ancestors,
  dragBoxHandle,
  findArtboard,
  findNode,
  hitNode,
  isPictureFrame,
  isSolidGroup,
  isStyled,
  isTable,
  isVectorCrop,
  localToWorld,
  newId,
  nodeBounds,
  setVectorCrop,
  topLevelIds,
  translateNode,
  unionBoxes,
  vectorCropFrame,
  worldToLocal,
  type Box,
  type CropFrame,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import { nodePath } from '@poulpe/render';
import type { CanvasController } from '../../canvas/controller';
import { t } from '../../i18n';
import { editor, setTool, ui, type ToolId } from '../../store';
import { toolGroupsFor } from '../../toolCatalog';
import { activeWorkspace } from '../../workspaces';
import type { ToolDelegate } from '../types';
import { applyLoadedStyle, finishVectorCrop, loadStyle, selectedVectorCrop, unloadStyle } from './actions';
import { noteAltDown, pivotLocal, setPivot } from './hooks';
import { moveState } from './state';

/*
 * Gestes sur le canevas : point d'origine de la transformation et double-clic de l'outil
 * Déplacer, poignées du plan de travail actif (outil Plan de travail), Recadrage vectoriel et
 * Pipette de style.
 */

type Frame = Box & { rotation: number };
/** Poignée : position sur chaque axe (0, 0.5 ou 1). */
type Handle = [number, number];

const HANDLES: Handle[] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [0, 0.5],
];
const HANDLE_PX = 8;

type Gesture =
  | { kind: 'pivot' }
  | { kind: 'artboard'; id: string; handle: Handle; box: Box; moved: boolean }
  | { kind: 'cropResize'; handle: Handle; frame: CropFrame; ids: string[]; groupId: string; moved: boolean }
  | { kind: 'cropPan'; start: Vec; frame: CropFrame; ids: string[]; groupId: string; moved: boolean };

/** Curseur de redimensionnement d'une poignée, selon l'angle du cadre. */
function handleCursor([hx, hy]: Handle, rotation: number): string {
  const a0 = (Math.atan2(hy - 0.5, hx - 0.5) * 180) / Math.PI;
  const a = (((a0 + rotation) % 180) + 180) % 180;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(a / 45) % 4];
}

/** Matrice qui place le repère local d'un objet (0..largeur, 0..hauteur) dans le monde. */
function localMatrix(n: Frame): DOMMatrix {
  return new DOMMatrix()
    .translate(n.x + n.width / 2, n.y + n.height / 2)
    .rotate(n.rotation)
    .translate(-n.width / 2, -n.height / 2);
}

const cropNames = () => ({ group: t('vcrop.name'), mask: t('vcrop.mask') });

/** La colonne d'outils affichée propose l'outil Nœud (jamais en Persona Photo). */
function nodeToolShown(): boolean {
  const persona = ui.get().persona;
  if (persona === 'photo') return false;
  return (activeWorkspace()?.tools ?? toolGroupsFor(persona).flat()).includes('direct');
}

/** Cadre invisible d'un recadrage vectoriel (son premier enfant) : jamais visé par un clic. */
function isCropFrame(id: string): boolean {
  const parent = findNode(editor.doc, id)?.parent as SceneNode | undefined;
  return isVectorCrop(parent) && parent.children[0].id === id;
}

export function moveDelegate(c: CanvasController): ToolDelegate {
  let gesture: Gesture | null = null;
  /** Survol : poignée (plan de travail, recadrage), intérieur du cadre, point d'origine, objet visé. */
  let hover: { handle: Handle | null; inside: boolean; pivot: boolean; node: string | null } = {
    handle: null,
    inside: false,
    pivot: false,
    node: null,
  };
  const unsubscribe = moveState.subscribe(() => c.requestDraw());
  const cancel = () => {
    if (gesture && gesture.kind !== 'pivot') editor.cancel();
    gesture = null;
  };

  const tool = () => ui.get().tool;
  const near = (a: Vec, s: Vec, px: number) => {
    const q = c.toScreen(a);
    return Math.abs(q.x - s.x) <= px && Math.abs(q.y - s.y) <= px;
  };
  const handleAt = (f: Frame, s: Vec): Handle | null =>
    HANDLES.find(([hx, hy]) => near(localToWorld(f, { x: hx * f.width, y: hy * f.height }), s, HANDLE_PX)) ??
    null;
  const insideFrame = (f: Frame, p: Vec) => {
    const l = worldToLocal(f, p);
    return l.x >= 0 && l.y >= 0 && l.x <= f.width && l.y <= f.height;
  };

  /** Point d'origine de la transformation (outil Déplacer), dans le monde, s'il est affiché. */
  const pivot = (): { f: Frame; p: Vec } | null => {
    if (!moveState.get().showOrigin || tool() !== 'select') return null;
    if (ui.get().editingTextId || ui.get().cropId || !editor.selection.length) return null;
    const f = c.selectionFrame();
    const l = f && pivotLocal(f);
    return f && l ? { f, p: localToWorld(f, l) } : null;
  };

  const activeArtboard = () => {
    const ab = findArtboard(editor.doc, editor.getState().activeArtboardId);
    return ab ? { id: ab.id, x: ab.x, y: ab.y, width: ab.width, height: ab.height, rotation: 0 } : null;
  };

  /** Objets que le Recadrage vectoriel découpe, et leur cadre (gardés tant que rien ne change). */
  let cropCache: { doc: unknown; sel: string[]; value: { ids: string[]; frame: CropFrame } | null } | null =
    null;
  const cropTarget = (): { ids: string[]; frame: CropFrame } | null => {
    const doc = editor.doc;
    const sel = editor.selection;
    if (cropCache?.doc === doc && cropCache.sel === sel) return cropCache.value;
    // Un objet d'un groupe pris d'un bloc (cadre d'image, tableau, recadrage) : on recadre le groupe.
    const outer = sel.map((id) => ancestors(doc, id).find(isSolidGroup)?.id ?? id);
    const ids = topLevelIds(doc, [...new Set(outer)]).filter((id) => !findNode(doc, id)?.node.locked);
    const frame = ids.length ? vectorCropFrame(doc, ids) : null;
    cropCache = { doc, sel, value: frame ? { ids, frame } : null };
    return cropCache.value;
  };

  /** Boîte du recadrage après avoir tiré une poignée, dans le repère (tourné) du cadre de départ. */
  const croppedFrame = (
    g: Extract<Gesture, { kind: 'cropResize' }>,
    p: Vec,
    keepRatio: boolean,
  ): CropFrame => {
    const f = g.frame;
    const [hx, hy] = g.handle;
    const l = worldToLocal(f, p);
    const b = dragBoxHandle({ x: 0, y: 0, width: f.width, height: f.height }, hx, hy, l, keepRatio, false);
    const center = localToWorld(f, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    return {
      x: center.x - b.width / 2,
      y: center.y - b.height / 2,
      width: b.width,
      height: b.height,
      rotation: f.rotation,
    };
  };

  /**
   * Objet le plus profond sous le point dans le groupe `g`. `solid` : un cadre d'image, un tableau
   * ou un recadrage rencontré en chemin compte comme un seul objet.
   */
  const deepest = (g: SceneNode, p: Vec, solid: boolean): SceneNode => {
    if (g.type !== 'group') return g;
    const tol = 4 / c.view.zoom;
    for (let i = g.children.length - 1; i >= 0; i--) {
      const k = g.children[i];
      if (!k.locked && hitNode(k, p, tol)) return solid && isSolidGroup(k) ? k : deepest(k, p, solid);
    }
    return g;
  };

  /**
   * Objet visé par la Pipette de style : l'objet touché, même dans un groupe sélectionné (qui passe
   * en premier dans `hitTest`), mais jamais le cadre invisible d'un recadrage (le vide autour).
   */
  const styleTarget = (p: Vec): SceneNode | null => {
    const hit = c.hitTest(p, true);
    const n = hit && deepest(hit, p, false);
    return n && !isCropFrame(n.id) ? n : null;
  };

  const outline = (ctx: CanvasRenderingContext2D, n: SceneNode, color: string) => {
    const v = c.view;
    ctx.save();
    ctx.strokeStyle = color;
    if (n.type === 'group') {
      const b = nodeBounds(n);
      const a = c.toScreen(b);
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(a.x, a.y, b.width * v.zoom, b.height * v.zoom);
    } else {
      ctx.translate(v.panX, v.panY);
      ctx.scale(v.zoom, v.zoom);
      const m = localMatrix(n);
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.lineWidth = 1.5 / v.zoom;
      ctx.stroke(nodePath(n));
    }
    ctx.restore();
  };

  const drawHandles = (ctx: CanvasRenderingContext2D, f: Frame, color: string) => {
    const pts = [
      { x: 0, y: 0 },
      { x: f.width, y: 0 },
      { x: f.width, y: f.height },
      { x: 0, y: f.height },
    ].map((q) => c.toScreen(localToWorld(f, q)));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    const s = HANDLE_PX;
    for (const [hx, hy] of HANDLES) {
      const q = c.toScreen(localToWorld(f, { x: hx * f.width, y: hy * f.height }));
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate((f.rotation * Math.PI) / 180);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.strokeRect(-s / 2 + 0.5, -s / 2 + 0.5, s - 1, s - 1);
      ctx.restore();
    }
    ctx.restore();
  };

  return {
    get busy() {
      return gesture !== null;
    },

    pointerDown(e, p, s) {
      const current = tool();
      noteAltDown(e, p);
      if (current === 'select') {
        const pv = pivot();
        if (pv && near(pv.p, s, 7)) {
          gesture = { kind: 'pivot' };
          return true;
        }
        return false;
      }
      if (current === 'artboard') {
        const ab = activeArtboard();
        const handle = ab && handleAt(ab, s);
        if (!ab || !handle) return false;
        editor.begin();
        gesture = { kind: 'artboard', id: ab.id, handle, box: ab, moved: false };
        return true;
      }
      if (current === 'vectorCrop') {
        const target = cropTarget();
        if (target) {
          const groupId = selectedVectorCrop() ?? newId();
          const handle = handleAt(target.frame, s);
          if (handle) {
            editor.begin();
            gesture = { kind: 'cropResize', handle, ...target, groupId, moved: false };
            return true;
          }
          if (insideFrame(target.frame, p)) {
            editor.begin();
            gesture = { kind: 'cropPan', start: p, ...target, groupId, moved: false };
            return true;
          }
        }
        // Ailleurs : choisit l'objet à recadrer.
        const hit = c.hitTest(p, false);
        editor.select(hit ? [hit.id] : []);
        return true;
      }
      if (current === 'stylePicker') {
        const hit = styleTarget(p);
        if (!hit) return true;
        // Premier clic (ou Alt + clic) : prend le style ; ensuite, chaque clic l'applique.
        if (!moveState.get().picked || e.altKey) loadStyle(hit.id);
        else applyLoadedStyle(hit.id);
        return true;
      }
      return false;
    },

    pointerMove(e, p, s) {
      const g = gesture;
      if (!g) {
        // Survol : seulement noté (le contrôleur choisit ensuite le curseur avec `cursor`).
        const current = tool();
        const prevNode = hover.node;
        hover = { handle: null, inside: false, pivot: false, node: null };
        if (current === 'select') {
          const pv = pivot();
          hover.pivot = !!pv && near(pv.p, s, 7);
        } else if (current === 'artboard') {
          const ab = activeArtboard();
          hover.handle = ab && handleAt(ab, s);
        } else if (current === 'vectorCrop') {
          const target = cropTarget();
          hover.handle = target && handleAt(target.frame, s);
          hover.inside = !!target && insideFrame(target.frame, p);
        } else if (current === 'stylePicker') {
          hover.node = styleTarget(p)?.id ?? null;
          if (hover.node !== prevNode) c.requestDraw();
        }
        return false;
      }
      if (g.kind === 'pivot') {
        const f = c.selectionFrame();
        if (!f) return true;
        // Aimantation sur les poignées et le centre du cadre.
        let q = p;
        for (const [hx, hy] of [...HANDLES, [0.5, 0.5] as Handle]) {
          const w = localToWorld(f, { x: hx * f.width, y: hy * f.height });
          if (near(w, s, 8)) {
            q = w;
            break;
          }
        }
        setPivot(f, q);
        return true;
      }
      if (g.kind === 'artboard') {
        const [hx, hy] = g.handle;
        // Maj garde les proportions, Ctrl ou Alt part du centre.
        const b = dragBoxHandle(g.box, hx, hy, p, e.shiftKey, e.altKey || e.ctrlKey || e.metaKey);
        const r = {
          x: Math.round(b.x),
          y: Math.round(b.y),
          width: Math.max(1, Math.round(b.width)),
          height: Math.max(1, Math.round(b.height)),
        };
        g.moved = true;
        editor.preview((d) => {
          const ab = findArtboard(d, g.id);
          if (ab) Object.assign(ab, r);
        });
        return true;
      }
      if (g.kind === 'cropResize') {
        const frame = croppedFrame(g, p, e.shiftKey);
        g.moved = true;
        editor.preview((d) => {
          const id = setVectorCrop(d, g.ids, frame, g.groupId, cropNames());
          return id ? [id] : undefined;
        });
        return true;
      }
      let dx = p.x - g.start.x,
        dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * c.view.zoom < 3) return true;
      g.moved = true;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      editor.preview((d) => {
        const id = setVectorCrop(d, g.ids, g.frame, g.groupId, cropNames());
        const grp = id ? findNode(d, id)?.node : null;
        if (!isVectorCrop(grp)) return;
        // Le cadre reste en place, le contenu glisse dessous.
        grp.children.slice(1).forEach((k) => translateNode(k, dx, dy));
        return [grp.id];
      });
      return true;
    },

    pointerUp() {
      const g = gesture;
      gesture = null;
      if (!g) return false;
      if (g.kind === 'pivot') return true;
      if (!g.moved) editor.cancel();
      else editor.commit(g.kind === 'artboard' ? 'history.artboard' : 'history.vectorCrop');
      return true;
    },

    cancel,

    doubleClick(e, p, s) {
      const current = tool();
      if (current === 'vectorCrop') {
        finishVectorCrop();
        return true;
      }
      if (current !== 'select') return false;
      // Double-clic sur le point d'origine : il revient au centre.
      const pv = pivot();
      if (pv && near(pv.p, s, 7)) {
        moveState.set({ origin: null });
        return true;
      }
      // Double-clic sur une courbe ou une forme : outil Nœud (le texte s'édite, l'image se recadre).
      const doc = editor.doc;
      let hit = c.hitTest(p, true);
      // Le premier clic a choisi le groupe (sélection auto) : on vise l'objet touché dedans.
      if (hit?.type === 'group' && editor.selection.includes(hit.id)) hit = deepest(hit, p, true);
      if (!hit || hit.locked) return false;
      const parent = findNode(doc, hit.id)?.parent as SceneNode | undefined;
      if (parent?.type === 'group') {
        if (isPictureFrame(parent) || isTable(parent) || isCropFrame(hit.id)) return false;
        // Dans un groupe, le premier double-clic choisit l'objet, le suivant l'édite (Affinity).
        if (!editor.selection.includes(hit.id)) {
          editor.select([hit.id]);
          return true;
        }
      }
      if (!isStyled(hit) || hit.type === 'text' || !nodeToolShown()) return false;
      editor.select([hit.id]);
      setTool('direct');
      return true;
    },

    key(e) {
      const current = tool();
      if (current === 'vectorCrop' && (e.key === 'Enter' || e.key === 'Escape')) {
        if (gesture) {
          cancel();
          c.requestDraw();
        } else finishVectorCrop();
        return true;
      }
      if (current === 'stylePicker' && e.key === 'Escape' && moveState.get().picked) {
        unloadStyle();
        return true;
      }
      return false;
    },

    draw(ctx, color) {
      const current = tool();
      if (current === 'select') {
        const pv = pivot();
        if (!pv) return;
        const q = c.toScreen(pv.p);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(q.x - 9, q.y);
        ctx.lineTo(q.x + 9, q.y);
        ctx.moveTo(q.x, q.y - 9);
        ctx.lineTo(q.x, q.y + 9);
        ctx.stroke();
        ctx.restore();
        return;
      }
      if (current === 'artboard') {
        const ab = activeArtboard();
        if (ab) drawHandles(ctx, ab, color);
        return;
      }
      if (current === 'vectorCrop') {
        const target = cropTarget();
        if (!target) return;
        // Contenu entier (pointillés) d'un objet déjà recadré, puis le cadre et ses poignées.
        const grp = target.ids.length === 1 ? findNode(editor.doc, target.ids[0])?.node : null;
        if (isVectorCrop(grp)) {
          const b = unionBoxes(grp.children.slice(1).map(nodeBounds));
          if (b) {
            const a = c.toScreen(b);
            ctx.save();
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.7;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.width * c.view.zoom, b.height * c.view.zoom);
            ctx.restore();
          }
        }
        drawHandles(ctx, target.frame, color);
        return;
      }
      if (current === 'stylePicker' && hover.node) {
        const n = findNode(editor.doc, hover.node)?.node;
        if (n) outline(ctx, n, color);
      }
    },

    cursor(current: ToolId) {
      if (current === 'select' && hover.pivot) return 'move';
      if ((current === 'artboard' || current === 'vectorCrop') && hover.handle) {
        const rot = current === 'vectorCrop' ? (cropTarget()?.frame.rotation ?? 0) : 0;
        return handleCursor(hover.handle, rot);
      }
      if (current === 'vectorCrop' && hover.inside) return 'move';
      return null;
    },

    dispose() {
      unsubscribe();
    },
  };
}
