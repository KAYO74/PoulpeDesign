import type { Pixels } from './adjust';

/*
 * Gomme magique : reconstruit une zone de l'image à partir du reste de l'image, sans IA ni
 * service en ligne. C'est la méthode du « remplissage d'après le contenu » de Photoshop
 * (PatchMatch, Barnes et al. 2009 ; complétion d'image de Wexler et al. 2007) :
 *
 * 1. l'image est réduite plusieurs fois de moitié, jusqu'à ce que le trou soit petit ;
 * 2. à chaque taille, chaque petit carré (« patch ») qui touche le trou cherche le carré le plus
 *    ressemblant hors du trou (recherche aléatoire et propagation entre voisins) ;
 * 3. chaque pixel du trou prend la moyenne des pixels que lui proposent les carrés qui le
 *    couvrent ; on recommence quelques fois, puis on passe à la taille au-dessus.
 *
 * Ça marche très bien sur les fonds naturels (ciel, herbe, sable, murs, eau) et pour effacer de
 * petits objets ; moins bien quand il faut inventer une structure qui n'existe nulle part ailleurs.
 */

export interface InpaintOptions {
  /** Côté des carrés comparés, impair (7 par défaut). */
  patch?: number;
  /** Graine du tirage aléatoire, pour des résultats reproductibles. */
  seed?: number;
  /** Avancement, de 0 à 1. */
  onProgress?: (f: number) => void;
}

interface Level {
  w: number;
  h: number;
  /** RGBA en flottants. */
  img: Float32Array;
  /** 1 = pixel à reconstruire. */
  hole: Uint8Array;
}

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function downsample(l: Level): Level {
  const w = Math.max(1, l.w >> 1),
    h = Math.max(1, l.h >> 1);
  const img = new Float32Array(w * h * 4);
  const hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0,
        anyHole = 0;
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(l.w - 1, 2 * x + dx),
            sy = Math.min(l.h - 1, 2 * y + dy);
          const si = sy * l.w + sx;
          if (l.hole[si]) {
            anyHole = 1;
            continue;
          }
          for (let c = 0; c < 4; c++) acc[c] += l.img[si * 4 + c];
          n++;
        }
      const i = y * w + x;
      hole[i] = anyHole;
      if (n) for (let c = 0; c < 4; c++) img[i * 4 + c] = acc[c] / n;
    }
  return { w, h, img, hole };
}

/** Premier remplissage du trou : de proche en proche, par la moyenne des voisins connus. */
function onionFill(l: Level) {
  const { w, h, img } = l;
  const known = new Uint8Array(w * h);
  let remaining = 0;
  for (let i = 0; i < w * h; i++) {
    known[i] = l.hole[i] ? 0 : 1;
    if (!known[i]) remaining++;
  }
  if (remaining === w * h) return;
  while (remaining > 0) {
    const fill: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let n = 0;
        const acc = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx,
              ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (!known[j]) continue;
            for (let c = 0; c < 4; c++) acc[c] += img[j * 4 + c];
            n++;
          }
        if (n) {
          for (let c = 0; c < 4; c++) img[i * 4 + c] = acc[c] / n;
          fill.push(i);
        }
      }
    if (!fill.length) break;
    for (const i of fill) known[i] = 1;
    remaining -= fill.length;
  }
}

/** Reconstruit les pixels du trou (`hole[i]` non nul) de l'image, sur place. */
export function inpaint(px: Pixels, hole: Uint8Array, opts: InpaintOptions = {}): void {
  const P = Math.max(3, (opts.patch ?? 7) | 1);
  const R = P >> 1;
  const rand = rng(opts.seed ?? 1234567);
  const { width: W, height: H, data } = px;
  let holeCount = 0;
  let hx0 = W,
    hy0 = H,
    hx1 = -1,
    hy1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (hole[y * W + x]) {
        holeCount++;
        if (x < hx0) hx0 = x;
        if (x > hx1) hx1 = x;
        if (y < hy0) hy0 = y;
        if (y > hy1) hy1 = y;
      }
  if (!holeCount || holeCount === W * H) return;

  // Pyramide : on réduit jusqu'à ce que le trou ne fasse plus que quelques carrés.
  const base: Level = { w: W, h: H, img: new Float32Array(W * H * 4), hole: new Uint8Array(W * H) };
  for (let i = 0; i < W * H; i++) {
    base.hole[i] = hole[i] ? 1 : 0;
    for (let c = 0; c < 4; c++) base.img[i * 4 + c] = data[i * 4 + c];
  }
  const levels: Level[] = [base];
  let holeSize = Math.max(hx1 - hx0 + 1, hy1 - hy0 + 1);
  while (holeSize > P * 2 && Math.min(levels[0].w, levels[0].h) > P * 4) {
    levels.unshift(downsample(levels[0]));
    holeSize /= 2;
  }
  onionFill(levels[0]);

  let prevNnf: Int32Array | null = null;
  let prevW = 0,
    prevH = 0;
  const totalWork = levels.reduce((s, l) => s + l.w * l.h, 0);
  let done = 0;

  for (let li = 0; li < levels.length; li++) {
    const L = levels[li];
    const { w, h, img } = L;

    // Pixels dont le carré touche le trou (cibles), et centres de carrés entièrement connus (sources).
    const integral = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += L.hole[y * w + x];
        integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
      }
    }
    const holesIn = (x0: number, y0: number, x1: number, y1: number) => {
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(w, x1);
      y1 = Math.min(h, y1);
      if (x1 <= x0 || y1 <= y0) return 0;
      return (
        integral[y1 * (w + 1) + x1] -
        integral[y0 * (w + 1) + x1] -
        integral[y1 * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0]
      );
    };
    const validSrc = new Uint8Array(w * h);
    const srcList: number[] = [];
    for (let y = R; y < h - R; y++)
      for (let x = R; x < w - R; x++)
        if (holesIn(x - R, y - R, x + R + 1, y + R + 1) === 0) {
          validSrc[y * w + x] = 1;
          srcList.push(y * w + x);
        }
    const targets: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (holesIn(x - R, y - R, x + R + 1, y + R + 1) > 0) targets.push(y * w + x);
    if (!srcList.length || !targets.length) {
      prevNnf = null;
      continue;
    }

    // À partir de la deuxième taille : l'estimation précédente, agrandie, remplit le trou.
    if (li > 0) {
      const prev = levels[li - 1];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!L.hole[i]) continue;
          const pi = Math.min(prev.h - 1, y >> 1) * prev.w + Math.min(prev.w - 1, x >> 1);
          for (let c = 0; c < 4; c++) img[i * 4 + c] = prev.img[pi * 4 + c];
        }
    }

    const nnf = new Int32Array(w * h).fill(-1);
    const dist = new Float32Array(w * h);

    const patchDist = (t: number, s: number, best: number) => {
      const tx = t % w,
        ty = (t / w) | 0;
      const sx = s % w,
        sy = (s / w) | 0;
      let d = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = ty + dy;
        if (yy < 0 || yy >= h) continue;
        const trow = yy * w,
          srow = (sy + dy) * w;
        for (let dx = -R; dx <= R; dx++) {
          const xx = tx + dx;
          if (xx < 0 || xx >= w) continue;
          const a = (trow + xx) * 4,
            b = (srow + sx + dx) * 4;
          const d0 = img[a] - img[b],
            d1 = img[a + 1] - img[b + 1],
            d2 = img[a + 2] - img[b + 2],
            d3 = img[a + 3] - img[b + 3];
          d += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
        }
        if (d >= best) return d;
      }
      return d;
    };
    const randomSrc = () => srcList[(rand() * srcList.length) | 0];

    // Correspondances de départ : celles de la taille précédente, doublées ; sinon au hasard.
    for (const t of targets) {
      let s = -1;
      if (prevNnf) {
        const x = t % w,
          y = (t / w) | 0;
        const pp = prevNnf[Math.min(prevH - 1, y >> 1) * prevW + Math.min(prevW - 1, x >> 1)];
        if (pp >= 0) {
          const cx = 2 * (pp % prevW) + (x & 1),
            cy = 2 * ((pp / prevW) | 0) + (y & 1);
          if (cx < w && cy < h && validSrc[cy * w + cx]) s = cy * w + cx;
        }
      }
      if (s < 0) s = randomSrc();
      nnf[t] = s;
    }

    // Les petites tailles sont peu coûteuses : on y itère beaucoup ; la pleine taille ne fait
    // qu'affiner ce qui vient de la taille d'en dessous.
    const fromTop = levels.length - 1 - li;
    const emIters = fromTop === 0 ? 1 : fromTop === 1 ? 2 : Math.min(6, 2 + fromTop);
    const pmIters = fromTop === 0 ? 2 : 4;
    const maxRadius = fromTop === 0 && li > 0 ? Math.max(8, P * 4) : Math.max(w, h);

    for (let em = 0; em < emIters; em++) {
      for (const t of targets) dist[t] = patchDist(t, nnf[t], Infinity);
      for (let it = 0; it < pmIters; it++) {
        const forward = it % 2 === 0;
        const step = forward ? 1 : -1;
        for (let k = 0; k < targets.length; k++) {
          const t = targets[forward ? k : targets.length - 1 - k];
          const x = t % w,
            y = (t / w) | 0;
          let best = nnf[t],
            bestD = dist[t];
          // Propagation : le voisin déjà traité propose sa correspondance, décalée d'un pixel.
          const tryCand = (s: number) => {
            if (s < 0 || s === best || !validSrc[s]) return;
            const d = patchDist(t, s, bestD);
            if (d < bestD) {
              bestD = d;
              best = s;
            }
          };
          const nx = x - step;
          if (nx >= 0 && nx < w) {
            const q = nnf[y * w + nx];
            if (q >= 0) {
              const qx = (q % w) + step;
              if (qx >= 0 && qx < w) tryCand(q + step);
            }
          }
          const ny = y - step;
          if (ny >= 0 && ny < h) {
            const q = nnf[ny * w + x];
            if (q >= 0) {
              const qy = ((q / w) | 0) + step;
              if (qy >= 0 && qy < h) tryCand(q + step * w);
            }
          }
          // Recherche aléatoire autour de la meilleure correspondance, dans un rayon qui décroît.
          const bx = best % w,
            by = (best / w) | 0;
          for (let r = maxRadius; r >= 1; r >>= 1) {
            const cx = Math.round(bx + (rand() * 2 - 1) * r),
              cy = Math.round(by + (rand() * 2 - 1) * r);
            if (cx < R || cy < R || cx >= w - R || cy >= h - R) continue;
            tryCand(cy * w + cx);
          }
          nnf[t] = best;
          dist[t] = bestD;
        }
      }

      // Vote : chaque pixel du trou prend la moyenne pondérée de ce que proposent les carrés.
      let sigma2: number;
      {
        const ds = targets.map((t) => dist[t]).sort((a, b) => a - b);
        sigma2 = ds[Math.floor(ds.length * 0.75)] / (P * P) + 1;
      }
      const acc = new Float32Array(w * h * 4);
      const wsum = new Float32Array(w * h);
      for (const t of targets) {
        const tx = t % w,
          ty = (t / w) | 0;
        const s = nnf[t];
        const sx = s % w,
          sy = (s / w) | 0;
        const wt = Math.exp(-dist[t] / (P * P) / (2 * sigma2));
        for (let dy = -R; dy <= R; dy++) {
          const yy = ty + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = tx + dx;
            if (xx < 0 || xx >= w) continue;
            const p = yy * w + xx;
            if (!L.hole[p]) continue;
            const q = ((sy + dy) * w + sx + dx) * 4;
            acc[p * 4] += wt * img[q];
            acc[p * 4 + 1] += wt * img[q + 1];
            acc[p * 4 + 2] += wt * img[q + 2];
            acc[p * 4 + 3] += wt * img[q + 3];
            wsum[p] += wt;
          }
        }
      }
      for (let p = 0; p < w * h; p++) {
        if (!L.hole[p] || wsum[p] <= 0) continue;
        const k = 1 / wsum[p];
        img[p * 4] = acc[p * 4] * k;
        img[p * 4 + 1] = acc[p * 4 + 1] * k;
        img[p * 4 + 2] = acc[p * 4 + 2] * k;
        img[p * 4 + 3] = acc[p * 4 + 3] * k;
      }
    }

    prevNnf = nnf;
    prevW = w;
    prevH = h;
    done += w * h;
    opts.onProgress?.(done / totalWork);
  }

  for (let i = 0; i < W * H; i++) {
    if (!base.hole[i]) continue;
    for (let c = 0; c < 4; c++) data[i * 4 + c] = base.img[i * 4 + c];
  }
}
