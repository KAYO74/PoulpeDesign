import {
  Stabilizer,
  applyAdjustment,
  dodgeBurnPixels,
  gaussianBlurred,
  healBlend,
  type Vec,
} from '@poulpe/core';
import { compositeOp, setLiveBitmap } from '@poulpe/render';
import type { CanvasController } from '../canvas/controller';
import { t } from '../i18n';
import { compositeIn, nodesAboveOf } from '../tools/brushes/sample';
import { brushOptions } from '../tools/brushes/state';
import { brushSettings, toast, ui, type BrushSettings, type ToolId } from '../store';
import { dabLiquify, dabSimilar, dabSmudge } from './brushDabs';
import { LazySource, luminance, makeStamp } from './brushSources';
import { paintTarget, pixelsInMask, targetPixels } from './paintTarget';
import { runInpaint } from './photoFill';
import { photoHooks, type Rect, type StrokeRedirect } from './photoHooks';
import { commitBitmap, copyDrawable, makeCanvas } from './pixels';
import { selectionIn } from './selection';
import { SOURCE_TOOLS, WARP_TOOLS } from './toolKinds';

/*
 * Pinceaux de la Persona Photo : pinceau, gomme, tampon de duplication, correcteur, densité − et +,
 * flou et netteté au pinceau, doigt, fluidité, gomme magique et pinceaux de la version 1.2 (voir
 * photoHooks). Le coup de pinceau suit le pointeur touche après touche ; la zone touchée est
 * recomposée à partir des pixels d'origine, puis enregistrée au relâchement.
 */

interface Stroke {
  tool: ToolId;
  nodeId: string;
  which: 'pixels' | 'mask';
  /** Image affichée à la place pendant le geste. */
  assetId: string;
  toPx: DOMMatrix;
  /** Pixels de la cible par pixel du document. */
  pxScale: number;
  base: HTMLCanvasElement;
  work: HTMLCanvasElement;
  /** Couverture accumulée du coup de pinceau. */
  buf: HTMLCanvasElement;
  /** Aperçu rouge de la gomme magique. */
  tint: HTMLCanvasElement | null;
  sel: HTMLCanvasElement | null;
  source: LazySource | HTMLCanvasElement | null;
  stamp: HTMLCanvasElement;
  settings: BrushSettings;
  /** Valeur peinte dans un masque, de 0 (cacher) à 1 (montrer). */
  maskValue: number;
  last: Vec;
  /** Distance restant à parcourir avant la prochaine touche. */
  carry: number;
  /** Le calque vient d'être créé pour ce coup de pinceau. */
  pending: boolean;
  /** Doigt : couleur emportée par le pinceau, à la taille de l'empreinte. */
  pickup: HTMLCanvasElement | null;
  /** Fluidité : position de la touche précédente (le geste pousse de l'une à l'autre). */
  prevDab: Vec | null;
  /** Le pinceau efface (gomme, gomme d'arrière-plan). */
  erase: boolean;
  /** Masque rapide : le geste peint dans la sélection. */
  redirect: StrokeRedirect | null;
  /** Couverture limitée aux pixels proches de la couleur prélevée dans `ref`. */
  similar: { tolerance: number; continuous: boolean; contiguous: boolean } | null;
  ref: HTMLCanvasElement;
  sample: { r: number; g: number; b: number; a: number } | null;
  /** Stabilisateur du tracé (positions du document), s'il est activé. */
  stab?: Stabilizer | null;
  /** Correcteur dont la source est faite des calques du dessous : il peint aussi hors des pixels existants. */
  sourceOver?: boolean;
}

export class BrushEngine {
  // Membres sans `private` : internes au dossier photo (PhotoTools mène les gestes, brushDabs.ts et
  // photoOverlay.ts s'en servent). Hors de ce dossier, passer par PhotoTools.
  stroke: Stroke | null = null;
  cloneSource: Vec | null = null;
  /** Décalage du tampon (source − destination, en pixels du document), gardé d'un coup à l'autre. */
  cloneOffset: Vec | null = null;
  /** Dernier point du coup de pinceau précédent (document) : Maj + clic trace un trait droit depuis lui. */
  private lastStrokePoint: { nodeId: string; p: Vec } | null = null;
  private tmp = makeCanvas(64, 64);
  private tmp2 = makeCanvas(64, 64);

  constructor(private readonly c: CanvasController) {}

  // ————— Pinceaux —————

  beginStroke(tool: ToolId, p: Vec, e: PointerEvent) {
    const ext = photoHooks.brushes[tool];
    // Masque rapide : le pinceau et la gomme peignent dans la sélection.
    const redirect = photoHooks.redirect?.(tool) ?? null;
    const target = redirect ? { node: null, which: 'mask' as const } : paintTarget(tool, p);
    if (!target) return;
    const { node, which } = target;
    const px = redirect
      ? { base: redirect.base, toPx: redirect.toPx, assetId: '' }
      : targetPixels(node!, which);
    if (!px) return;
    const settings = brushSettings(tool);
    const { base, toPx, assetId } = px;
    const pxScale = Math.sqrt(Math.abs(toPx.a * toPx.d - toPx.b * toPx.c)) || 1;
    const w = base.width,
      h = base.height;
    const work = copyDrawable(base);
    const buf = makeCanvas(w, h);
    const sel = redirect ? null : selectionIn(w, h, toPx);
    const color = ui.get().brushColor;
    const erase = tool === 'eraser' || !!ext?.erase;
    const maskValue = erase ? 0 : luminance(color);
    const radius = (settings.size / 2) * pxScale;
    const stampColor = which === 'pixels' && tool === 'brush' ? color : '#ffffff';
    const stamp = makeStamp(radius, tool === 'magicEraser' ? 100 : settings.hardness, stampColor);

    let source: Stroke['source'] = null;
    let sourceOver = false;
    if (which === 'pixels' && ext?.source) source = new LazySource(base, ext.source(), 0);
    else if (which === 'pixels' && SOURCE_TOOLS.includes(tool)) {
      if (tool === 'clone' || tool === 'heal') {
        if (!this.cloneSource) {
          toast(t('photo.cloneNeedSource'));
          return;
        }
        const o = brushOptions.get();
        // Aligné : le décalage est gardé d'un coup à l'autre ; sinon chaque coup repart de la source.
        if (!this.cloneOffset || !o.aligned)
          this.cloneOffset = { x: this.cloneSource.x - p.x, y: this.cloneSource.y - p.y };
        // Pixels recopiés : ceux du calque, ou ce qui est visible sous lui (avec ou sans lui).
        const below = o.cloneSource !== 'layer';
        const from = below
          ? compositeIn(node, w, h, toPx, nodesAboveOf(node.id, o.cloneSource === 'layerBelow'))
          : base;
        const s = makeCanvas(w, h);
        const sc = s.getContext('2d')!;
        sc.setTransform(this.cloneMatrix(toPx, tool === 'clone'));
        sc.drawImage(from, 0, 0);
        source = s;
        if (tool === 'heal') {
          // Correcteur : la texture de la source prend la lumière et les couleurs de la destination.
          const sigma = Math.max(2, (settings.size / 2) * pxScale * 0.5);
          const sctx = s.getContext('2d', { willReadFrequently: true })!;
          source = new LazySource(
            from,
            (q, x0, y0) => {
              const src = sctx.getImageData(x0, y0, q.width, q.height);
              q.data.set(healBlend(q, { data: src.data, width: q.width, height: q.height }, sigma));
            },
            sigma * 3,
          );
          sourceOver = below;
        }
      } else if (tool === 'dodge' || tool === 'burn') {
        // Plage de tons (ombres, tons moyens, hautes lumières) et protection de la teinte.
        const { toneRange, protectHue } = brushOptions.get();
        const amount = tool === 'dodge' ? 1 : -1;
        source = new LazySource(base, (q) => dodgeBurnPixels(q, amount, toneRange, protectHue), 0);
      } else if (tool === 'blurBrush') {
        const sigma = 3 * pxScale;
        source = new LazySource(base, (q) => q.data.set(gaussianBlurred(q, sigma)), sigma * 3);
      } else {
        source = new LazySource(
          base,
          (q) =>
            applyAdjustment(
              q,
              { kind: 'unsharpMask', amount: 150, radius: 1.5, threshold: 0 },
              { scale: pxScale },
            ),
          6 * pxScale,
        );
      }
    } else if (SOURCE_TOOLS.includes(tool)) {
      // Sur un masque, ces outils n'ont pas de sens : on peint simplement.
    }

    const similar = ext?.similar && !redirect && (which === 'pixels' || erase) ? ext.similar() : null;
    // Sur un masque, la couleur est prélevée dans les pixels du calque.
    const ref =
      similar && which === 'mask' && node?.type === 'image' ? (pixelsInMask(node, w, h, toPx) ?? base) : base;
    // Maj + clic : trait droit depuis la fin du coup précédent sur le même calque.
    const prev =
      e.shiftKey && this.lastStrokePoint?.nodeId === (node?.id ?? '') ? this.lastStrokePoint.p : null;
    const first = prev ?? p;
    const start = toPx.transformPoint(new DOMPoint(first.x, first.y));
    // Stabilisateur : la longueur de la corde est en pixels d'écran.
    const opts = brushOptions.get();
    const stab = opts.stabilizer
      ? new Stabilizer(
          opts.stabilizerMode,
          opts.stabilizerMode === 'rope' ? opts.ropeLength / ui.get().view.zoom : opts.windowSize,
        )
      : null;
    this.stroke = {
      tool,
      nodeId: node?.id ?? '',
      which,
      assetId,
      toPx,
      pxScale,
      base,
      work,
      buf,
      tint: tool === 'magicEraser' ? makeCanvas(w, h) : null,
      sel,
      source,
      stamp,
      settings,
      maskValue,
      last: { x: start.x, y: start.y },
      carry: 0,
      pending: false,
      pickup: null,
      prevDab: null,
      erase,
      redirect,
      similar,
      ref,
      sample: null,
      stab,
      sourceOver,
    };
    if (tool !== 'magicEraser') this.showLive(this.stroke, work);
    const pressure = e.pointerType === 'pen' ? e.pressure : 1;
    this.dab(start.x, start.y, pressure);
    if (prev) this.strokeTo(p, pressure);
    stab?.start({ ...p, pressure });
    this.recompose();
  }

  /**
   * Tampon et correcteur : passe des pixels de la source à ceux de la destination (pixels du
   * calque). Le point source choisi correspond au point de destination du décalage ; le tampon
   * peut tourner et mettre à l'échelle ce qu'il recopie autour de ce point.
   */
  private cloneMatrix(toPx: DOMMatrix, transform: boolean): DOMMatrix {
    const src = this.cloneSource!,
      off = this.cloneOffset!;
    const { cloneRotation, cloneScale } = brushOptions.get();
    const k = transform ? Math.max(0.01, cloneScale / 100) : 1;
    return toPx
      .multiply(
        new DOMMatrix()
          .translate(src.x - off.x, src.y - off.y)
          .rotate(transform ? cloneRotation : 0)
          .scale(k)
          .translate(-src.x, -src.y),
      )
      .multiply(toPx.inverse());
  }

  /** Point source du tampon qui correspond à un point de destination (document). */
  cloneSourceAt(d: Vec): Vec {
    const src = this.cloneSource!,
      off = this.cloneOffset!;
    if (ui.get().tool !== 'clone') return { x: d.x + off.x, y: d.y + off.y };
    const { cloneRotation, cloneScale } = brushOptions.get();
    const m = new DOMMatrix()
      .translate(src.x - off.x, src.y - off.y)
      .rotate(cloneRotation)
      .scale(Math.max(0.01, cloneScale / 100))
      .translate(-src.x, -src.y)
      .inverse();
    const q = m.transformPoint(new DOMPoint(d.x, d.y));
    return { x: q.x, y: q.y };
  }

  dirty: Rect | null = null;

  private dab(x: number, y: number, pressure: number) {
    const s = this.stroke!;
    if (s.tool === 'smudge') return dabSmudge(this, x, y);
    if (s.tool === 'liquify') return dabLiquify(this, x, y);
    if (s.similar) return dabSimilar(this, x, y, pressure);
    const r = (s.settings.size / 2) * s.pxScale * Math.max(0.05, pressure);
    const ctx = s.buf.getContext('2d')!;
    ctx.globalAlpha = s.tool === 'magicEraser' ? 1 : Math.max(0.01, s.settings.flow / 100);
    const k = r / ((s.stamp.width - 2) / 2);
    const size = s.stamp.width * k;
    ctx.drawImage(s.stamp, x - size / 2, y - size / 2, size, size);
    const pad = size / 2 + 2;
    const d = this.dirty;
    const rect = { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad };
    this.dirty = d
      ? {
          x0: Math.min(d.x0, rect.x0),
          y0: Math.min(d.y0, rect.y0),
          x1: Math.max(d.x1, rect.x1),
          y1: Math.max(d.y1, rect.y1),
        }
      : rect;
  }

  /** Alt enfoncé (tenu à jour par PhotoTools) : la fluidité inverse son effet. */
  altDown = false;

  /** Aperçu du coup de pinceau : à la place de l'image du calque, ou chez la cible redirigée. */
  showLive(s: Stroke, canvas: HTMLCanvasElement | null, dirty?: Rect) {
    if (s.redirect) s.redirect.live(canvas, dirty);
    else setLiveBitmap(s.assetId, canvas);
  }

  strokeTo(p: Vec, pressure: number) {
    const s = this.stroke!;
    const q = s.toPx.transformPoint(new DOMPoint(p.x, p.y));
    const dx = q.x - s.last.x,
      dy = q.y - s.last.y;
    const dist = Math.hypot(dx, dy);
    const k = s.tool === 'smudge' ? 0.05 : s.tool === 'liquify' ? 0.08 : 0.1;
    const spacing = Math.max(0.75, s.settings.size * s.pxScale * k);
    let tpos = spacing - s.carry;
    const from = s.last;
    while (tpos <= dist) {
      const f = tpos / dist;
      const pt = { x: from.x + dx * f, y: from.y + dy * f };
      this.dab(pt.x, pt.y, pressure);
      tpos += spacing;
    }
    s.carry = dist - (tpos - spacing);
    s.last = { x: q.x, y: q.y };
  }

  scratch(w: number, h: number, which: 1 | 2): HTMLCanvasElement {
    const c = which === 1 ? this.tmp : this.tmp2;
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w);
      c.height = Math.max(c.height, h);
    }
    return c;
  }

  /** Recompose la zone touchée : pixels d'origine + coup de pinceau, limité à la sélection. */
  recompose() {
    const s = this.stroke;
    const d = this.dirty;
    this.dirty = null;
    if (!s || !d) return;
    const W = s.base.width,
      H = s.base.height;
    const x0 = Math.max(0, Math.floor(d.x0)),
      y0 = Math.max(0, Math.floor(d.y0));
    const x1 = Math.min(W, Math.ceil(d.x1)),
      y1 = Math.min(H, Math.ceil(d.y1));
    const w = x1 - x0,
      h = y1 - y0;
    if (w <= 0 || h <= 0) return;

    if (WARP_TOOLS.includes(s.tool)) {
      // Doigt et fluidité modifient directement la copie de travail.
      setLiveBitmap(s.assetId, s.work);
      this.c.requestDraw();
      return;
    }

    if (s.tool === 'magicEraser') {
      // La gomme magique ne touche pas encore aux pixels : on montre la zone en rouge.
      const tc = s.tint!.getContext('2d')!;
      // « source-in » touche toute la toile : on le limite à la zone pour garder le reste du trait.
      tc.save();
      tc.beginPath();
      tc.rect(x0, y0, w, h);
      tc.clip();
      tc.clearRect(x0, y0, w, h);
      tc.drawImage(s.buf, x0, y0, w, h, x0, y0, w, h);
      tc.globalCompositeOperation = 'source-in';
      tc.fillStyle = 'rgba(255, 60, 90, 0.55)';
      tc.fillRect(x0, y0, w, h);
      tc.restore();
      this.c.requestDraw();
      return;
    }

    // Couverture du coup de pinceau dans la zone, limitée à la sélection.
    const cov = this.scratch(w, h, 1);
    const cc = cov.getContext('2d')!;
    cc.globalCompositeOperation = 'copy';
    cc.drawImage(s.buf, x0, y0, w, h, 0, 0, w, h);
    if (s.sel) {
      cc.globalCompositeOperation = 'destination-in';
      cc.drawImage(s.sel, x0, y0, w, h, 0, 0, w, h);
    }
    cc.globalCompositeOperation = 'source-over';

    const wc = s.work.getContext('2d')!;
    wc.save();
    // (« copy » effacerait toute la toile hors de la zone : on vide seulement la zone.)
    wc.clearRect(x0, y0, w, h);
    wc.drawImage(s.base, x0, y0, w, h, x0, y0, w, h);
    const opacity = Math.max(0, Math.min(1, s.settings.opacity / 100));
    if (s.which === 'mask') {
      // Masque : on va vers la valeur peinte (blanc = visible, noir = caché).
      wc.globalAlpha = opacity;
      wc.globalCompositeOperation = 'destination-out';
      wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
      if (s.maskValue > 0) {
        wc.globalAlpha = opacity * s.maskValue;
        wc.globalCompositeOperation = 'lighter';
        wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
      }
    } else if (s.erase) {
      wc.globalAlpha = opacity;
      wc.globalCompositeOperation = 'destination-out';
      wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
    } else if (s.source) {
      const src =
        s.source instanceof LazySource ? (s.source.ensure({ x0, y0, x1, y1 }), s.source.canvas) : s.source;
      const t2 = this.scratch(w, h, 2);
      const tc = t2.getContext('2d')!;
      tc.globalCompositeOperation = 'copy';
      tc.drawImage(src, x0, y0, w, h, 0, 0, w, h);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(cov, 0, 0, w, h, 0, 0, w, h);
      tc.globalCompositeOperation = 'source-over';
      wc.globalAlpha = opacity;
      // Les retouches ne changent pas l'opacité du calque.
      wc.globalCompositeOperation = s.tool === 'clone' || s.sourceOver ? 'source-over' : 'source-atop';
      wc.drawImage(t2, 0, 0, w, h, x0, y0, w, h);
    } else if (
      s.tool === 'brush' &&
      (brushOptions.get().blend !== 'normal' || brushOptions.get().protectAlpha)
    ) {
      // Pinceau : mode de fusion, et « Protéger l'alpha » (seulement là où il y a déjà des pixels).
      const { blend, protectAlpha } = brushOptions.get();
      if (protectAlpha && blend !== 'normal') {
        const t2 = this.scratch(w, h, 2);
        const tc = t2.getContext('2d')!;
        tc.globalCompositeOperation = 'copy';
        tc.drawImage(s.base, x0, y0, w, h, 0, 0, w, h);
        tc.globalCompositeOperation = compositeOp(blend);
        tc.globalAlpha = opacity;
        tc.drawImage(cov, 0, 0, w, h, 0, 0, w, h);
        tc.globalAlpha = 1;
        tc.globalCompositeOperation = 'source-over';
        wc.globalCompositeOperation = 'source-atop';
        wc.drawImage(t2, 0, 0, w, h, x0, y0, w, h);
      } else {
        wc.globalAlpha = opacity;
        wc.globalCompositeOperation = protectAlpha ? 'source-atop' : compositeOp(blend);
        wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
      }
    } else {
      wc.globalAlpha = opacity;
      wc.drawImage(cov, 0, 0, w, h, x0, y0, w, h);
    }
    wc.restore();
    this.showLive(s, s.work, { x0, y0, x1, y1 });
    this.c.requestDraw();
  }

  async endStroke() {
    const s = this.stroke!;
    if (s.tool === 'magicEraser') {
      s.pending = true;
      try {
        await runInpaint(s.nodeId, s.base, s.buf, 16);
      } finally {
        this.stroke = null;
        this.c.requestDraw();
      }
      return;
    }
    this.stroke = null;
    const end = s.toPx.inverse().transformPoint(new DOMPoint(s.last.x, s.last.y));
    this.lastStrokePoint = { nodeId: s.nodeId, p: { x: end.x, y: end.y } };
    if (s.redirect) {
      s.redirect.commit(s.work);
      s.redirect.live(null);
      return;
    }
    const labels: Partial<Record<ToolId, string>> = {
      brush: 'history.brush',
      eraser: 'history.erase',
      clone: 'history.clone',
      heal: 'history.heal',
      smudge: 'history.smudge',
      liquify: 'history.liquify',
      dodge: 'history.dodge',
      burn: 'history.burn',
      blurBrush: 'history.blurBrush',
      sharpenBrush: 'history.sharpenBrush',
    };
    commitBitmap(
      s.nodeId,
      s.which,
      s.work,
      s.which === 'mask'
        ? 'history.maskPaint'
        : (labels[s.tool] ?? photoHooks.brushes[s.tool]?.history ?? 'history.brush'),
    );
    setLiveBitmap(s.assetId, null);
  }
}
