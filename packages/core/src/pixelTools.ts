import { luma, type Pixels } from './adjust';
import type { Box, Vec } from './geometry';

/*
 * Outils de pixels de la version 1.2 (Persona Photo) : calculs du recadrage, dégradé peint,
 * éponge, gomme d'arrière-plan, remplacement de couleur, correctif, retouche des imperfections
 * et yeux rouges. Sans dépendance au navigateur.
 */

// ————— Recadrage —————

/**
 * Angle (degrés, de −45 à 45) dont il faut tourner l'image, dans l'autre sens, pour que la ligne
 * de `a` à `b` devienne horizontale (ou verticale si elle est presque verticale). Même calcul que
 * l'outil Redressement.
 */
export function levelAngle(a: Vec, b: Vec): number {
  let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  while (angle > 45) angle -= 90;
  while (angle < -45) angle += 90;
  return angle;
}

/**
 * Plus grand rectangle de proportions `ratio` (largeur / hauteur), centré, qui tient dans un
 * rectangle `width` × `height` tourné de `deg` degrés : le recadrage qui cache les coins vides
 * d'une image redressée.
 */
export function inscribedSize(
  width: number,
  height: number,
  deg: number,
  ratio: number,
): { width: number; height: number } {
  const a = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)),
    s = Math.abs(Math.sin(a));
  const k = Math.min(width / (ratio * c + s), height / (ratio * s + c));
  return { width: k * ratio, height: k };
}

/** La plus grande boîte de proportions `ratio`, centrée dans `box`. */
export function fitRatio(box: Box, ratio: number): Box {
  let w = box.width,
    h = box.height;
  if (w / Math.max(1e-9, h) > ratio) w = h * ratio;
  else h = w / ratio;
  return { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h };
}

/** Déplace une boîte sans la faire sortir de `bounds`. */
export function moveCrop(box: Box, dx: number, dy: number, bounds: Box | null): Box {
  let x = box.x + dx,
    y = box.y + dy;
  if (bounds) {
    x = Math.min(Math.max(x, bounds.x), bounds.x + bounds.width - box.width);
    y = Math.min(Math.max(y, bounds.y), bounds.y + bounds.height - box.height);
  }
  return { ...box, x, y };
}

/** Poignées du cadre de recadrage : coins et milieux des côtés. */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * Nouveau cadre quand on tire la poignée `handle` du cadre `start` jusqu'en `p`. Le côté opposé
 * reste en place ; avec `ratio`, les proportions sont gardées (un côté tiré agrandit l'autre
 * dimension autour du centre). Le cadre ne sort pas de `bounds`.
 */
export function resizeCrop(
  start: Box,
  handle: CropHandle,
  p: Vec,
  ratio: number | null,
  bounds: Box | null,
  min = 1,
): Box {
  let L = start.x,
    T = start.y,
    R = start.x + start.width,
    B = start.y + start.height;
  const bx0 = bounds ? bounds.x : -Infinity,
    by0 = bounds ? bounds.y : -Infinity;
  const bx1 = bounds ? bounds.x + bounds.width : Infinity,
    by1 = bounds ? bounds.y + bounds.height : Infinity;
  const west = handle.includes('w'),
    east = handle.includes('e'),
    north = handle.includes('n'),
    south = handle.includes('s');
  if (west) L = Math.min(Math.max(p.x, bx0), R - min);
  if (east) R = Math.max(Math.min(p.x, bx1), L + min);
  if (north) T = Math.min(Math.max(p.y, by0), B - min);
  if (south) B = Math.max(Math.min(p.y, by1), T + min);
  if (ratio && ratio > 0) {
    const horizontal = west || east,
      vertical = north || south;
    if (horizontal && vertical) {
      // Coin : la dimension la plus petite (relativement) commande.
      let w = R - L,
        h = B - T;
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
      if (west) L = R - w;
      else R = L + w;
      if (north) T = B - h;
      else B = T + h;
    } else if (horizontal) {
      let w = R - L;
      const cy = (start.y * 2 + start.height) / 2;
      let h = w / ratio;
      const hMax = 2 * Math.min(cy - by0, by1 - cy);
      if (h > hMax) {
        h = hMax;
        w = h * ratio;
        if (west) L = R - w;
        else R = L + w;
      }
      T = cy - h / 2;
      B = cy + h / 2;
    } else {
      let h = B - T;
      const cx = (start.x * 2 + start.width) / 2;
      let w = h * ratio;
      const wMax = 2 * Math.min(cx - bx0, bx1 - cx);
      if (w > wMax) {
        w = wMax;
        h = w / ratio;
        if (north) T = B - h;
        else B = T + h;
      }
      L = cx - w / 2;
      R = cx + w / 2;
    }
  }
  return { x: L, y: T, width: R - L, height: B - T };
}

// ————— Dégradé —————

export type PixelGradientKind = 'linear' | 'radial' | 'elliptical' | 'conical';

/**
 * Position (0 à 1) du point `p` dans un dégradé tracé de `a` à `b` : le long de la ligne
 * (linéaire), selon la distance à `a` (radial, elliptique avec `aspect` = petit axe / grand axe)
 * ou selon l'angle autour de `a` (conique, un tour complet à partir de la direction de `b`).
 */
export function gradientPosition(kind: PixelGradientKind, p: Vec, a: Vec, b: Vec, aspect = 0.5): number {
  const vx = b.x - a.x,
    vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-12) return 0;
  const dx = p.x - a.x,
    dy = p.y - a.y;
  let t: number;
  if (kind === 'linear') t = (dx * vx + dy * vy) / len2;
  else if (kind === 'radial') t = Math.sqrt((dx * dx + dy * dy) / len2);
  else if (kind === 'elliptical') {
    const u = (dx * vx + dy * vy) / len2,
      v = (vx * dy - vy * dx) / len2 / Math.max(1e-6, aspect);
    t = Math.sqrt(u * u + v * v);
  } else {
    const turn = (Math.atan2(dy, dx) - Math.atan2(vy, vx)) / (Math.PI * 2);
    t = turn - Math.floor(turn);
  }
  return Math.min(1, Math.max(0, t));
}

// ————— Éponge, remplacement de couleur —————

/**
 * Éponge : `amount` de −1 (gris) à 1 (couleurs deux fois plus vives). La luminosité et la teinte
 * ne changent pas : les couleurs s'éloignent (ou se rapprochent) du gris de même luminance, sans
 * qu'aucun canal ne déborde.
 */
export function spongePixels(px: Pixels, amount: number): void {
  const d = px.data;
  const want = 1 + Math.max(-1, Math.min(1, amount));
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    const L = luma(r, g, b);
    let k = want;
    if (k > 1) {
      // Pas plus que ce qui garde les trois canaux entre 0 et 255.
      for (const c of [r, g, b]) {
        if (c > L + 0.5) k = Math.min(k, (255 - L) / (c - L));
        else if (c < L - 0.5) k = Math.min(k, L / (L - c));
      }
    }
    d[i] = L + (r - L) * k;
    d[i + 1] = L + (g - L) * k;
    d[i + 2] = L + (b - L) * k;
  }
}

const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

/**
 * Remplacement de couleur : chaque pixel prend la teinte et la saturation de `color` en gardant
 * sa luminosité (le mode de fusion « Couleur »), ses ombres et ses lumières restent.
 */
export function colorizePixels(px: Pixels, color: { r: number; g: number; b: number }): void {
  const d = px.data;
  const lc = lum(color.r, color.g, color.b);
  for (let i = 0; i < d.length; i += 4) {
    const delta = lum(d[i], d[i + 1], d[i + 2]) - lc;
    let r = color.r + delta,
      g = color.g + delta,
      b = color.b + delta;
    // Ramène les canaux entre 0 et 255 sans changer la luminosité.
    const l = lum(r, g, b);
    const n = Math.min(r, g, b),
      x = Math.max(r, g, b);
    if (n < 0) {
      const k = l / Math.max(1e-6, l - n);
      r = l + (r - l) * k;
      g = l + (g - l) * k;
      b = l + (b - l) * k;
    }
    if (x > 255) {
      const k = (255 - l) / Math.max(1e-6, x - l);
      r = l + (r - l) * k;
      g = l + (g - l) * k;
      b = l + (b - l) * k;
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

/**
 * Ressemblance (0 à 1) d'une couleur à la couleur prélevée : 1 jusqu'à `tolerance` d'écart sur le
 * canal le plus différent, puis une courte transition pour des bords doux.
 */
export function colorCloseness(
  r: number,
  g: number,
  b: number,
  a: number,
  sample: { r: number; g: number; b: number; a: number },
  tolerance: number,
): number {
  if (a < 8) return sample.a < 8 ? 1 : 0;
  if (sample.a < 8) return 0;
  const diff = Math.max(Math.abs(r - sample.r), Math.abs(g - sample.g), Math.abs(b - sample.b));
  const tol = Math.max(0, tolerance);
  if (diff <= tol) return 1;
  const soft = Math.max(4, tol * 0.5);
  return diff < tol + soft ? 1 - (diff - tol) / soft : 0;
}

/**
 * Touche d'un pinceau qui ne couvre que les pixels proches de `sample` (gomme d'arrière-plan,
 * remplacement de couleur) : opacité (0 à 255) par pixel de `px`, pour un disque de rayon
 * `radius` centré en (cx, cy), au bord plus ou moins doux (`hardness` de 0 à 100). Avec
 * `contiguous`, seulement les pixels reliés au centre.
 */
export function similarDab(
  px: Pixels,
  cx: number,
  cy: number,
  radius: number,
  hardness: number,
  sample: { r: number; g: number; b: number; a: number },
  tolerance: number,
  contiguous = false,
): Uint8ClampedArray {
  const { data, width: w, height: h } = px;
  const out = new Uint8ClampedArray(w * h);
  const r = Math.max(0.5, radius);
  const hard = Math.min(0.99, Math.max(0, hardness / 100));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (t >= 1) continue;
      const stamp = t <= hard ? 1 : 1 - (t - hard) / (1 - hard);
      const i = y * w + x,
        p = i * 4;
      const k = colorCloseness(data[p], data[p + 1], data[p + 2], data[p + 3], sample, tolerance);
      if (k > 0) out[i] = stamp * k * 255;
    }
  if (contiguous) {
    const sx = Math.min(w - 1, Math.max(0, Math.floor(cx))),
      sy = Math.min(h - 1, Math.max(0, Math.floor(cy)));
    const seen = new Uint8Array(w * h);
    const stack = [sy * w + sx];
    if (out[stack[0]]) seen[stack[0]] = 1;
    else stack.pop();
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w,
        y = (i / w) | 0;
      for (const j of [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ])
        if (j >= 0 && !seen[j] && out[j]) {
          seen[j] = 1;
          stack.push(j);
        }
    }
    for (let i = 0; i < out.length; i++) if (!seen[i]) out[i] = 0;
  }
  return out;
}

// ————— Yeux rouges —————

/**
 * Yeux rouges : dans l'ellipse de centre (cx, cy) et de rayons (rx, ry), les pixels nettement
 * rouges perdent leur rouge et s'assombrissent (`darken` de 0 à 1). Les autres pixels (peau, iris)
 * ne bougent pas ; le bord de l'ellipse est adouci.
 */
export function fixRedEye(px: Pixels, cx: number, cy: number, rx: number, ry: number, darken: number): void {
  const { data: d, width: w, height: h } = px;
  const x0 = Math.max(0, Math.floor(cx - rx)),
    x1 = Math.min(w, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)),
    y1 = Math.min(h, Math.ceil(cy + ry));
  const dk = 1 - Math.max(0, Math.min(1, darken));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const e = ((x + 0.5 - cx) / Math.max(0.5, rx)) ** 2 + ((y + 0.5 - cy) / Math.max(0.5, ry)) ** 2;
      if (e >= 1) continue;
      const edge = e < 0.7 ? 1 : (1 - e) / 0.3;
      const p = (y * w + x) * 4;
      const r = d[p],
        g = d[p + 1],
        b = d[p + 2];
      const gb = (g + b) / 2;
      // Rougeur : le rouge domine nettement le vert et le bleu.
      const red = Math.min(1, Math.max(0, (r / (gb + 8) - 1.5) / 0.8));
      const k = red * edge;
      if (k <= 0) continue;
      d[p] = r + (gb * dk - r) * k;
      d[p + 1] = g + (g * dk - g) * k;
      d[p + 2] = b + (b * dk - b) * k;
    }
}

// ————— Correctif et imperfections —————

/** Flou en boîte (trois passes ≈ gaussienne) d'un canal flottant, sans rien au-delà des bords. */
function boxBlur3(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const a = Float32Array.from(src);
  const b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    // Horizontal (a → b), puis vertical (b → a) : sommes glissantes.
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let acc = 0;
      for (let x = 0; x < Math.min(r, w); x++) acc += a[o + x];
      for (let x = 0; x < w; x++) {
        if (x + r < w) acc += a[o + x + r];
        if (x - r - 1 >= 0) acc -= a[o + x - r - 1];
        b[o + x] = acc;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = 0; y < Math.min(r, h); y++) acc += b[y * w + x];
      for (let y = 0; y < h; y++) {
        if (y + r < h) acc += b[(y + r) * w + x];
        if (y - r - 1 >= 0) acc -= b[(y - r - 1) * w + x];
        a[y * w + x] = acc;
      }
    }
  }
  return a;
}

/**
 * Correctif : dans la zone `mask` (0 à 255 par pixel), `dest` prend la texture de `src` avec la
 * lumière et les couleurs de ce qui entoure la zone. L'écart entre les deux images, mesuré autour
 * de la zone, est interpolé en douceur vers l'intérieur (convolution normalisée), comme un
 * clonage sans raccord. `dest` et `src` ont la même taille ; l'opacité reste celle de `dest`.
 */
export function patchBlend(dest: Pixels, src: Pixels, mask: Uint8Array, sigma?: number): Uint8ClampedArray {
  const { width: w, height: h } = dest;
  const n = w * h;
  const d = dest.data,
    s = src.data;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let i = 0; i < n; i++)
    if (mask[i]) {
      const x = i % w,
        y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  const out = new Uint8ClampedArray(d);
  if (x1 < 0) return out;
  const sg = sigma ?? Math.max(3, Math.max(x1 - x0, y1 - y0) * 0.35);
  const r = Math.max(1, Math.round((Math.sqrt(4 * sg * sg + 1) - 1) / 2));
  const wt = new Float32Array(n);
  const dr = new Float32Array(n),
    dg = new Float32Array(n),
    db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Seuls les pixels autour de la zone (et pas transparents) disent quelle lumière garder.
    const k = (1 - mask[i] / 255) * (d[i * 4 + 3] / 255) * (s[i * 4 + 3] / 255);
    wt[i] = k;
    dr[i] = (d[i * 4] - s[i * 4]) * k;
    dg[i] = (d[i * 4 + 1] - s[i * 4 + 1]) * k;
    db[i] = (d[i * 4 + 2] - s[i * 4 + 2]) * k;
  }
  const bw = boxBlur3(wt, w, h, r);
  const br = boxBlur3(dr, w, h, r),
    bg = boxBlur3(dg, w, h, r),
    bb = boxBlur3(db, w, h, r);
  for (let i = 0; i < n; i++) {
    const m = mask[i] / 255;
    if (m <= 0) continue;
    const q = bw[i];
    const cr = q > 1e-6 ? br[i] / q : 0,
      cg = q > 1e-6 ? bg[i] / q : 0,
      cb = q > 1e-6 ? bb[i] / q : 0;
    const p = i * 4;
    out[p] = d[p] + (s[p] + cr - d[p]) * m;
    out[p + 1] = d[p + 1] + (s[p + 1] + cg - d[p + 1]) * m;
    out[p + 2] = d[p + 2] + (s[p + 2] + cb - d[p + 2]) * m;
  }
  return out;
}

/** Masque d'un disque au bord adouci (0 à 255), de rayon `r` centré en (cx, cy). */
export function discMask(w: number, h: number, cx: number, cy: number, r: number): Uint8Array {
  const m = new Uint8Array(w * h);
  const inner = r * 0.85,
    outer = r * 1.15;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dd >= outer) continue;
      m[y * w + x] = dd <= inner ? 255 : Math.round((255 * (outer - dd)) / (outer - inner));
    }
  return m;
}

/**
 * Retouche des imperfections : cherche autour d'un défaut de rayon `r` (centré en cx, cy) le
 * morceau d'image le plus semblable à son entourage et le plus uni, et renvoie son décalage.
 */
export function blemishOffset(px: Pixels, cx: number, cy: number, r: number): Vec | null {
  const { data: d, width: w, height: h } = px;
  const ring0 = r * 1.15,
    ring1 = r * 1.7;
  // Couleur moyenne autour du défaut.
  const ringPts: number[] = [];
  const discPts: number[] = [];
  const R = Math.ceil(ring1);
  let mr = 0,
    mg = 0,
    mb = 0;
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const dd = Math.hypot(x, y);
      const gx = Math.round(cx + x),
        gy = Math.round(cy + y);
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      if (dd > ring0 && dd <= ring1) {
        ringPts.push(gx, gy);
        const p = (gy * w + gx) * 4;
        mr += d[p];
        mg += d[p + 1];
        mb += d[p + 2];
      } else if (dd <= ring0) discPts.push(x, y);
    }
  const nRing = ringPts.length / 2;
  if (!nRing) return null;
  mr /= nRing;
  mg /= nRing;
  mb /= nRing;
  let best: Vec | null = null;
  let bestScore = Infinity;
  for (const dist of [2.4 * r, 3.4 * r])
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const ox = Math.round(Math.cos(a) * dist),
        oy = Math.round(Math.sin(a) * dist);
      // Le morceau candidat et son entourage doivent être dans l'image.
      if (cx + ox - ring1 < 0 || cy + oy - ring1 < 0 || cx + ox + ring1 >= w || cy + oy + ring1 >= h)
        continue;
      let ring = 0;
      for (let i = 0; i < ringPts.length; i += 2) {
        const p = (ringPts[i + 1] * w + ringPts[i]) * 4;
        const q = ((ringPts[i + 1] + oy) * w + ringPts[i] + ox) * 4;
        ring += (d[p] - d[q]) ** 2 + (d[p + 1] - d[q + 1]) ** 2 + (d[p + 2] - d[q + 2]) ** 2;
      }
      let inside = 0;
      for (let i = 0; i < discPts.length; i += 2) {
        const gx = Math.round(cx + discPts[i] + ox),
          gy = Math.round(cy + discPts[i + 1] + oy);
        const q = (gy * w + gx) * 4;
        inside += (d[q] - mr) ** 2 + (d[q + 1] - mg) ** 2 + (d[q + 2] - mb) ** 2;
      }
      const score = ring / nRing + (inside / Math.max(1, discPts.length / 2)) * 0.5 + dist * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = { x: ox, y: oy };
      }
    }
  return best;
}

/**
 * Efface un petit défaut de rayon `r` centré en (cx, cy), sur place : il est remplacé par un
 * morceau voisin de l'image, fondu dans la lumière de son entourage. Renvoie false si rien n'a
 * pu être fait (défaut trop près des bords).
 */
export function removeBlemish(px: Pixels, cx: number, cy: number, r: number): boolean {
  const off = blemishOffset(px, cx, cy, r);
  if (!off) return false;
  const { data: d, width: w, height: h } = px;
  const src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = x + off.x,
        sy = y + off.y;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const p = (y * w + x) * 4,
        q = (sy * w + sx) * 4;
      src[p] = d[q];
      src[p + 1] = d[q + 1];
      src[p + 2] = d[q + 2];
      src[p + 3] = d[q + 3];
    }
  const mask = discMask(w, h, cx, cy, r);
  d.set(patchBlend(px, { data: src, width: w, height: h }, mask, Math.max(2, r * 0.7)));
  return true;
}
