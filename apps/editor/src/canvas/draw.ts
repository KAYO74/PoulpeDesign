import { findNode, type Artboard, type PoulpeDocument, type SceneNode, softProofPixels } from '@poulpe/core';
import { recordFrame } from '../perf';
import { editor, ui } from '../store';
import type { CanvasController } from './controller';
import { drawCropGhost } from './crop';
import { drawDocGuides } from './docGuides';
import { SHAPE_TOOLS, rectFrom } from './gestures';
import { drawHandles } from './handles';
import { drawArtboardLabels, drawPageGuides, outline } from './overlays';
import { drawFrames, drawTextSelection } from './textFrames';

/*
 * Dessin du canevas : le fond, les plans de travail (ombre, damier, contenu gardé en images par le
 * cache de rendu, grille), l'épreuvage à l'écran, puis les calques d'interface en pixels d'écran
 * (repères, contours, cadres de texte, poignées, outils, rectangle de sélection, magnétisme).
 */

/** Délai après un zoom ou un défilement avant de redessiner net. */
const SETTLE_MS = 140;

/** Objets du premier niveau des plans de travail, par id de tout objet qu'ils contiennent. */
const topLevelCache = new WeakMap<PoulpeDocument, Map<string, string>>();
function topLevelOf(doc: PoulpeDocument): Map<string, string> {
  let map = topLevelCache.get(doc);
  if (map) return map;
  map = new Map();
  const visit = (nodes: SceneNode[], top: string) => {
    for (const n of nodes) {
      map!.set(n.id, top);
      if (n.type === 'group') visit(n.children, top);
    }
  };
  for (const ab of doc.artboards) for (const n of ab.children) visit([n], n.id);
  topLevelCache.set(doc, map);
  return map;
}

export function draw(ctl: CanvasController): void {
  const t0 = performance.now();
  const ctx = ctl.ctx;
  const { doc, selection, activeArtboardId } = editor.getState();
  const { view, settings, editingTextId, cropId, perspectiveId, maskEditId } = ui.get();
  const dpr = ctl.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = ctl.colors.pasteboard;
  ctx.fillRect(0, 0, ctl.width, ctl.height);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.panX, dpr * view.panY);
  // Objets susceptibles de changer à chaque image : ils sont dessinés en direct, le reste vient du cache.
  const top = topLevelOf(doc);
  const hot = new Set<string>();
  for (const id of [...selection, editingTextId, cropId, perspectiveId, maskEditId]) {
    const t = id && top.get(id);
    if (t) hot.add(t);
  }
  const cacheView = {
    scale: dpr * view.zoom,
    ox: dpr * view.panX,
    oy: dpr * view.panY,
    width: ctl.canvas.width,
    height: ctl.canvas.height,
  };
  const allowStale = t0 - ctl.viewChangedAt < SETTLE_MS;
  let stale = false;
  ctl.cache.prune(doc);
  for (const ab of doc.artboards) {
    // Plan de travail hors de l'écran : rien à dessiner.
    const sx = ab.x * view.zoom + view.panX,
      sy = ab.y * view.zoom + view.panY;
    if (
      sx > ctl.width + 40 ||
      sy > ctl.height + 40 ||
      sx + ab.width * view.zoom < -40 ||
      sy + ab.height * view.zoom < -40
    )
      continue;
    drawArtboardShadow(ctl, sx * dpr, sy * dpr, ab.width * view.zoom * dpr, ab.height * view.zoom * dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ab.x, ab.y, ab.width, ab.height);
    if (ab.background.type === 'none') drawChecker(ctl, ab);
    stale =
      ctl.cache.drawArtboard(
        ctx,
        doc,
        ab,
        { images: ctl.images, editingId: editingTextId },
        cacheView,
        hot,
        allowStale,
      ) || stale;
    if (settings.grid) drawGrid(ctl, ab);
  }
  // Aperçu étiré pendant un zoom : redessiné net quand le geste s'arrête.
  clearTimeout(ctl.refreshTimer);
  if (stale) ctl.refreshTimer = setTimeout(() => ctl.requestDraw(), SETTLE_MS);
  if (ui.get().softProof) softProof(ctl, doc);
  // Calques d'interface, en pixels d'écran.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (settings.rulers) drawPageGuides(ctl, doc);
  drawArtboardLabels(ctl, doc, activeArtboardId);
  if (doc.guides && settings.rulers) drawDocGuides(ctl, doc.guides);
  const tool = ui.get().tool;
  if (ctl.hoverId && !selection.includes(ctl.hoverId)) {
    const n = findNode(doc, ctl.hoverId)?.node;
    if (n) outline(ctl, n, ctl.colors.sel, 1);
  }
  for (const id of selection) {
    const n = findNode(doc, id)?.node;
    if (n) outline(ctl, n, ctl.colors.sel, 1);
  }
  drawFrames(ctl, doc, selection);
  if (editingTextId) drawTextSelection(ctl, doc, editingTextId);
  const crop = ctl.cropNode();
  if (crop) drawCropGhost(ctl, doc, crop);
  if (!editingTextId && (tool === 'select' || tool === 'direct' || SHAPE_TOOLS.includes(tool)))
    drawHandles(ctl);
  ctl.paths.draw(ctx, ctl.colors.sel);
  ctl.photo.draw(ctx);
  for (const m of ctl.modules) m.draw?.(ctx, ctl.colors.sel);
  const g = ctl.gesture;
  if (g?.kind === 'marquee' || g?.kind === 'artboardCreate') {
    const b = rectFrom(g.start, g.current);
    const a = ctl.toScreen(b);
    ctx.save();
    ctx.fillStyle = 'rgba(77,163,255,0.12)';
    ctx.strokeStyle = ctl.colors.sel;
    ctx.setLineDash(g.kind === 'marquee' ? [4, 3] : []);
    ctx.fillRect(a.x, a.y, b.width * view.zoom, b.height * view.zoom);
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.width * view.zoom, b.height * view.zoom);
    ctx.restore();
  }
  if (ctl.guides.length) {
    ctx.save();
    ctx.strokeStyle = ctl.colors.guide;
    ctx.lineWidth = 1;
    for (const gd of ctl.guides) {
      ctx.beginPath();
      if (gd.axis === 'x') {
        const x = Math.round(ctl.toScreen({ x: gd.pos, y: 0 }).x) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ctl.height);
      } else {
        const y = Math.round(ctl.toScreen({ x: 0, y: gd.pos }).y) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(ctl.width, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  recordFrame(performance.now() - t0);
  window.dispatchEvent(new Event('poulpe:drawn'));
}

/** Épreuvage à l'écran : les pages montrent les couleurs qu'elles auront une fois imprimées en CMJN. */
function softProof(ctl: CanvasController, doc: PoulpeDocument) {
  const { view } = ui.get();
  const k = ctl.dpr;
  const W = ctl.canvas.width,
    H = ctl.canvas.height;
  ctl.ctx.save();
  ctl.ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const ab of doc.artboards) {
    const x0 = Math.max(0, Math.floor((ab.x * view.zoom + view.panX) * k));
    const y0 = Math.max(0, Math.floor((ab.y * view.zoom + view.panY) * k));
    const x1 = Math.min(W, Math.ceil(((ab.x + ab.width) * view.zoom + view.panX) * k));
    const y1 = Math.min(H, Math.ceil(((ab.y + ab.height) * view.zoom + view.panY) * k));
    if (x1 <= x0 || y1 <= y0) continue;
    const img = ctl.ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    softProofPixels(img.data);
    ctl.ctx.putImageData(img, x0, y0);
  }
  ctl.ctx.restore();
}

/**
 * Ombre portée d'un plan de travail, en pixels du canevas. Un flou d'ombre (`shadowBlur`) sur un
 * grand rectangle coûte plus de 20 ms par image quand le moteur web dessine sans carte graphique
 * (WebKitGTK avec certains pilotes) : l'ombre d'un carré est floutée une seule fois, puis ses
 * coins sont recopiés et ses bords étirés, pour le même rendu.
 */
function drawArtboardShadow(ctl: CanvasController, x: number, y: number, w: number, h: number) {
  const ctx = ctl.ctx;
  const dpr = ctl.dpr;
  const blur = 18 * dpr;
  const offsetY = 4 * dpr;
  // Étendue du flou (trois écarts types) ; le carré floué fait 2e de côté, l'image 4e.
  const e = Math.ceil(1.5 * blur);
  if (w < 2 * e || h < 2 * e) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = offsetY;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    return;
  }
  if (ctl.shadowSprite?.dpr !== dpr) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4 * e;
    const c = canvas.getContext('2d')!;
    // Le carré est dessiné hors de l'image : seule son ombre y tombe.
    c.shadowColor = 'rgba(0,0,0,0.35)';
    c.shadowBlur = blur;
    c.shadowOffsetX = 8 * e;
    c.fillStyle = '#000';
    c.fillRect(e - 8 * e, e, 2 * e, 2 * e);
    ctl.shadowSprite = { canvas, dpr, e };
  }
  const img = ctl.shadowSprite.canvas;
  const s = 2 * e; // taille d'un coin dans l'image
  y += offsetY;
  const [x0, x1, y0, y1] = [x - e, x + w - e, y - e, y + h - e];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Coins.
  ctx.drawImage(img, 0, 0, s, s, x0, y0, s, s);
  ctx.drawImage(img, s, 0, s, s, x1, y0, s, s);
  ctx.drawImage(img, 0, s, s, s, x0, y1, s, s);
  ctx.drawImage(img, s, s, s, s, x1, y1, s, s);
  // Bords : une colonne (ou une ligne) du milieu de l'image, étirée.
  const mw = x1 - x0 - s;
  const mh = y1 - y0 - s;
  if (mw > 0) {
    ctx.drawImage(img, s - 1, 0, 1, s, x0 + s, y0, mw, s);
    ctx.drawImage(img, s - 1, s, 1, s, x0 + s, y1, mw, s);
  }
  if (mh > 0) {
    ctx.drawImage(img, 0, s - 1, s, 1, x0, y0 + s, s, mh);
    ctx.drawImage(img, s, s - 1, s, 1, x1, y0 + s, s, mh);
  }
  ctx.restore();
}

/** Damier de transparence : un motif de 16 px d'écran, au lieu de milliers de petits carrés. */
function drawChecker(ctl: CanvasController, ab: Artboard) {
  const ctx = ctl.ctx;
  if (!ctl.checker) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 16;
    const t = tile.getContext('2d')!;
    t.fillStyle = '#ffffff';
    t.fillRect(0, 0, 16, 16);
    t.fillStyle = '#e6e6e6';
    t.fillRect(8, 0, 8, 8);
    t.fillRect(0, 8, 8, 8);
    ctl.checker = ctx.createPattern(tile, 'repeat');
  }
  if (!ctl.checker) return;
  const s = 1 / ctl.view.zoom;
  // Le motif part du coin du plan de travail et garde sa taille à l'écran.
  ctl.checker.setTransform(new DOMMatrix().translate(ab.x, ab.y).scale(s, s));
  ctx.save();
  ctx.fillStyle = ctl.checker;
  ctx.fillRect(ab.x, ab.y, ab.width, ab.height);
  ctx.restore();
}

function drawGrid(ctl: CanvasController, ab: Artboard) {
  const ctx = ctl.ctx;
  const step = ctl.gridSpacing();
  const z = ctl.view.zoom;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ab.x, ab.y, ab.width, ab.height);
  ctx.clip();
  ctx.strokeStyle = 'rgba(77,163,255,0.25)';
  ctx.lineWidth = 1 / z;
  ctx.beginPath();
  for (let x = Math.ceil(ab.x / step) * step; x <= ab.x + ab.width; x += step) {
    ctx.moveTo(x, ab.y);
    ctx.lineTo(x, ab.y + ab.height);
  }
  for (let y = Math.ceil(ab.y / step) * step; y <= ab.y + ab.height; y += step) {
    ctx.moveTo(ab.x, y);
    ctx.lineTo(ab.x + ab.width, y);
  }
  ctx.stroke();
  ctx.restore();
}
