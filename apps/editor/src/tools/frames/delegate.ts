import {
  artboardAt,
  cellRect,
  findArtboard,
  findNode,
  frameImage,
  isPictureFrame,
  isTable,
  type Box,
  type GroupNode,
  type PoulpeDocument,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import { nodePath } from '@poulpe/render';
import type { CanvasController } from '../../canvas/controller';
import { collectSnapLines, snapPoint, type SnapLines } from '../../canvas/snapping';
import { editedTextId, isEditingText } from '../../canvas/textEdit';
import { frameTarget } from '../../libraryActions';
import { editor, ui } from '../../store';
import type { ToolDelegate } from '../types';
import {
  cancelPlaceImage,
  chooseImageForFrame,
  makePictureFrame,
  placePending,
  selectedFrame,
  startPlaceImage,
} from './frameActions';
import { detachMasterObjectOnPage, masterObjectAt } from './pageActions';
import { framesState } from './state';
import { createTableAt, editCell, moveToCell, tableOf } from './tableActions';

/*
 * Gestes sur le canevas des outils Cadre d'image (rectangle, ellipse), Image et Tableau, et
 * double-clics de l'outil Déplacer sur un cadre d'image ou un objet de la page maître.
 */

type Gesture =
  | {
      kind: 'frame';
      shape: 'rect' | 'ellipse';
      start: Vec;
      artboardId: string;
      frame: GroupNode | null;
      lines: SnapLines;
    }
  | { kind: 'place'; start: Vec; current: Vec; moved: boolean; frameId: string | null; free: boolean }
  | { kind: 'table'; start: Vec; current: Vec; moved: boolean }
  | {
      kind: 'cells';
      tableId: string;
      from: { r: number; c: number };
      to: { r: number; c: number };
      moved: boolean;
    };

const FRAME_TOOLS = { pictureFrameRect: 'rect', pictureFrameEllipse: 'ellipse' } as const;

/** Cadres d'image vides du document (pour leur croix d'attente), calculés une fois par version. */
const emptyFrames = new WeakMap<PoulpeDocument, GroupNode[]>();
function emptyFramesOf(doc: PoulpeDocument): GroupNode[] {
  let list = emptyFrames.get(doc);
  if (list) return list;
  list = [];
  const visit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      if (n.type !== 'group' || !n.visible) continue;
      if (isPictureFrame(n) && !frameImage(n)) list!.push(n);
      else visit(n.children);
    }
  };
  for (const ab of doc.artboards) visit(ab.children);
  emptyFrames.set(doc, list);
  return list;
}

function rectFrom(a: Vec, b: Vec): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Matrice qui place le repère local d'un objet (0..largeur, 0..hauteur) dans le monde. */
function localMatrix(n: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}): DOMMatrix {
  return new DOMMatrix()
    .translate(n.x + n.width / 2, n.y + n.height / 2)
    .rotate(n.rotation)
    .translate(-n.width / 2, -n.height / 2);
}

export function framesDelegate(c: CanvasController): ToolDelegate {
  let gesture: Gesture | null = null;
  let hover: Vec | null = null;
  let pendingImg: { data: string; img: HTMLImageElement } | null = null;

  const pendingImage = (): HTMLImageElement | null => {
    const p = framesState.get().pending;
    if (!p) return null;
    if (pendingImg?.data !== p.data) {
      const img = new Image();
      img.onload = () => c.requestDraw();
      img.src = p.data;
      pendingImg = { data: p.data, img };
    }
    return pendingImg.img.complete ? pendingImg.img : null;
  };

  /** Boîte d'un glisser de création : Maj garde un carré, Ctrl part du centre (comme les formes). */
  const dragBox = (start: Vec, p: Vec, e: PointerEvent): Box => {
    let dx = p.x - start.x,
      dy = p.y - start.y;
    if (e.shiftKey) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    if (e.ctrlKey || e.metaKey)
      return {
        x: start.x - Math.abs(dx),
        y: start.y - Math.abs(dy),
        width: Math.abs(dx) * 2,
        height: Math.abs(dy) * 2,
      };
    return rectFrom(start, { x: start.x + dx, y: start.y + dy });
  };

  /** Boîte de l'image posée en glissant : ses proportions sont gardées (Maj : libres). */
  const placeBox = (g: Extract<Gesture, { kind: 'place' }>): Box => {
    const p = framesState.get().pending;
    const dx = g.current.x - g.start.x,
      dy = g.current.y - g.start.y;
    if (!p || g.free) return rectFrom(g.start, g.current);
    const a = p.width / p.height;
    const w = Math.max(Math.abs(dx), Math.abs(dy) * a);
    const h = w / a;
    return rectFrom(g.start, {
      x: g.start.x + Math.sign(dx || 1) * w,
      y: g.start.y + Math.sign(dy || 1) * h,
    });
  };

  const moved = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y) * c.view.zoom >= 3;

  /** Cellule d'un tableau sous le point (un clic sur son texte ou son fond). */
  const cellAt = (p: Vec): { tableId: string; r: number; c: number } | null => {
    const hit = c.hitTest(p, true);
    const found = hit ? tableOf(editor.doc, hit.id) : null;
    return found?.cell ? { tableId: found.table.id, ...found.cell } : null;
  };

  // Tab et Maj+Tab pendant la saisie dans une cellule : la zone de saisie ne doit pas les recevoir.
  const onTab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || !isEditingText()) return;
    if (!tableOf(editor.doc, editedTextId())?.cell) return;
    e.preventDefault();
    e.stopPropagation();
    moveToCell(e.shiftKey ? -1 : 1);
  };
  window.addEventListener('keydown', onTab, true);

  return {
    get busy() {
      return gesture !== null;
    },

    pointerDown(e, p) {
      const tool = ui.get().tool;
      const doc = editor.doc;
      if (tool === 'pictureFrameRect' || tool === 'pictureFrameEllipse') {
        const ab = artboardAt(doc, p) ?? findArtboard(doc, editor.getState().activeArtboardId);
        if (!ab) return true;
        const lines = collectSnapLines(doc, new Set());
        const start = c.snapping() && !e.altKey ? snapPoint(p, lines, c.snapThreshold(), c.gridStep()) : p;
        gesture = {
          kind: 'frame',
          shape: FRAME_TOOLS[tool],
          start: { x: start.x, y: start.y },
          artboardId: ab.id,
          frame: null,
          lines,
        };
        editor.setActiveArtboard(ab.id);
        return true;
      }
      if (tool === 'image') {
        if (!framesState.get().pending) {
          void startPlaceImage();
          return true;
        }
        gesture = {
          kind: 'place',
          start: p,
          current: p,
          moved: false,
          frameId: frameTarget(doc, p),
          free: false,
        };
        return true;
      }
      if (tool === 'table') {
        const cell = cellAt(p);
        if (cell) {
          gesture = { kind: 'cells', tableId: cell.tableId, from: cell, to: cell, moved: false };
          return true;
        }
        gesture = { kind: 'table', start: p, current: p, moved: false };
        return true;
      }
      return false;
    },

    pointerMove(e, p) {
      const tool = ui.get().tool;
      const g = gesture;
      if (!g) {
        if (tool === 'image' && framesState.get().pending) {
          hover = p;
          return true;
        }
        hover = null;
        return false;
      }
      if (g.kind === 'frame') {
        const snapped =
          c.snapping() && !e.altKey ? snapPoint(p, g.lines, c.snapThreshold(), c.gridStep()) : p;
        if (!g.frame && !moved(g.start, snapped)) return true;
        const box = dragBox(g.start, snapped, e);
        if (!g.frame) {
          g.frame = makePictureFrame(box, g.shape, framesState.get().fit);
          editor.begin();
        }
        // Chaque aperçu repart de l'état d'avant le geste : le cadre y est ajouté à sa nouvelle taille.
        const frame = g.frame;
        editor.preview((d) => {
          const f = structuredClone(frame);
          Object.assign(f.children[0], {
            x: box.x,
            y: box.y,
            width: Math.max(1, box.width),
            height: Math.max(1, box.height),
          });
          findArtboard(d, g.artboardId)!.children.push(f);
          return [f.id];
        });
        return true;
      }
      if (g.kind === 'place' || g.kind === 'table') {
        g.current = p;
        if (!g.moved && moved(g.start, p)) g.moved = true;
        if (g.kind === 'place') g.free = e.shiftKey;
        return true;
      }
      const cell = cellAt(p);
      if (cell && cell.tableId === g.tableId && (cell.r !== g.to.r || cell.c !== g.to.c)) {
        g.to = { r: cell.r, c: cell.c };
        g.moved = true;
        framesState.set({
          cells: { tableId: g.tableId, range: { r0: g.from.r, c0: g.from.c, r1: g.to.r, c1: g.to.c } },
        });
      }
      return true;
    },

    pointerUp(e, p) {
      const g = gesture;
      gesture = null;
      if (!g) return false;
      if (g.kind === 'frame') {
        if (g.frame) {
          editor.commit('history.pictureFrame');
          return true;
        }
        // Simple clic : un cadre de taille par défaut, centré sur le point.
        const ab = findArtboard(editor.doc, g.artboardId);
        const size = Math.round(Math.min(ab?.width ?? 400, ab?.height ?? 400) / 4) || 100;
        const frame = makePictureFrame(
          { x: g.start.x - size / 2, y: g.start.y - size / 2, width: size, height: size },
          g.shape,
          framesState.get().fit,
        );
        editor.apply('history.pictureFrame', (d) => {
          findArtboard(d, g.artboardId)!.children.push(frame);
          return [frame.id];
        });
        return true;
      }
      if (g.kind === 'place') {
        hover = null;
        g.current = p;
        g.free = e.shiftKey;
        if (g.moved) placePending(g.start, placeBox(g), null);
        else placePending(g.start, null, g.frameId);
        return true;
      }
      if (g.kind === 'table') {
        const box = g.moved ? rectFrom(g.start, p) : null;
        createTableAt(g.start, box && box.width > 4 && box.height > 4 ? box : null);
        return true;
      }
      if (!g.moved) {
        editCell(g.tableId, g.from.r, g.from.c);
        return true;
      }
      editor.select([g.tableId]);
      return true;
    },

    cancel() {
      if (gesture?.kind === 'frame' && gesture.frame) editor.cancel();
      gesture = null;
    },

    doubleClick(e, p) {
      const tool = ui.get().tool;
      if (tool !== 'select' && tool !== 'direct') return false;
      const doc = editor.doc;
      const hit = c.hitTest(p, true);
      if (hit) {
        // Le cadre lui-même (déjà sélectionné, il passe en premier) ou un de ses enfants.
        const parent = findNode(doc, hit.id)?.parent as SceneNode | undefined;
        const frame = isPictureFrame(hit) ? hit : isPictureFrame(parent) ? parent : null;
        if (!frame) return false;
        const image = frameImage(frame);
        // Double-clic dans un cadre : on prend son image, pour la déplacer ou la mettre à l'échelle.
        if (image) {
          editor.select([image.id]);
          return true;
        }
        editor.select([frame.id]);
        void chooseImageForFrame(frame.id);
        return true;
      }
      // Double-clic sur un objet de la page maître : il est détaché sur la page pour y être modifié.
      const m = masterObjectAt(doc, p, 4 / c.view.zoom);
      if (m && !m.node.locked) {
        detachMasterObjectOnPage(m.page.id, m.node.id);
        return true;
      }
      return false;
    },

    key(e) {
      if (e.key !== 'Escape') return false;
      if (framesState.get().pending) {
        cancelPlaceImage();
        c.requestDraw();
        return true;
      }
      if (framesState.get().cells && ui.get().tool === 'table') {
        framesState.set({ cells: null });
        c.requestDraw();
        return true;
      }
      return false;
    },

    draw(ctx, color) {
      const doc = editor.doc;
      const v = c.view;
      ctx.save();
      // Cadres d'image vides : une croix d'attente, à l'écran seulement (rien à l'export).
      const frames = emptyFramesOf(doc);
      if (frames.length) {
        ctx.save();
        ctx.translate(v.panX, v.panY);
        ctx.scale(v.zoom, v.zoom);
        ctx.lineWidth = 1 / v.zoom;
        ctx.strokeStyle = 'rgba(128, 134, 145, 0.85)';
        for (const g of frames) {
          const m = g.children[0];
          const s = c.toScreen({ x: m.x, y: m.y });
          if (s.x > c.width || s.y > c.height) continue;
          const e = c.toScreen({ x: m.x + m.width, y: m.y + m.height });
          if (e.x < 0 && e.y < 0) continue;
          ctx.save();
          const mt = localMatrix(m);
          ctx.transform(mt.a, mt.b, mt.c, mt.d, mt.e, mt.f);
          ctx.stroke(nodePath(m));
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(m.width, m.height);
          ctx.moveTo(m.width, 0);
          ctx.lineTo(0, m.height);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }
      // Image d'un cadre sélectionnée : sa partie cachée apparaît en transparence.
      const sel = editor.selection;
      const f = sel.length === 1 ? selectedFrame(doc, sel) : null;
      if (f?.image && sel[0] === f.image.id) {
        const n = f.image;
        const img = c.images.get(doc, n.assetId);
        if (img) {
          ctx.save();
          ctx.translate(v.panX, v.panY);
          ctx.scale(v.zoom, v.zoom);
          const area = new Path2D();
          const im = localMatrix(n);
          const box = new Path2D();
          box.rect(0, 0, n.width, n.height);
          area.addPath(box, im);
          const mask = f.frame.children[0];
          area.addPath(nodePath(mask), localMatrix(mask));
          ctx.clip(area, 'evenodd');
          ctx.globalAlpha = 0.35;
          ctx.transform(im.a, im.b, im.c, im.d, im.e, im.f);
          const cr = n.crop;
          const iw = (img as HTMLImageElement).naturalWidth || img.width,
            ih = (img as HTMLImageElement).naturalHeight || img.height;
          if (cr)
            ctx.drawImage(img, cr.x * iw, cr.y * ih, cr.width * iw, cr.height * ih, 0, 0, n.width, n.height);
          else ctx.drawImage(img, 0, 0, n.width, n.height);
          ctx.restore();
        }
      }
      // Image en attente : sa boîte pendant le glisser, une vignette au pointeur sinon.
      const g = gesture;
      const pending = framesState.get().pending;
      if (pending && ui.get().tool === 'image') {
        const img = pendingImage();
        if (g?.kind === 'place' && g.moved) {
          const b = placeBox(g);
          const a = c.toScreen(b);
          const w = b.width * v.zoom,
            h = b.height * v.zoom;
          if (img) {
            ctx.globalAlpha = 0.6;
            ctx.drawImage(img, a.x, a.y, w, h);
            ctx.globalAlpha = 1;
          }
          ctx.strokeStyle = color;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
          ctx.setLineDash([]);
        } else if (hover && img) {
          const s = c.toScreen(hover);
          const k = 72 / Math.max(pending.width, pending.height);
          ctx.globalAlpha = 0.75;
          ctx.drawImage(img, s.x + 14, s.y + 14, pending.width * k, pending.height * k);
          ctx.globalAlpha = 1;
        }
      }
      // Nouveau tableau : sa grille pendant le glisser.
      if (g?.kind === 'table' && g.moved) {
        const b = rectFrom(g.start, g.current);
        const a = c.toScreen(b);
        const w = b.width * v.zoom,
          h = b.height * v.zoom;
        const { rows, cols } = framesState.get();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= cols; i++) {
          ctx.moveTo(Math.round(a.x + (w * i) / cols) + 0.5, a.y);
          ctx.lineTo(Math.round(a.x + (w * i) / cols) + 0.5, a.y + h);
        }
        for (let i = 0; i <= rows; i++) {
          ctx.moveTo(a.x, Math.round(a.y + (h * i) / rows) + 0.5);
          ctx.lineTo(a.x + w, Math.round(a.y + (h * i) / rows) + 0.5);
        }
        ctx.stroke();
      }
      // Cellules choisies d'un tableau.
      const cells = ui.get().tool === 'table' ? framesState.get().cells : null;
      const table = cells ? findNode(doc, cells.tableId)?.node : null;
      if (cells && isTable(table)) {
        const { r0, c0, r1, c1 } = cells.range;
        ctx.save();
        ctx.translate(v.panX, v.panY);
        ctx.scale(v.zoom, v.zoom);
        ctx.fillStyle = 'rgba(77, 163, 255, 0.16)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / v.zoom;
        for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
          for (let k = Math.min(c0, c1); k <= Math.max(c0, c1); k++) {
            if (r >= table.table.rows || k >= table.table.cols) continue;
            const rect = cellRect(table, r, k);
            ctx.save();
            const mt = localMatrix(rect);
            ctx.transform(mt.a, mt.b, mt.c, mt.d, mt.e, mt.f);
            ctx.fillRect(0, 0, rect.width, rect.height);
            ctx.restore();
          }
        ctx.restore();
      }
      ctx.restore();
    },

    dispose() {
      window.removeEventListener('keydown', onTab, true);
    },
  };
}
