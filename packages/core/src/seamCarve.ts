import type { Pixels } from './adjust';

/*
 * Mise à l'échelle selon le contenu (Photoshop : Content-Aware Scale), par « seam carving » :
 * pour rétrécir, on retire des chemins d'un pixel de large (les coutures) qui passent par les
 * zones les moins détaillées ; pour agrandir, on les duplique. Ciel, murs et fonds unis
 * absorbent le changement, visages et objets nets gardent leurs proportions.
 */

export interface CarveOptions {
  /** Zone à protéger : un octet par pixel, non nul = ne pas toucher. */
  protect?: Uint8Array;
  /** Appelé de temps en temps pour laisser respirer l'interface ; renvoie true pour annuler. */
  tick?: (done: number, total: number) => Promise<boolean | void> | boolean | void;
}

/** Côté minimal après un redimensionnement. */
export const MIN_SIDE = 8;
const PROTECT_COST = 1e6;

const lumaAt = (d: Uint8ClampedArray, i: number) =>
  (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * (d[i + 3] / 255);

/** Transpose des pixels RGBA (largeur ↔ hauteur). */
function transpose(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = (y * w + x) * 4;
      const b = (x * h + y) * 4;
      out[b] = src[a];
      out[b + 1] = src[a + 1];
      out[b + 2] = src[a + 2];
      out[b + 3] = src[a + 3];
    }
  return out;
}

function transposeMask(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + y] = src[y * w + x];
  return out;
}

/**
 * Trouve `count` coutures verticales (une colonne par ligne, d'une ligne à l'autre au plus un pixel
 * d'écart) dans l'ordre où on les retire, exprimées en colonnes de l'image d'origine.
 */
async function findSeams(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  count: number,
  protect: Uint8Array | undefined,
  tick: CarveOptions['tick'],
  progress: [number, number],
): Promise<Int32Array[] | null> {
  const buf = new Uint8ClampedArray(data); // copie de travail, rétrécie colonne après colonne
  const prot = protect ? new Uint8Array(protect) : null;
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = lumaAt(buf, i * 4);
  const E = new Float32Array(W * H);
  const M = new Float32Array(W * H);
  const col = new Int32Array(W * H); // colonne d'origine de chaque pixel courant
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) col[y * W + x] = x;
  let w = W;

  const energy = (x: number, y: number): number => {
    const r = y * W;
    const xl = x > 0 ? x - 1 : x,
      xr = x < w - 1 ? x + 1 : x;
    const yu = y > 0 ? y - 1 : y,
      yd = y < H - 1 ? y + 1 : y;
    let e =
      Math.abs(L[r + xr] - L[r + xl]) +
      Math.abs(L[yd * W + x] - L[yu * W + x]) +
      0.5 * Math.abs(buf[(r + xr) * 4 + 3] - buf[(r + xl) * 4 + 3]) +
      0.5 * Math.abs(buf[(yd * W + x) * 4 + 3] - buf[(yu * W + x) * 4 + 3]);
    if (prot && prot[r + x]) e += PROTECT_COST;
    return e;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) E[y * W + x] = energy(x, y);

  const seams: Int32Array[] = [];
  for (let k = 0; k < count; k++) {
    // Coût cumulé, de haut en bas.
    for (let x = 0; x < w; x++) M[x] = E[x];
    for (let y = 1; y < H; y++) {
      const r = y * W,
        p = (y - 1) * W;
      for (let x = 0; x < w; x++) {
        let m = M[p + x];
        if (x > 0 && M[p + x - 1] < m) m = M[p + x - 1];
        if (x < w - 1 && M[p + x + 1] < m) m = M[p + x + 1];
        M[r + x] = E[r + x] + m;
      }
    }
    // Remontée depuis la meilleure case de la dernière ligne.
    const pos = new Int32Array(H);
    let best = 0;
    const last = (H - 1) * W;
    for (let x = 1; x < w; x++) if (M[last + x] < M[last + best]) best = x;
    pos[H - 1] = best;
    for (let y = H - 1; y > 0; y--) {
      const p = (y - 1) * W;
      const x = pos[y];
      let bx = x;
      if (x > 0 && M[p + x - 1] < M[p + bx]) bx = x - 1;
      if (x < w - 1 && M[p + x + 1] < M[p + bx]) bx = x + 1;
      pos[y - 1] = bx;
    }
    const orig = new Int32Array(H);
    for (let y = 0; y < H; y++) orig[y] = col[y * W + pos[y]];
    seams.push(orig);
    // Retrait de la couture.
    for (let y = 0; y < H; y++) {
      const r = y * W,
        s = pos[y];
      const n = w - 1 - s;
      if (n > 0) {
        buf.copyWithin((r + s) * 4, (r + s + 1) * 4, (r + w) * 4);
        L.copyWithin(r + s, r + s + 1, r + w);
        E.copyWithin(r + s, r + s + 1, r + w);
        col.copyWithin(r + s, r + s + 1, r + w);
        if (prot) prot.copyWithin(r + s, r + s + 1, r + w);
      }
    }
    w--;
    // Énergie : seulement près de la couture.
    for (let y = 0; y < H; y++) {
      const s = pos[y];
      const lo = Math.max(0, s - 3),
        hi = Math.min(w - 1, s + 3);
      for (let x = lo; x <= hi; x++) E[y * W + x] = energy(x, y);
    }
    if (tick && k % 8 === 7) {
      if (await tick(progress[0] + k + 1, progress[1])) return null;
    }
  }
  return seams;
}

/** Retire ou ajoute `delta` colonnes (négatif : retire) selon le contenu. */
async function carveColumns(
  src: Pixels,
  delta: number,
  protect: Uint8Array | undefined,
  tick: CarveOptions['tick'],
  progress: [number, number],
): Promise<{ px: Pixels; protect?: Uint8Array } | null> {
  const { data, width: W, height: H } = src;
  const count = Math.abs(delta);
  if (count === 0) return { px: src, protect };
  const seams = await findSeams(data, W, H, count, protect, tick, progress);
  if (!seams) return null;
  if (delta < 0) {
    // Retrait : on marque les colonnes retirées de chaque ligne.
    const gone = new Uint8Array(W * H);
    for (const s of seams) for (let y = 0; y < H; y++) gone[y * W + s[y]] = 1;
    const nw = W - count;
    const out = new Uint8ClampedArray(nw * H * 4);
    const mask = protect ? new Uint8Array(nw * H) : undefined;
    for (let y = 0; y < H; y++) {
      let o = y * nw;
      for (let x = 0; x < W; x++) {
        if (gone[y * W + x]) continue;
        out.set(data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), o * 4);
        if (mask && protect) mask[o] = protect[y * W + x];
        o++;
      }
    }
    return { px: { data: out, width: nw, height: H }, protect: mask };
  }
  // Ajout : chaque colonne trouvée est dupliquée (moyenne avec sa voisine de droite).
  const dup = new Uint8Array(W * H);
  for (const s of seams) for (let y = 0; y < H; y++) dup[y * W + s[y]]++;
  const nw = W + count;
  const out = new Uint8ClampedArray(nw * H * 4);
  const mask = protect ? new Uint8Array(nw * H) : undefined;
  for (let y = 0; y < H; y++) {
    let o = y * nw;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      out.set(data.subarray(i, i + 4), o * 4);
      if (mask && protect) mask[o] = protect[y * W + x];
      o++;
      const n = dup[y * W + x];
      const j = x < W - 1 ? i + 4 : i;
      for (let c = 0; c < n; c++) {
        for (let k = 0; k < 4; k++) out[o * 4 + k] = (data[i + k] + data[j + k]) / 2;
        if (mask && protect) mask[o] = protect[y * W + x];
        o++;
      }
    }
  }
  return { px: { data: out, width: nw, height: H }, protect: mask };
}

/**
 * Change la taille de l'image selon son contenu. Renvoie null si `tick` demande d'annuler.
 * Les côtés sont bornés à `MIN_SIDE` ; un agrandissement au-delà du double n'a pas de sens
 * (la même couture serait dupliquée plusieurs fois) : l'appelant le limite.
 */
export async function contentAwareScale(
  src: Pixels,
  width: number,
  height: number,
  opts: CarveOptions = {},
): Promise<Pixels | null> {
  const tw = Math.max(MIN_SIDE, Math.round(width));
  const th = Math.max(MIN_SIDE, Math.round(height));
  const total = Math.abs(tw - src.width) + Math.abs(th - src.height);
  let cur: Pixels = src;
  let prot = opts.protect && opts.protect.length === src.width * src.height ? opts.protect : undefined;
  const a = await carveColumns(cur, tw - cur.width, prot, opts.tick, [0, total]);
  if (!a) return null;
  cur = a.px;
  prot = a.protect;
  if (th !== cur.height) {
    // Même chose pour la hauteur, en tournant l'image d'un quart de tour.
    const t = { data: transpose(cur.data, cur.width, cur.height), width: cur.height, height: cur.width };
    const tp = prot ? transposeMask(prot, cur.width, cur.height) : undefined;
    const b = await carveColumns(t, th - t.width, tp, opts.tick, [Math.abs(tw - src.width), total]);
    if (!b) return null;
    cur = { data: transpose(b.px.data, b.px.width, b.px.height), width: b.px.height, height: b.px.width };
  }
  return cur;
}
