import type { Pixels } from './adjust';

/*
 * Panorama : assemble des photos prises à la suite en tournant (ou en glissant) l'appareil, qui se
 * recouvrent en partie. Chaque image est recalée sur la précédente par une translation (corrélation
 * normalisée sur des versions réduites, de la grossière à la fine), puis les images sont fondues
 * ensemble : les gains de luminosité sont égalisés dans les zones communes et les bords sont
 * adoucis pour que les raccords ne se voient pas.
 *
 * Valable pour les prises de vue à main levée sans fort changement de perspective (comme
 * l'assemblage simple d'Affinity ou de Lightroom). Calcul pur (sans DOM), pour les tests et les workers.
 */

export interface PanoramaOptions {
  /** Égaliser la luminosité entre images (vrai par défaut). */
  exposure?: boolean;
  /** Avancement de 0 à 1 ; renvoyer true pour annuler. */
  progress?: (fraction: number) => boolean | void;
}

export interface PanoramaResult extends Pixels {
  /** Position de chaque image dans le panorama, en pixels. */
  offsets: { x: number; y: number }[];
}

/** Recouvrement minimal pour fier un recalage (part de la plus petite image). */
const MIN_OVERLAP = 0.1;
/** Plus grand côté (pixels) de la version réduite du recalage grossier. */
const COARSE = 64;
/** Candidats gardés au niveau grossier. */
const CANDIDATES = 6;

interface Gray {
  w: number;
  h: number;
  d: Float32Array;
}

function toGray(img: Pixels): Gray {
  const { width: w, height: h, data } = img;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++)
    d[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
  return { w, h, d };
}

/** Moitié de la taille (moyenne de 2×2). */
function half(g: Gray): Gray {
  const w = Math.max(1, g.w >> 1),
    h = Math.max(1, g.h >> 1);
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x1 = Math.min(g.w - 1, x * 2 + 1),
        y1 = Math.min(g.h - 1, y * 2 + 1);
      d[y * w + x] =
        (g.d[y * 2 * g.w + x * 2] + g.d[y * 2 * g.w + x1] + g.d[y1 * g.w + x * 2] + g.d[y1 * g.w + x1]) / 4;
    }
  return { w, h, d };
}

function pyramid(g: Gray): Gray[] {
  const out = [g];
  while (Math.max(out[out.length - 1].w, out[out.length - 1].h) > COARSE) out.push(half(out[out.length - 1]));
  return out;
}

/**
 * Corrélation normalisée de `b` posée à (dx, dy) sur `a` ; -2 si le recouvrement est trop petit.
 * Compte les pixels communs seulement.
 */
function ncc(a: Gray, b: Gray, dx: number, dy: number): number {
  const x0 = Math.max(0, dx),
    x1 = Math.min(a.w, dx + b.w),
    y0 = Math.max(0, dy),
    y1 = Math.min(a.h, dy + b.h);
  const ow = x1 - x0,
    oh = y1 - y0;
  if (ow < 4 || oh < 4 || ow * oh < MIN_OVERLAP * Math.min(a.w * a.h, b.w * b.h)) return -2;
  let sa = 0,
    sb = 0,
    saa = 0,
    sbb = 0,
    sab = 0;
  for (let y = y0; y < y1; y++) {
    let ia = y * a.w + x0,
      ib = (y - dy) * b.w + (x0 - dx);
    for (let x = x0; x < x1; x++, ia++, ib++) {
      const va = a.d[ia],
        vb = b.d[ib];
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  }
  const n = ow * oh;
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n,
    vb = sbb - (sb * sb) / n;
  // Zone unie dans l'une des deux images : pas de repère, on n'y croit pas.
  if (va < 1e-6 || vb < 1e-6) return -1;
  return cov / Math.sqrt(va * vb);
}

/** Décalage (dx, dy) qui pose `b` sur `a`, et la qualité de la correspondance (-1 à 1). */
export function alignPair(a: Pixels, b: Pixels): { dx: number; dy: number; score: number } {
  const pa = pyramid(toGray(a)),
    pb = pyramid(toGray(b));
  const top = Math.min(pa.length, pb.length) - 1;
  // Niveau grossier : toutes les positions ; on garde les meilleures, éloignées les unes des autres
  // (un petit recouvrement peut donner une fausse bonne note).
  const A = pa[top],
    B = pb[top];
  let cands: { dx: number; dy: number; score: number }[] = [];
  for (let dy = -B.h + 1; dy < A.h; dy++)
    for (let dx = -B.w + 1; dx < A.w; dx++) {
      const s = ncc(A, B, dx, dy);
      if (s > -1) cands.push({ dx, dy, score: s });
    }
  cands.sort((p, q) => q.score - p.score);
  const kept: typeof cands = [];
  for (const c of cands) {
    if (kept.length >= CANDIDATES) break;
    if (kept.every((k) => Math.abs(k.dx - c.dx) > 2 || Math.abs(k.dy - c.dy) > 2)) kept.push(c);
  }
  cands = kept;
  // Niveaux plus fins : on affine chaque candidat autour de sa position ; la meilleure note finale gagne.
  let best = { dx: 0, dy: 0, score: -3 };
  for (const c of cands) {
    let cur = c;
    for (let l = top - 1; l >= 0; l--) {
      const cx = cur.dx * 2,
        cy = cur.dy * 2;
      cur = { dx: cx, dy: cy, score: -3 };
      for (let dy = cy - 3; dy <= cy + 3; dy++)
        for (let dx = cx - 3; dx <= cx + 3; dx++) {
          const s = ncc(pa[l], pb[l], dx, dy);
          if (s > cur.score) cur = { dx, dy, score: s };
        }
    }
    if (cur.score > best.score) best = cur;
  }
  return best;
}

/** Poids d'un pixel dans le fondu : 0 au bord, 1 loin des bords. */
function feather(x: number, y: number, w: number, h: number): number {
  const m = Math.min(x + 0.5, w - x - 0.5, y + 0.5, h - y - 0.5);
  return Math.max(1e-3, Math.min(1, m / Math.max(2, Math.min(w, h) * 0.12)));
}

/**
 * Assemble les images dans l'ordre donné (chacune recouvre la précédente). Renvoie null si
 * `progress` demande d'annuler. Lève une erreur si deux images consécutives ne se recouvrent pas.
 */
export function stitchPanorama(images: Pixels[], opts: PanoramaOptions = {}): PanoramaResult | null {
  if (images.length < 2) throw new Error('panorama : au moins deux images');
  const total = images.length * 2;
  let step = 0;
  const tick = (): boolean => !(opts.progress?.(++step / total) === true);
  // 1 : position de chaque image par rapport à la précédente.
  const pos: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  for (let i = 1; i < images.length; i++) {
    const r = alignPair(images[i - 1], images[i]);
    if (r.score < 0.3) throw new Error(`panorama : les images ${i} et ${i + 1} ne se recouvrent pas assez`);
    pos.push({ x: pos[i - 1].x + r.dx, y: pos[i - 1].y + r.dy });
    if (!tick()) return null;
  }
  const minX = Math.min(...pos.map((p) => p.x)),
    minY = Math.min(...pos.map((p) => p.y));
  const offsets = pos.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  const W = Math.max(...images.map((im, i) => offsets[i].x + im.width)),
    H = Math.max(...images.map((im, i) => offsets[i].y + im.height));
  if (W * H > 120_000_000) throw new Error('panorama : résultat trop grand');
  // 2 : gains de luminosité, d'une image à la suivante, sur leur zone commune.
  const gains = new Array<number>(images.length).fill(1);
  if (opts.exposure !== false)
    for (let i = 1; i < images.length; i++) {
      const a = images[i - 1],
        b = images[i];
      const dx = offsets[i].x - offsets[i - 1].x,
        dy = offsets[i].y - offsets[i - 1].y;
      let sa = 0,
        sb = 0;
      for (let y = Math.max(0, dy); y < Math.min(a.height, dy + b.height); y++)
        for (let x = Math.max(0, dx); x < Math.min(a.width, dx + b.width); x++) {
          const ia = (y * a.width + x) * 4,
            ib = ((y - dy) * b.width + (x - dx)) * 4;
          sa += a.data[ia] + a.data[ia + 1] + a.data[ia + 2];
          sb += b.data[ib] + b.data[ib + 1] + b.data[ib + 2];
        }
      const g = sb > 0 && sa > 0 ? (sa / sb) * gains[i - 1] : gains[i - 1];
      gains[i] = Math.min(1.5, Math.max(1 / 1.5, g));
    }
  // 3 : fondu pondéré par la distance au bord de chaque image.
  const acc = new Float32Array(W * H * 3),
    wsum = new Float32Array(W * H),
    alpha = new Float32Array(W * H);
  images.forEach((im, k) => {
    const { x: ox, y: oy } = offsets[k];
    for (let y = 0; y < im.height; y++)
      for (let x = 0; x < im.width; x++) {
        const s = (y * im.width + x) * 4,
          t = (oy + y) * W + ox + x;
        const a = im.data[s + 3] / 255;
        if (a <= 0) continue;
        const w = feather(x, y, im.width, im.height) * a;
        acc[t * 3] += im.data[s] * gains[k] * w;
        acc[t * 3 + 1] += im.data[s + 1] * gains[k] * w;
        acc[t * 3 + 2] += im.data[s + 2] * gains[k] * w;
        wsum[t] += w;
        alpha[t] = Math.max(alpha[t], a);
      }
  });
  if (!tick()) return null;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    if (wsum[i] <= 0) continue;
    out[i * 4] = acc[i * 3] / wsum[i];
    out[i * 4 + 1] = acc[i * 3 + 1] / wsum[i];
    out[i * 4 + 2] = acc[i * 3 + 2] / wsum[i];
    out[i * 4 + 3] = alpha[i] * 255;
  }
  return { data: out, width: W, height: H, offsets };
}
