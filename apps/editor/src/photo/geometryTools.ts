import { findNode, warpPerspective, type Vec } from '@poulpe/core';
import type { CanvasController } from '../canvas/controller';
import { t } from '../i18n';
import { editor, toast, ui } from '../store';
import { targetPixels } from './paintTarget';
import { commitBitmap, imageAt, localToDoc, makeCanvas, selectedImage } from './pixels';

/*
 * Redressement et correction de perspective de la Persona Photo : ces outils transforment le calque
 * entier. PhotoTools leur transmet les gestes du pointeur et les touches.
 */

export class GeometryTools {
  // Membres sans `private` : internes au dossier photo (PhotoTools mène les gestes, photoOverlay.ts
  // dessine l'état). Hors de ce dossier, passer par PhotoTools.
  /** Redressement : ligne tracée (document). */
  straight: { start: Vec; current: Vec } | null = null;
  /** Perspective : coins du quadrilatère (document) et coin en cours de déplacement. */
  persp: { nodeId: string; quad: Vec[]; drag: number } | null = null;

  constructor(private readonly c: CanvasController) {}

  // ————— Redressement —————

  /**
   * Fait pivoter le calque pour que la ligne tracée (un horizon, un mur) devienne horizontale ou
   * verticale. Avec « Remplir », le calque grandit juste assez pour que ses coins vides restent
   * hors de sa boîte d'origine.
   */
  applyStraighten(a: Vec, b: Vec) {
    const z = ui.get().view.zoom;
    if (Math.hypot(b.x - a.x, b.y - a.y) * z < 6) return;
    const node = selectedImage() ?? imageAt(a);
    if (!node) {
      toast(t('photo.needPixelLayer'));
      return;
    }
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    // Ligne presque verticale : on la rend verticale.
    while (angle > 45) angle -= 90;
    while (angle < -45) angle += 90;
    if (Math.abs(angle) < 0.01) return;
    const fill = ui.get().straightenFill;
    editor.apply('history.straighten', (d) => {
      const n = findNode(d, node.id)?.node;
      if (!n) return;
      n.rotation = (((n.rotation - angle) % 360) + 360) % 360;
      if (fill) {
        const th = (Math.abs(angle) * Math.PI) / 180;
        const c = Math.cos(th),
          s2 = Math.sin(th);
        const w = n.width,
          h = n.height;
        const k = Math.max((w * c + h * s2) / w, (w * s2 + h * c) / h);
        const cx = n.x + w / 2,
          cy = n.y + h / 2;
        n.width = w * k;
        n.height = h * k;
        n.x = cx - n.width / 2;
        n.y = cy - n.height / 2;
      }
      return [n.id];
    });
  }

  // ————— Perspective —————

  perspDown(p: Vec) {
    const z = ui.get().view.zoom;
    if (this.persp && ui.get().perspectiveId === this.persp.nodeId) {
      const i = this.persp.quad.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) * z < 10);
      if (i >= 0) {
        this.persp.drag = i;
        return;
      }
      return;
    }
    const node = selectedImage() ?? imageAt(p);
    if (!node) {
      toast(t('photo.needPixelLayer'));
      return;
    }
    editor.select([node.id]);
    const m = localToDoc(node);
    // Départ : un peu à l'intérieur des bords, pour que les poignées soient faciles à saisir.
    const ix = node.width * 0.1,
      iy = node.height * 0.1;
    const corners = [
      [ix, iy],
      [node.width - ix, iy],
      [node.width - ix, node.height - iy],
      [ix, node.height - iy],
    ].map(([x, y]) => {
      const q = m.transformPoint(new DOMPoint(x, y));
      return { x: q.x, y: q.y };
    });
    this.persp = { nodeId: node.id, quad: corners, drag: -1 };
    ui.set({ perspectiveId: node.id });
    this.c.requestDraw();
  }

  cancelPerspective(): void {
    this.persp = null;
    ui.set({ perspectiveId: null });
    this.c.requestDraw();
  }

  /** Le quadrilatère devient le calque entier (comme le recadrage en perspective de Photoshop). */
  async applyPerspective(): Promise<void> {
    const ps = this.persp;
    if (!ps) return;
    const node = findNode(editor.doc, ps.nodeId)?.node;
    this.cancelPerspective();
    if (node?.type !== 'image') return;
    const px = targetPixels(node, 'pixels');
    if (!px) return;
    const { base, toPx } = px;
    const quad = ps.quad.map((q) => {
      const r = toPx.transformPoint(new DOMPoint(q.x, q.y));
      return { x: r.x, y: r.y };
    });
    const ctx = base.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, base.width, base.height);
    const out = warpPerspective(
      { data: img.data, width: img.width, height: img.height },
      quad,
      base.width,
      base.height,
    );
    const canvas = makeCanvas(out.width, out.height);
    canvas
      .getContext('2d')!
      .putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height), 0, 0);
    commitBitmap(node.id, 'pixels', canvas, 'history.perspective');
  }
}
