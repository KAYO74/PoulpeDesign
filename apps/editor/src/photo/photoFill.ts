import { findNode, floodMask, parseColor, type Vec } from '@poulpe/core';
import { compositeOp } from '@poulpe/render';
import { t } from '../i18n';
import { compositeIn } from '../tools/brushes/sample';
import { brushOptions } from '../tools/brushes/state';
import { brushSettings, editor, toast, ui } from '../store';
import { luminance } from './brushSources';
import { inpaintAsync } from './inpaintClient';
import { paintTarget, targetPixels } from './paintTarget';
import { commitBitmap, copyDrawable, makeCanvas } from './pixels';
import { selectionIn } from './selection';

/*
 * Remplissages de la Persona Photo : reconstruction d'une zone d'après ce qui l'entoure (gomme
 * magique, remplissage d'après le contenu) et pot de peinture.
 */

/** Réglages du remplissage d'après le contenu (fenêtre Édition › Remplir d'après le contenu). */
export interface InpaintSettings {
  /** Largeur de la zone où chercher de quoi remplir, en part de la taille du trou (0,9 par défaut). */
  sampling?: number;
  /** Graine du tirage : une autre graine donne une autre variante. */
  seed?: number;
}

/**
 * Reconstruit la zone couverte par `cover` (opacité > `threshold`) dans les pixels `base` du
 * calque. Renvoie les pixels du calque reconstruits, ou null s'il n'y a rien à remplir.
 */
export async function computeInpaint(
  base: HTMLCanvasElement,
  cover: HTMLCanvasElement,
  threshold: number,
  settings: InpaintSettings = {},
): Promise<HTMLCanvasElement | null> {
  const W = base.width,
    H = base.height;
  const cd = cover.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (cd[(y * W + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  // Zone de travail : le trou et ce qui l'entoure, où l'on va chercher de quoi le remplir.
  const m = Math.max(32, Math.round(Math.max(x1 - x0, y1 - y0) * (settings.sampling ?? 0.9)));
  const rx = Math.max(0, x0 - m),
    ry = Math.max(0, y0 - m);
  const rw = Math.min(W, x1 + m + 1) - rx,
    rh = Math.min(H, y1 + m + 1) - ry;
  const img = base.getContext('2d', { willReadFrequently: true })!.getImageData(rx, ry, rw, rh);
  const hole = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      // Le trou est élargi d'un pixel pour ne pas laisser de liseré.
      let on = false;
      for (let dy = -1; dy <= 1 && !on; dy++)
        for (let dx = -1; dx <= 1 && !on; dx++) {
          const gx = rx + x + dx,
            gy = ry + y + dy;
          if (gx >= 0 && gy >= 0 && gx < W && gy < H && cd[(gy * W + gx) * 4 + 3] > threshold) on = true;
        }
      if (on) hole[y * rw + x] = 1;
    }
  ui.set({ busy: { label: t('photo.inpainting'), progress: 0 } });
  try {
    const data = await inpaintAsync(
      img.data,
      rw,
      rh,
      hole,
      (f) => ui.set({ busy: { label: t('photo.inpainting'), progress: f } }),
      settings.seed,
    );
    const out = copyDrawable(base);
    out.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), rw, rh), rx, ry);
    return out;
  } finally {
    ui.set({ busy: null });
  }
}

/**
 * Reconstruit la zone couverte par `cover` puis enregistre le résultat dans le calque. Sert à
 * la gomme magique.
 */
export async function runInpaint(
  nodeId: string,
  base: HTMLCanvasElement,
  cover: HTMLCanvasElement,
  threshold: number,
): Promise<void> {
  try {
    const out = await computeInpaint(base, cover, threshold);
    if (out && findNode(editor.doc, nodeId)) commitBitmap(nodeId, 'pixels', out, 'history.magicEraser');
  } catch {
    toast(t('photo.inpaintFailed'));
  }
}

// ————— Pot de peinture —————

export function fillAt(p: Vec) {
  const target = paintTarget('fill', p);
  if (!target) return;
  const px = targetPixels(target.node, target.which);
  if (!px) return;
  const { base, toPx } = px;
  const W = base.width,
    H = base.height;
  const q = toPx.transformPoint(new DOMPoint(p.x, p.y));
  if (q.x < 0 || q.y < 0 || q.x >= W || q.y >= H) return;
  const ctx = base.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, W, H);
  // Couleurs comparées : celles du calque, ou tout ce qui est visible (option Source).
  const { fillSource, fillBlend } = brushOptions.get();
  const all = fillSource === 'all' && target.which === 'pixels';
  const ref = all
    ? compositeIn(target.node, W, H, toPx)
        .getContext('2d', { willReadFrequently: true })!
        .getImageData(0, 0, W, H)
    : img;
  const mask = floodMask(
    { data: ref.data, width: W, height: H },
    q.x,
    q.y,
    ui.get().tolerance,
    ui.get().contiguous,
  );
  const sel = selectionIn(W, H, toPx);
  const sd = sel?.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const op = brushSettings('brush').opacity / 100;
  const col = parseColor(ui.get().brushColor);
  const d = img.data;
  const value = luminance(ui.get().brushColor) * 255;
  // Mode de fusion : la couleur est posée par le navigateur, à travers le masque du remplissage.
  const blended = target.which === 'pixels' && fillBlend !== 'normal' ? new ImageData(W, H) : null;
  for (let i = 0; i < mask.length; i++) {
    let k = (mask[i] / 255) * op;
    if (sd) k *= sd[i * 4 + 3] / 255;
    if (k <= 0) continue;
    const j = i * 4;
    if (blended) {
      blended.data[j] = col.r;
      blended.data[j + 1] = col.g;
      blended.data[j + 2] = col.b;
      blended.data[j + 3] = k * 255;
      continue;
    }
    if (target.which === 'mask') {
      d[j + 3] = d[j + 3] + (value - d[j + 3]) * k;
      d[j] = d[j + 1] = d[j + 2] = 255;
      continue;
    }
    // Couleur posée par-dessus (fusion normale).
    const a = d[j + 3] / 255;
    const outA = k + a * (1 - k);
    if (outA <= 0) continue;
    d[j] = (col.r * k + d[j] * a * (1 - k)) / outA;
    d[j + 1] = (col.g * k + d[j + 1] * a * (1 - k)) / outA;
    d[j + 2] = (col.b * k + d[j + 2] * a * (1 - k)) / outA;
    d[j + 3] = outA * 255;
  }
  const out = makeCanvas(W, H);
  const octx = out.getContext('2d')!;
  octx.putImageData(img, 0, 0);
  if (blended) {
    const paint = makeCanvas(W, H);
    paint.getContext('2d')!.putImageData(blended, 0, 0);
    octx.globalCompositeOperation = compositeOp(fillBlend);
    octx.drawImage(paint, 0, 0);
  }
  commitBitmap(
    target.node.id,
    target.which,
    out,
    target.which === 'mask' ? 'history.maskPaint' : 'history.fill',
  );
}
