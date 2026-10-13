import {
  isLeftPage,
  masterOf,
  nodeBounds,
  pageMargins,
  type PoulpeDocument,
  type SceneNode,
} from '@poulpe/core';
import { nodePath } from '@poulpe/render';
import { t } from '../i18n';
import type { CanvasController } from './controller';

/*
 * Calques d'interface du canevas, en pixels d'écran : noms des plans de travail, contour des objets
 * survolés ou sélectionnés, marges des pages et fond perdu.
 */

export function drawArtboardLabels(ctl: CanvasController, doc: PoulpeDocument, activeId: string) {
  const ctx = ctl.ctx;
  ctx.save();
  ctx.font = '11px "Inter", system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  for (const ab of doc.artboards) {
    const p = ctl.toScreen(ab);
    ctx.fillStyle = ab.id === activeId ? ctl.colors.fg : ctl.colors.muted;
    ctx.font = `${ab.id === activeId ? 600 : 400} 11px "Inter", system-ui, sans-serif`;
    const label = ab.master
      ? `${ab.name} · ${t('pages.masterTag')}`
      : masterOf(doc, ab)
        ? `${ab.name} · ${masterOf(doc, ab)!.name}`
        : ab.name;
    ctx.fillText(label, p.x, p.y - 6);
    const w = ctx.measureText(label).width;
    ctx.fillStyle = ctl.colors.muted;
    ctx.font = '400 11px "Inter", system-ui, sans-serif';
    ctx.fillText(`${Math.round(ab.width)} × ${Math.round(ab.height)} px`, p.x + w + 8, p.y - 6);
  }
  ctx.restore();
}

export function outline(ctl: CanvasController, n: SceneNode, color: string, width: number) {
  const ctx = ctl.ctx;
  const v = ctl.view;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (n.type === 'group') {
    const b = nodeBounds(n);
    const a = ctl.toScreen(b);
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(a.x, a.y, b.width * v.zoom, b.height * v.zoom);
  } else {
    ctx.translate(v.panX, v.panY);
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(n.x + n.width / 2, n.y + n.height / 2);
    ctx.rotate((n.rotation * Math.PI) / 180);
    ctx.translate(-n.width / 2, -n.height / 2);
    ctx.lineWidth = width / v.zoom;
    ctx.stroke(nodePath(n));
  }
  ctx.restore();
}

/** Marges des pages et limite du fond perdu (sur les pages, pas sur le reste du plan de travail). */
export function drawPageGuides(ctl: CanvasController, doc: PoulpeDocument) {
  const layout = doc.layout;
  if (!layout?.margins && !layout?.bleed) return;
  const ctx = ctl.ctx;
  ctx.save();
  ctx.lineWidth = 1;
  for (const ab of doc.artboards) {
    const m = pageMargins(doc, ab);
    if (m) {
      const a = ctl.toScreen({ x: ab.x + m.left, y: ab.y + m.top });
      const b = ctl.toScreen({ x: ab.x + ab.width - m.right, y: ab.y + ab.height - m.bottom });
      ctx.strokeStyle = 'rgba(214,92,214,0.8)';
      ctx.strokeRect(
        Math.round(a.x) + 0.5,
        Math.round(a.y) + 0.5,
        Math.round(b.x - a.x),
        Math.round(b.y - a.y),
      );
    }
    if (layout.bleed && !ab.master) {
      const k = layout.bleed;
      // En vis-à-vis, pas de fond perdu du côté de la reliure.
      const left = isLeftPage(doc, ab);
      const facing = !!layout.facing;
      const a = ctl.toScreen({ x: ab.x - (facing && !left ? 0 : k), y: ab.y - k });
      const b = ctl.toScreen({ x: ab.x + ab.width + (facing && left ? 0 : k), y: ab.y + ab.height + k });
      ctx.strokeStyle = 'rgba(229,72,77,0.7)';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        Math.round(a.x) + 0.5,
        Math.round(a.y) + 0.5,
        Math.round(b.x - a.x),
        Math.round(b.y - a.y),
      );
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}
