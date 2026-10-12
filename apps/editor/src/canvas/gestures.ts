import {
  boxCenter,
  createEllipse,
  createLine,
  createPolygon,
  createRect,
  createStar,
  createText,
  findArtboard,
  findNode,
  localToWorld,
  nodeBounds,
  scaleNode,
  scaleTextSize,
  translateNode,
  worldToLocal,
  type Box,
  type ImageNode,
  type PoulpeDocument,
  type SceneNode,
  type Vec,
} from '@poulpe/core';
import { NEW_SHAPE_TOOLS, makeShapeNode } from '../tools/shapes/make';
import { t } from '../i18n';
import { editor, ui, type ToolId } from '../store';
import * as moveTool from '../tools/move/hooks';
import type { CanvasController } from './controller';
import { HANDLES, type Frame, type HandleId } from './handles';
import { snapMove, snapPoint, type SnapLines } from './snapping';
import { isFrameText } from './textFrames';

/*
 * Gestes de base du canevas : leur état (`CanvasController.gesture`) et les glissements qui
 * déplacent, redimensionnent ou créent des objets. Le routage du pointeur est dans pointer.ts, le
 * recadrage dans crop.ts.
 */

export type Gesture =
  | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number }
  | {
      kind: 'move';
      start: Vec;
      ids: string[];
      box: Box;
      lines: SnapLines;
      clones: SceneNode[] | null;
      moved: boolean;
      recipe?: (d: PoulpeDocument) => string[] | undefined;
    }
  | {
      kind: 'resize';
      handle: HandleId;
      frame: Frame;
      ids: string[];
      single: SceneNode | null;
      lines: SnapLines;
    }
  | { kind: 'rotate'; center: Vec; startAngle: number; ids: string[] }
  | { kind: 'marquee'; start: Vec; current: Vec; additive: boolean; base: string[] }
  | { kind: 'create'; tool: ToolId; start: Vec; artboardId: string; nodeId: string | null; lines: SnapLines }
  | { kind: 'artboardCreate'; start: Vec; current: Vec }
  | { kind: 'cropResize'; handle: HandleId; node: ImageNode; full: Box }
  | { kind: 'cropPan'; start: Vec; node: ImageNode; full: Box; moved: boolean }
  | { kind: 'artboardMove'; id: string; start: Vec; origin: Vec; moved: boolean };

export const SHAPE_TOOLS: ToolId[] = ['rect', 'ellipse', 'polygon', 'star', 'line', ...NEW_SHAPE_TOOLS];

export function dragMove(
  ctl: CanvasController,
  g: Extract<Gesture, { kind: 'move' }>,
  p: Vec,
  shift: boolean,
  snap: boolean,
) {
  let dx = p.x - g.start.x,
    dy = p.y - g.start.y;
  if (!g.moved && Math.hypot(dx, dy) * ctl.view.zoom < 3) return;
  g.moved = true;
  if (shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
  ctl.guides = [];
  if (snap) {
    const r = snapMove(g.box, dx, dy, g.lines, ctl.snapThreshold(), ctl.gridStep());
    if (!shift || dx) dx = r.dx;
    if (!shift || dy) dy = r.dy;
    ctl.guides = r.guides;
  }
  const clones = g.clones;
  g.recipe = (d) => {
    let ids = g.ids;
    if (clones) {
      ids = clones.map((c, i) => {
        const loc = findNode(d, g.ids[i])!;
        // Une copie neuve à chaque aperçu : immer fige les objets ajoutés au document.
        loc.parent.children.splice(loc.index + 1, 0, structuredClone(c));
        return c.id;
      });
    }
    for (const id of ids) translateNode(findNode(d, id)!.node, dx, dy);
    return clones ? ids : undefined;
  };
  editor.preview(g.recipe);
}

export function dragResize(
  ctl: CanvasController,
  g: Extract<Gesture, { kind: 'resize' }>,
  pRaw: Vec,
  keepRatio: boolean,
  fromCenter: boolean,
  snap: boolean,
) {
  const f = g.frame;
  const [hx, hy] = HANDLES[g.handle];
  let p = pRaw;
  ctl.guides = [];
  if (snap && !f.rotation) {
    const s = snapPoint(pRaw, g.lines, ctl.snapThreshold(), ctl.gridStep());
    p = { x: hx === 0.5 ? pRaw.x : s.x, y: hy === 0.5 ? pRaw.y : s.y };
    ctl.guides = s.guides.filter((gd) => (gd.axis === 'x' ? hx !== 0.5 : hy !== 0.5));
  }
  const l = worldToLocal(f, p);
  const text = g.single?.type === 'text' ? g.single : null;
  const corner = hx !== 0.5 && hy !== 0.5;
  // Un texte artistique s'agrandit proportionnellement par les coins.
  if (text?.autoWidth && corner) keepRatio = true;
  // À partir du centre : du point d'origine de la transformation s'il est affiché.
  const pivot = fromCenter ? (moveTool.pivotLocal(f) ?? { x: f.width / 2, y: f.height / 2 }) : null;
  const ax = pivot ? pivot.x : (1 - hx) * f.width;
  const ay = pivot ? pivot.y : (1 - hy) * f.height;
  // Rapport d'échelle depuis l'origine sur un axe (null : l'origine est sur l'axe de la poignée).
  const ratio = (a: number, b: number) => (Math.abs(b) > 1e-9 ? Math.abs(a / b) : null);
  const kx = pivot ? ratio(l.x - ax, hx * f.width - ax) : null;
  const ky = pivot ? ratio(l.y - ay, hy * f.height - ay) : null;
  let x0 = 0,
    x1 = f.width,
    y0 = 0,
    y1 = f.height;
  if (hx !== 0.5) {
    const edge = l.x;
    if (pivot) {
      const k = kx ?? 1;
      x0 = ax - ax * k;
      x1 = ax + (f.width - ax) * k;
    } else [x0, x1] = hx === 1 ? [ax, edge] : [edge, ax];
  }
  if (hy !== 0.5) {
    const edge = l.y;
    if (pivot) {
      const k = ky ?? 1;
      y0 = ay - ay * k;
      y1 = ay + (f.height - ay) * k;
    } else [y0, y1] = hy === 1 ? [ay, edge] : [edge, ay];
  }
  let sx = f.width ? (x1 - x0) / f.width : 1;
  let sy = f.height ? (y1 - y0) / f.height : 1;
  if (keepRatio) {
    let k = corner ? Math.max(Math.abs(sx), Math.abs(sy)) : hx !== 0.5 ? Math.abs(sx) : Math.abs(sy);
    // Origine sur l'axe de la poignée : cet axe ne mesure rien (l'objet ne ferait que grandir),
    // le rapport de l'autre axe décide.
    if (pivot && (kx === null || ky === null)) k = (hx !== 0.5 ? kx : ky) ?? (hx !== 0.5 ? ky : kx) ?? k;
    sx = Math.sign(sx || 1) * k;
    sy = Math.sign(sy || 1) * k;
    const w = f.width * sx,
      h = f.height * sy;
    if (pivot) {
      x0 = ax - (ax * w) / (f.width || 1);
      y0 = ay - (ay * h) / (f.height || 1);
    } else {
      x0 = hx === 0 ? ax - w : hx === 1 ? ax : ax - w / 2;
      y0 = hy === 0 ? ay - h : hy === 1 ? ay : ay - h / 2;
      if (hx === 0.5) x0 = (f.width - w) / 2;
      if (hy === 0.5) y0 = (f.height - h) / 2;
    }
    x1 = x0 + w;
    y1 = y0 + h;
  }
  editor.preview((d) => {
    if (g.single) {
      const n = findNode(d, g.single.id)!.node;
      const nx0 = Math.min(x0, x1),
        ny0 = Math.min(y0, y1);
      const w = Math.max(1, Math.abs(x1 - x0)),
        h = Math.max(1, Math.abs(y1 - y0));
      const c = localToWorld(f, { x: nx0 + w / 2, y: ny0 + h / 2 });
      if (n.type === 'text' && g.single.type === 'text') {
        if (n.autoWidth && corner) {
          n.style = g.single.style;
          n.runs = g.single.runs;
          scaleTextSize(n, Math.abs(sy));
        } else if (hx === 0.5 && !isFrameText(d, n)) return;
        else n.autoWidth = false;
      }
      n.width = w;
      n.height = h;
      n.x = c.x - w / 2;
      n.y = c.y - h / 2;
      if (n.type === 'line' && g.single.type === 'line') {
        const flipped = x1 < x0 !== y1 < y0;
        n.direction = flipped ? (g.single.direction === 1 ? -1 : 1) : g.single.direction;
      }
      return;
    }
    const origin = localToWorld(f, { x: ax, y: ay });
    const sxx = (x1 - x0) / (f.width || 1);
    const syy = (y1 - y0) / (f.height || 1);
    const apart = moveTool.separately(g.ids.length);
    for (const id of g.ids) {
      const n = findNode(d, id)!.node;
      scaleNode(
        n,
        hx === 0.5 && !keepRatio ? 1 : sxx,
        hy === 0.5 && !keepRatio ? 1 : syy,
        apart ? boxCenter(nodeBounds(n)) : origin,
        keepRatio,
      );
    }
  });
}

export function dragCreate(
  ctl: CanvasController,
  g: Extract<Gesture, { kind: 'create' }>,
  pRaw: Vec,
  shift: boolean,
  alt: boolean,
  snap: boolean,
) {
  ctl.guides = [];
  let p = pRaw;
  if (snap) {
    const s = snapPoint(pRaw, g.lines, ctl.snapThreshold(), ctl.gridStep());
    p = s;
    ctl.guides = s.guides;
  }
  let dx = p.x - g.start.x,
    dy = p.y - g.start.y;
  if (!g.nodeId && Math.hypot(dx, dy) * ctl.view.zoom < 3) return;
  if (g.tool === 'line') {
    if (shift) {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      dx = Math.cos(ang) * len;
      dy = Math.sin(ang) * len;
    }
  } else if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  let box: Box;
  if (alt && g.tool !== 'line')
    box = {
      x: g.start.x - Math.abs(dx),
      y: g.start.y - Math.abs(dy),
      width: Math.abs(dx) * 2,
      height: Math.abs(dy) * 2,
    };
  else box = rectFrom(g.start, { x: g.start.x + dx, y: g.start.y + dy });
  const node = g.nodeId ? null : makeNode(g.tool, box, Math.sign(dx) * Math.sign(dy) < 0 ? -1 : 1);
  if (node) {
    g.nodeId = node.id;
    editor.begin();
  }
  const id = g.nodeId!;
  const fresh = node;
  const dir: 1 | -1 = Math.sign(dx) * Math.sign(dy) < 0 ? -1 : 1;
  editor.preview((d) => {
    let n = findNode(d, id)?.node;
    if (!n) {
      const ab = findArtboard(d, g.artboardId)!;
      ab.children.push(fresh ?? makeNode(g.tool, box, dir));
      n = ab.children[ab.children.length - 1];
      n.id = id;
    }
    n.x = box.x;
    n.y = box.y;
    n.width = Math.max(1, box.width);
    n.height = g.tool === 'line' ? box.height : Math.max(1, box.height);
    if (n.type === 'line') n.direction = dir;
    if (n.type === 'text') {
      n.autoWidth = false;
      // Outil Cadre de texte (et Persona Mise en page) : un cadre de texte.
      if (g.tool === 'frameText' || ui.get().persona === 'layout') n.frame = true;
    }
    return [id];
  });
}

export function makeNode(tool: ToolId, box: Box, direction: 1 | -1): SceneNode {
  const d = ui.get().defaults;
  switch (tool) {
    case 'rect': {
      const r = createRect({ ...box, name: t('name.rect') }, d);
      r.cornerRadius = d.cornerRadius;
      return r;
    }
    case 'ellipse':
      return createEllipse({ ...box, name: t('name.ellipse') }, d);
    case 'polygon':
      return createPolygon({ ...box, name: t('name.polygon') }, d, d.sides);
    case 'star':
      return createStar({ ...box, name: t('name.star') }, d, d.points, d.innerRatio);
    case 'line':
      return createLine({ ...box, direction, name: t('name.line') }, d);
    default:
      return makeShapeNode(tool, box) ?? createText({ ...box, name: t('name.text'), autoWidth: false }, d);
  }
}

export function rectFrom(a: Vec, b: Vec): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
