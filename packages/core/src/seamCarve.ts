import { adjustmentEngine, type Pixels, type SeamSession } from './adjust';

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
  /**
   * Version pleine résolution de l'image, `k` fois plus grande (nombre entier) que celle qu'on
   * traite : les coutures sont cherchées sur la petite, puis rejouées sur la grande (chacune y
   * retire ou duplique une bande de `k` colonnes). Le résultat est alors la grande image, dont la
   * taille tombe sur un multiple de `k` près de la cible.
   */
  hi?: { pixels: Pixels; k: number };
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

function engineSession(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  protect: Uint8Array | undefined,
): SeamSession | null {
  try {
    return adjustmentEngine()?.carve?.(data, W, H, protect) ?? null;
  } catch {
    return null;
  }
}

/**
 * Trouve `count` coutures verticales (une colonne par ligne, d'une ligne à l'autre au plus un pixel
 * d'écart) dans l'ordre où on les retire, exprimées en colonnes de l'image d'origine.
 */
export async function findSeams(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  count: number,
  protect: Uint8Array | undefined,
  tick: CarveOptions['tick'],
  progress: [number, number],
): Promise<Int32Array[] | null> {
  // Le moteur Rust trouve les mêmes coutures, plus vite ; en cas de souci on reprend en TypeScript.
  const session = engineSession(data, W, H, protect);
  if (session) {
    const found: Int32Array[] = [];
    try {
      while (found.length < count) {
        const n = Math.min(8, count - found.length);
        const got = session.next(n);
        if (got.length < n) throw new Error('coutures manquantes');
        found.push(...got);
        if (tick && n === 8 && (await tick(progress[0] + found.length, progress[1]))) return null;
      }
      return found;
    } catch (e) {
      console.warn('Moteur Rust indisponible (échelle selon le contenu), calcul en TypeScript :', e);
    } finally {
      session.end();
    }
  }
  return findSeamsTs(data, W, H, count, protect, tick, progress);
}

/** Calcul TypeScript d'origine (référence du moteur Rust, et solution de repli). */
export async function findSeamsTs(
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

/**
 * Retire (`add` faux) ou duplique (`add` vrai) les coutures dans une image de `ch` canaux par pixel.
 * L'image fait `W × H` ; les coutures viennent d'une version `k` fois plus petite (k = 1 : la même).
 * Chaque couture touche une bande de `k` colonnes ; les colonnes en trop à droite restent telles quelles.
 */
function applySeams<T extends Uint8ClampedArray | Uint8Array>(
  data: T,
  ch: number,
  W: number,
  H: number,
  seams: Int32Array[],
  smallW: number,
  smallH: number,
  k: number,
  add: boolean,
  make: (n: number) => T,
): { data: T; width: number } {
  const mark = new Uint8Array(smallW * smallH);
  for (const s of seams) for (let y = 0; y < smallH; y++) mark[y * smallW + s[y]]++;
  const nw = add ? W + seams.length * k : W - seams.length * k;
  const out = make(nw * H * ch);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(smallH - 1, Math.floor(y / k));
    const row = y * W;
    let o = y * nw;
    for (let b = 0; b < smallW; b++) {
      const n = mark[sy * smallW + b];
      const from = (row + b * k) * ch;
      const to = from + k * ch;
      if (!add && n) continue;
      out.set(data.subarray(from, to), o * ch);
      o += k;
      for (let c = 0; add && c < n; c++) {
        out.set(data.subarray(from, to), o * ch);
        o += k;
      }
    }
    // Colonnes en trop (largeur non multiple de k).
    const rest = W - smallW * k;
    if (rest > 0) out.set(data.subarray((row + smallW * k) * ch, (row + W) * ch), o * ch);
  }
  return { data: out, width: nw };
}

interface Work {
  px: Pixels;
  protect?: Uint8Array;
  /** Pleine résolution, quand on en traite une. */
  hi?: Pixels;
}

/** Retire ou ajoute `delta` colonnes (négatif : retire) selon le contenu. */
async function carveColumns(
  src: Work,
  delta: number,
  k: number,
  tick: CarveOptions['tick'],
  progress: [number, number],
): Promise<Work | null> {
  const { data, width: W, height: H } = src.px;
  const count = Math.abs(delta);
  if (count === 0) return src;
  const seams = await findSeams(data, W, H, count, src.protect, tick, progress);
  if (!seams) return null;
  const add = delta > 0;
  const small = applySeams(data, 4, W, H, seams, W, H, 1, add, (n) => new Uint8ClampedArray(n));
  const mask = src.protect
    ? applySeams(src.protect, 1, W, H, seams, W, H, 1, add, (n) => new Uint8Array(n)).data
    : undefined;
  const out: Work = { px: { data: small.data, width: small.width, height: H }, protect: mask };
  if (src.hi) {
    const hi = applySeams(
      src.hi.data,
      4,
      src.hi.width,
      src.hi.height,
      seams,
      W,
      H,
      k,
      add,
      (n) => new Uint8ClampedArray(n),
    );
    out.hi = { data: hi.data, width: hi.width, height: src.hi.height };
  }
  return out;
}

const turn = (p: Pixels): Pixels => ({
  data: transpose(p.data, p.width, p.height),
  width: p.height,
  height: p.width,
});

/**
 * Change la taille de l'image selon son contenu. Renvoie null si `tick` demande d'annuler.
 * Les côtés sont bornés à `MIN_SIDE` ; un agrandissement au-delà du double n'a pas de sens
 * (la même couture serait dupliquée plusieurs fois) : l'appelant le limite.
 * Avec `opts.hi`, le résultat est la version pleine résolution (voir `CarveOptions.hi`).
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
  const k = opts.hi?.k ?? 1;
  let cur: Work = {
    px: src,
    protect: opts.protect && opts.protect.length === src.width * src.height ? opts.protect : undefined,
    hi: opts.hi?.pixels,
  };
  const a = await carveColumns(cur, tw - cur.px.width, k, opts.tick, [0, total]);
  if (!a) return null;
  cur = a;
  if (th !== cur.px.height) {
    // Même chose pour la hauteur, en tournant l'image d'un quart de tour.
    const px = cur.px;
    const t: Work = {
      px: turn(px),
      protect: cur.protect ? transposeMask(cur.protect, px.width, px.height) : undefined,
      hi: cur.hi ? turn(cur.hi) : undefined,
    };
    const b = await carveColumns(t, th - t.px.width, k, opts.tick, [Math.abs(tw - src.width), total]);
    if (!b) return null;
    cur = { px: turn(b.px), hi: b.hi ? turn(b.hi) : undefined };
  }
  return cur.hi ?? cur.px;
}
