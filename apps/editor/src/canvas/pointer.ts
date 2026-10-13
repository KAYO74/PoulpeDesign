import {
  artboardAt,
  boxCenter,
  boxesIntersect,
  cloneWithNewIds,
  createArtboard,
  createText,
  findArtboard,
  findNode,
  localToWorld,
  nodeBounds,
  normalizeAngle,
  reparentToArtboards,
  rotateNode,
  selectionBounds,
  topLevelIds,
  translateNode,
  worldToLocal,
  type Vec,
} from '@poulpe/core';
import { cursorFor } from './cursors';
import { clickFrame } from '../tools/text/create';
import { setPaint } from '../actions';
import { t } from '../i18n';
import { importImage } from '../io';
import { editor, pushRecentColor, ui } from '../store';
import { collectSnapLines, idsWithDescendants, snapPoint } from './snapping';
import {
  beginTextEdit,
  editedTextId,
  endTextEdit,
  isEditingText,
  setTextSelection,
  textSelection,
} from './textEdit';
import { editParts, indexAtWorld } from './textParts';
import { startFrameLink } from '../tools/textFlow/delegate';
import { autoFlow } from '../tools/textFlow/actions';
import * as moveTool from '../tools/move/hooks';
import type { CanvasController } from './controller';
import { cropFull, dragCropPan, dragCropResize } from './crop';
import { hitGuide } from './docGuides';
import { SHAPE_TOOLS, dragCreate, dragMove, dragResize, makeNode, rectFrom } from './gestures';
import { handleCursor } from './handles';
import { rightUp } from './input';
import { hitOverflow } from './textFrames';

/*
 * Pointeur sur le canevas : chaque événement passe d'abord par l'édition de texte, la coulée du
 * texte et les outils (modules de la version 1.2, Persona Photo, outils de tracé), puis par les
 * gestes de base (vue, création, recadrage, transformation, rectangle de sélection) décrits dans
 * gestures.ts. Sans geste en cours, le survol met à jour l'objet éclairé et le curseur.
 */

export function onPointerDown(ctl: CanvasController, e: PointerEvent) {
  if (e.button === 1 || (e.button === 0 && ctl.effectiveTool() === 'hand')) {
    startPan(ctl, e);
    return;
  }
  if (e.button === 0 && ctl.effectiveTool() === 'zoom' && ctl.heldView) {
    // Zoom maintenu : avant les outils, qui ne voient pas le clic (leur travail en cours reste).
    const r = ctl.canvas.getBoundingClientRect();
    const z = ctl.view.zoom;
    ctl.zoomAt(e.altKey ? z / 1.5 : z * 1.5, e.clientX - r.left, e.clientY - r.top);
    return;
  }
  if (e.button === 2) {
    // Clic droit : menu du canevas au relâchement s'il n'y a pas eu de glissement.
    ctl.rightDown = { x: e.clientX, y: e.clientY };
    ctl.canvas.setPointerCapture(e.pointerId);
    if (ctl.paths.busy || ctl.photo.busy) return;
    const r = ctl.canvas.getBoundingClientRect();
    const s = { x: e.clientX - r.left, y: e.clientY - r.top };
    // Outil Nœud : glisser avec le bouton droit retire des nœuds de la sélection.
    if (ctl.effectiveTool() === 'direct' && ctl.paths.nodeSelectDown(e, ctl.toWorld(s.x, s.y), s))
      ctl.requestDraw();
    return;
  }
  if (e.button !== 0) return;
  ctl.canvas.setPointerCapture(e.pointerId);
  const rect = ctl.canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left,
    sy = e.clientY - rect.top;
  const p = ctl.toWorld(sx, sy);
  const tool = ctl.effectiveTool();
  const doc = editor.doc;

  if (isEditingText()) {
    // Un clic dans un autre cadre de la même chaîne y place le curseur.
    const parts = editParts(doc, editedTextId()!);
    const i = parts.length > 1 ? indexAtWorld(parts, p, false) : null;
    if (i !== null) {
      const sel = textSelection();
      setTextSelection(e.shiftKey && sel ? sel.start : i, i);
      ctl.requestDraw();
      return;
    }
    // Un clic hors du texte termine l'édition (la zone de texte gère elle-même les clics dedans).
    endTextEdit();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  // Choix du cadre suivant d'un texte qui déborde : un cadre existant, un nouveau cadre de même
  // taille ici, ou un cadre tracé en glissant (tools/textFlow).
  if (ui.get().linkFrom) {
    startFrameLink(ctl, p);
    ctl.requestDraw();
    return;
  }
  const overflowId = hitOverflow(ctl, sx, sy);
  if ((tool === 'select' || tool === 'text' || tool === 'frameText') && overflowId) {
    // Maj+clic : coulée automatique (pages et cadres ajoutés jusqu'à ce que le texte tienne).
    if (e.shiftKey) autoFlow(overflowId);
    else ui.set({ linkFrom: overflowId });
    ctl.updateCursor();
    return;
  }

  for (const m of ctl.modules) {
    if (m.pointerDown?.(e, p, { x: sx, y: sy })) {
      ctl.requestDraw();
      return;
    }
  }
  if (tool === 'zoom') {
    const z = ctl.view.zoom;
    ctl.zoomAt(e.altKey ? z / 1.5 : z * 1.5, sx, sy);
    return;
  }
  if (tool === 'eyedropper') {
    const px = ctl.ctx.getImageData(Math.round(sx * ctl.dpr), Math.round(sy * ctl.dpr), 1, 1).data;
    const hex = '#' + [px[0], px[1], px[2]].map((c) => c.toString(16).padStart(2, '0')).join('');
    // En Persona Photo, la pipette prend la couleur du pinceau.
    if (ui.get().persona === 'photo') ui.set({ brushColor: hex });
    else setPaint(ui.get().colorTarget, { type: 'solid', color: hex });
    pushRecentColor(hex);
    return;
  }
  if (ctl.photo.pointerDown(e, p, { x: sx, y: sy })) {
    ctl.requestDraw();
    return;
  }
  if (ctl.paths.pointerDown(e, p, { x: sx, y: sy })) {
    ctl.requestDraw();
    return;
  }
  if (tool === 'image') {
    void importImage();
    return;
  }
  if (tool === 'artboard') {
    const ab = artboardAt(doc, p);
    if (ab) {
      editor.setActiveArtboard(ab.id);
      editor.select([]);
      editor.begin();
      ctl.gesture = {
        kind: 'artboardMove',
        id: ab.id,
        start: p,
        origin: { x: ab.x, y: ab.y },
        moved: false,
      };
    } else {
      ctl.gesture = { kind: 'artboardCreate', start: p, current: p };
    }
    return;
  }
  if (tool === 'text' || tool === 'frameText') {
    const hit = ctl.hitTest(p, true);
    if (hit?.type === 'text') {
      editor.select([hit.id]);
      beginTextEdit(hit.id, false);
      return;
    }
    const ab = artboardAt(doc, p) ?? findArtboard(doc, editor.getState().activeArtboardId);
    if (!ab) return;
    ctl.gesture = {
      kind: 'create',
      tool,
      start: p,
      artboardId: ab.id,
      nodeId: null,
      lines: collectSnapLines(doc, new Set()),
    };
    return;
  }
  if (SHAPE_TOOLS.includes(tool)) {
    const ab = artboardAt(doc, p) ?? findArtboard(doc, editor.getState().activeArtboardId);
    if (!ab) return;
    const lines = collectSnapLines(doc, new Set());
    const start = ctl.snapping() ? snapPoint(p, lines, ctl.snapThreshold(), ctl.gridStep()) : p;
    ctl.gesture = {
      kind: 'create',
      tool,
      start: { x: start.x, y: start.y },
      artboardId: ab.id,
      nodeId: null,
      lines,
    };
    editor.setActiveArtboard(ab.id);
    return;
  }

  // Recadrage : les poignées changent le cadre, un glissement dedans déplace l'image.
  const crop = ctl.cropNode();
  if (crop) {
    const handle = ctl.hitHandle(sx, sy);
    const full = cropFull(crop);
    const l = worldToLocal(crop, p);
    if (handle && handle !== 'rotate') {
      editor.begin();
      ctl.gesture = { kind: 'cropResize', handle, node: crop, full };
      return;
    }
    if (l.x >= full.x && l.y >= full.y && l.x <= full.x + full.width && l.y <= full.y + full.height) {
      editor.begin();
      ctl.gesture = { kind: 'cropPan', start: p, node: crop, full, moved: false };
      return;
    }
    ui.set({ cropId: null });
  }

  // Outils de sélection.
  const handle = ctl.hitHandle(sx, sy);
  const guide = handle ? null : hitGuide(ctl, sx, sy);
  if (guide && (tool === 'select' || tool === 'direct')) {
    ctl.canvas.releasePointerCapture(e.pointerId);
    ctl.dragGuide(guide.axis, guide.index, e);
    return;
  }
  if (handle === 'rotate') {
    const f = ctl.selectionFrame()!;
    const pivot = moveTool.pivotLocal(f);
    const c = pivot ? localToWorld(f, pivot) : boxCenter(f);
    const ids = topLevelIds(doc, editor.selection);
    editor.begin();
    ctl.gesture = { kind: 'rotate', center: c, startAngle: Math.atan2(p.y - c.y, p.x - c.x), ids };
    return;
  }
  if (handle) {
    const f = ctl.selectionFrame()!;
    const ids = topLevelIds(doc, editor.selection);
    const single = ids.length === 1 ? findNode(doc, ids[0])!.node : null;
    editor.begin();
    ctl.gesture = {
      kind: 'resize',
      handle,
      frame: f,
      ids,
      single: single && single.type !== 'group' ? single : null,
      lines: collectSnapLines(doc, idsWithDescendants(doc, ids)),
    };
    return;
  }
  const hit = moveTool.clickTarget(ctl, p, tool, e);
  if (hit) {
    let selection = editor.selection;
    if (e.shiftKey) {
      selection = selection.includes(hit.id)
        ? selection.filter((id) => id !== hit.id)
        : [...selection, hit.id];
      editor.select(selection);
      if (!selection.includes(hit.id)) return;
    } else if (!selection.includes(hit.id)) {
      selection = [hit.id];
      editor.select(selection);
    }
    const ids = topLevelIds(doc, selection).filter((id) => !findNode(doc, id)?.node.locked);
    if (!ids.length) return;
    const box = selectionBounds(doc, ids)!;
    editor.begin();
    ctl.gesture = {
      kind: 'move',
      start: p,
      ids,
      box,
      lines: collectSnapLines(doc, idsWithDescendants(doc, ids)),
      clones: e.altKey ? ids.map((id) => cloneWithNewIds(findNode(doc, id)!.node)) : null,
      moved: false,
    };
    return;
  }
  const ab = artboardAt(doc, p);
  if (ab) editor.setActiveArtboard(ab.id);
  ctl.gesture = {
    kind: 'marquee',
    start: p,
    current: p,
    additive: e.shiftKey,
    base: e.shiftKey ? editor.selection : [],
  };
  if (!e.shiftKey) editor.select([]);
}

function startPan(ctl: CanvasController, e: PointerEvent) {
  ctl.canvas.setPointerCapture(e.pointerId);
  const v = ctl.view;
  ctl.gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, panX: v.panX, panY: v.panY };
  ctl.canvas.style.cursor = 'grabbing';
}

export function onPointerMove(ctl: CanvasController, e: PointerEvent) {
  const rect = ctl.canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left,
    sy = e.clientY - rect.top;
  const p = ctl.toWorld(sx, sy);
  ctl.lastPointer = { x: sx, y: sy };
  ui.set({ cursor: { x: Math.round(p.x), y: Math.round(p.y) } });
  if (!ctl.gesture && ctl.modules.some((m) => m.pointerMove?.(e, p, { x: sx, y: sy }))) {
    ctl.requestDraw();
    return;
  }
  if (!ctl.gesture && ctl.photo.pointerMove(e, p, { x: sx, y: sy })) return;
  if (!ctl.gesture && ctl.paths.pointerMove(e, p, { x: sx, y: sy })) {
    if (ctl.effectiveTool() === 'direct') ctl.canvas.style.cursor = cursorFor('direct');
    return;
  }
  const g = ctl.gesture;
  if (!g) {
    updateHover(ctl, p, sx, sy);
    return;
  }
  const snap = ctl.snapping() && !e.ctrlKey;
  switch (g.kind) {
    case 'pan':
      ui.set({ view: { ...ctl.view, panX: g.panX + e.clientX - g.sx, panY: g.panY + e.clientY - g.sy } });
      return;
    case 'move':
      return dragMove(ctl, g, p, e.shiftKey, snap);
    case 'resize':
      // Ctrl (comme dans Affinity) ou Alt : à partir du centre ou du point d'origine.
      return dragResize(ctl, g, p, e.shiftKey, e.altKey || e.ctrlKey || e.metaKey, ctl.snapping());
    case 'rotate': {
      let delta = ((Math.atan2(p.y - g.center.y, p.x - g.center.x) - g.startAngle) * 180) / Math.PI;
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;
      const apart = moveTool.separately(g.ids.length);
      editor.preview((d) => {
        for (const id of g.ids) {
          const n = findNode(d, id)!.node;
          rotateNode(n, normalizeAngle(delta), apart ? boxCenter(nodeBounds(n)) : g.center);
        }
      });
      return;
    }
    case 'marquee': {
      g.current = p;
      const box = rectFrom(g.start, p);
      const doc = editor.doc;
      const inside = doc.artboards
        .flatMap((ab) => ab.children)
        .filter((n) => n.visible && !n.locked && boxesIntersect(nodeBounds(n), box))
        .map((n) => n.id);
      editor.select([...new Set([...g.base, ...inside])]);
      ctl.requestDraw();
      return;
    }
    case 'create':
      // Comme dans Affinity : Ctrl part du centre, Alt ignore le magnétisme.
      return dragCreate(ctl, g, p, e.shiftKey, e.ctrlKey || e.metaKey, ctl.snapping() && !e.altKey);
    case 'cropResize':
      return dragCropResize(g, p);
    case 'cropPan':
      return dragCropPan(ctl, g, p);
    case 'artboardCreate':
      g.current = p;
      ctl.requestDraw();
      return;
    case 'artboardMove': {
      let dx = p.x - g.start.x,
        dy = p.y - g.start.y;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      g.moved = true;
      editor.preview((d) => {
        const ab = findArtboard(d, g.id)!;
        const nx = Math.round(g.origin.x + dx),
          ny = Math.round(g.origin.y + dy);
        ab.children.forEach((n) => translateNode(n, nx - ab.x, ny - ab.y));
        ab.x = nx;
        ab.y = ny;
      });
      return;
    }
  }
}

export function onPointerUp(ctl: CanvasController, e: PointerEvent) {
  if (e.button === 2) {
    if (ctl.canvas.hasPointerCapture(e.pointerId)) ctl.canvas.releasePointerCapture(e.pointerId);
    if (!ctl.gesture) ctl.paths.pointerUp();
    ctl.requestDraw();
    rightUp(ctl, e);
    return;
  }
  const g = ctl.gesture;
  ctl.gesture = null;
  ctl.guides = [];
  if (ctl.canvas.hasPointerCapture(e.pointerId)) ctl.canvas.releasePointerCapture(e.pointerId);
  if (!g) {
    const r = ctl.canvas.getBoundingClientRect();
    const s = { x: e.clientX - r.left, y: e.clientY - r.top };
    const at = ctl.toWorld(s.x, s.y);
    if (ctl.modules.some((m) => m.pointerUp?.(e, at, s))) {
      ctl.requestDraw();
      return;
    }
  }
  if (!g && ctl.photo.pointerUp()) {
    ctl.requestDraw();
    return;
  }
  if (!g && ctl.paths.pointerUp()) {
    ctl.requestDraw();
    return;
  }
  if (!g) return;
  const rect = ctl.canvas.getBoundingClientRect();
  const p = ctl.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  switch (g.kind) {
    case 'pan':
      ctl.updateCursor();
      break;
    case 'move':
      if (!g.moved) {
        editor.cancel();
        // Alt + clic sans glisser : l'objet de dessous.
        if (g.clones) moveTool.altClick(ctl);
        break;
      }
      // Un objet glissé sur un autre plan de travail y est rattaché.
      editor.preview((d) => {
        const ids = g.recipe?.(d);
        reparentToArtboards(d, ids ?? g.ids);
        return ids;
      });
      editor.commit(g.clones ? 'history.duplicate' : 'history.move');
      if (g.clones) moveTool.noteDuplicate(g.ids, editor.selection);
      break;
    case 'resize':
      editor.commit('history.resize');
      break;
    case 'rotate':
      editor.commit('history.rotate');
      moveTool.keepPivot(ctl, g.center);
      break;
    case 'marquee':
      break;
    case 'cropResize':
      editor.commit('history.crop');
      break;
    case 'cropPan':
      if (g.moved) editor.commit('history.crop');
      else editor.cancel();
      break;
    case 'artboardMove':
      if (g.moved) editor.commit('history.artboard');
      else editor.cancel();
      break;
    case 'artboardCreate': {
      const box = rectFrom(g.start, p);
      if (box.width * ctl.view.zoom < 4 || box.height * ctl.view.zoom < 4) break;
      const ab = createArtboard({
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        name: t('name.artboard', { n: editor.doc.artboards.length + 1 }),
      });
      editor.apply('history.artboard', (d) => {
        d.artboards.push(ab);
        return [];
      });
      editor.setActiveArtboard(ab.id);
      break;
    }
    case 'create':
      if (g.nodeId) {
        editor.commit('history.add');
        if (g.tool === 'text' || g.tool === 'frameText') beginTextEdit(g.nodeId, false);
        break;
      }
      // Simple clic : cadre de texte ou texte artistique, ou forme de taille par défaut.
      if (g.tool === 'frameText') clickFrame(g.start, g.artboardId);
      else if (g.tool === 'text') {
        const d = ui.get().defaults;
        const node = createText(
          {
            x: g.start.x,
            y: g.start.y - d.text.fontSize * 0.6,
            width: 10,
            height: d.text.fontSize,
            name: t('name.text'),
            autoWidth: true,
          },
          d,
        );
        beginTextEdit(node.id, true, node, g.artboardId);
      } else {
        const size = 100;
        const box =
          g.tool === 'line'
            ? { x: g.start.x, y: g.start.y, width: size, height: 0 }
            : { x: g.start.x - size / 2, y: g.start.y - size / 2, width: size, height: size };
        const node = makeNode(g.tool, box, 1);
        editor.apply('history.add', (d) => {
          findArtboard(d, g.artboardId)!.children.push(node);
          return [node.id];
        });
      }
      break;
  }
  ctl.requestDraw();
}

export function onPointerCancel(ctl: CanvasController) {
  ctl.paths.pointerCancel();
  ctl.photo.pointerCancel();
  ctl.modules.forEach((m) => m.cancel?.());
  if (ctl.gesture && ctl.gesture.kind !== 'pan' && ctl.gesture.kind !== 'marquee') editor.cancel();
  ctl.gesture = null;
  ctl.guides = [];
  ctl.requestDraw();
}

export function onPointerLeave(ctl: CanvasController) {
  ui.set({ cursor: null });
  ctl.photo.pointerLeave();
  if (ctl.hoverId) {
    ctl.hoverId = null;
    ctl.requestDraw();
  }
}

function updateHover(ctl: CanvasController, p: Vec, sx: number, sy: number) {
  const tool = ctl.effectiveTool();
  let hover: string | null = null;
  let cursor = '';
  const crop = tool === 'select' || tool === 'direct' ? ctl.cropNode() : null;
  if (crop) {
    const h = ctl.hitHandle(sx, sy);
    const full = cropFull(crop);
    const l = worldToLocal(crop, p);
    const inside =
      l.x >= full.x && l.y >= full.y && l.x <= full.x + full.width && l.y <= full.y + full.height;
    ctl.canvas.style.cursor =
      h && h !== 'rotate' ? handleCursor(h, crop.rotation) : inside ? 'move' : 'default';
    return;
  }
  if (tool === 'select' || tool === 'direct') {
    const h = ctl.hitHandle(sx, sy);
    const guide = h ? null : hitGuide(ctl, sx, sy);
    if (guide) cursor = guide.axis === 'x' ? 'col-resize' : 'row-resize';
    else if (h === 'rotate') cursor = 'grab';
    else if (h) cursor = handleCursor(h, ctl.selectionFrame()?.rotation ?? 0);
    else hover = moveTool.clickTarget(ctl, p, tool, null)?.id ?? null;
  }
  ctl.canvas.style.cursor = cursor || ctl.toolCursor(tool);
  if (hover !== ctl.hoverId) {
    ctl.hoverId = hover;
    ctl.requestDraw();
  }
}
