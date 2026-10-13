import type { Pixels } from './adjust';

/*
 * Masques de pixels (sélections, zones à remplir) : un octet par pixel, 0 = hors du masque,
 * 255 = dedans. Sans dépendance au navigateur.
 */

/**
 * Pixels semblables à celui de départ (baguette magique, pot de peinture). `tolerance` de 0 à
 * 255 : écart maximal admis sur chaque canal. `contiguous` : seulement les pixels reliés au
 * départ ; sinon tous les pixels semblables de l'image. Les bords sont légèrement adoucis.
 */
export function floodMask(
  px: Pixels,
  x: number,
  y: number,
  tolerance: number,
  contiguous = true,
): Uint8Array {
  const { data, width: w, height: h } = px;
  const mask = new Uint8Array(w * h);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return mask;
  const s = (y * w + x) * 4;
  const r0 = data[s],
    g0 = data[s + 1],
    b0 = data[s + 2],
    a0 = data[s + 3];
  const tol = Math.max(0, tolerance);
  /** Écart au pixel de départ : 0 identique, au-delà de `tol` hors du masque. */
  const diff = (i: number) => {
    const p = i * 4;
    const a = data[p + 3];
    // Deux pixels transparents se ressemblent, quelle que soit leur couleur cachée.
    if (a0 < 8 && a < 8) return 0;
    return Math.max(
      Math.abs(data[p] - r0),
      Math.abs(data[p + 1] - g0),
      Math.abs(data[p + 2] - b0),
      Math.abs(a - a0),
    );
  };
  const inside = (i: number) => diff(i) <= tol;
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (inside(i)) mask[i] = 255;
  } else {
    const stack = new Int32Array(w * h);
    let sp = 0;
    stack[sp++] = y * w + x;
    mask[y * w + x] = 255;
    while (sp) {
      const i = stack[--sp];
      const cx = i % w,
        cy = (i / w) | 0;
      if (cx > 0 && !mask[i - 1] && inside(i - 1)) {
        mask[i - 1] = 255;
        stack[sp++] = i - 1;
      }
      if (cx < w - 1 && !mask[i + 1] && inside(i + 1)) {
        mask[i + 1] = 255;
        stack[sp++] = i + 1;
      }
      if (cy > 0 && !mask[i - w] && inside(i - w)) {
        mask[i - w] = 255;
        stack[sp++] = i - w;
      }
      if (cy < h - 1 && !mask[i + w] && inside(i + w)) {
        mask[i + w] = 255;
        stack[sp++] = i + w;
      }
    }
  }
  // Adoucissement : les voisins extérieurs proches de la tolérance entrent en partie.
  if (tol > 0) {
    const soft = Math.max(4, tol * 0.5);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const i = yy * w + xx;
        if (mask[i]) continue;
        const near =
          (xx > 0 && mask[i - 1] === 255) ||
          (xx < w - 1 && mask[i + 1] === 255) ||
          (yy > 0 && mask[i - w] === 255) ||
          (yy < h - 1 && mask[i + w] === 255);
        if (!near) continue;
        const d = diff(i) - tol;
        if (d < soft) mask[i] = Math.round(128 * (1 - d / soft));
      }
  }
  return mask;
}

/**
 * Contour d'un masque (seuil à la moitié), en lignes brisées dans les coordonnées du masque :
 * ce sont les « fourmis » qui entourent une sélection. Carrés marchants, puis segments chaînés.
 */
export function maskOutline(mask: Uint8Array, w: number, h: number, threshold = 128): number[][] {
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= threshold ? 1 : 0;
  // Segments sur la grille des coins de pixels : arêtes entre un pixel dedans et un pixel dehors.
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (w + 1) + x;
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const k = key(x1, y1);
    const list = next.get(k);
    if (list) list.push(key(x2, y2));
    else next.set(k, [key(x2, y2)]);
  };
  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      const cur = at(x, y);
      // Arête du haut du pixel (x, y) : entre (x, y-1) et (x, y).
      if (x < w && cur !== at(x, y - 1)) {
        if (cur) add(x, y, x + 1, y);
        else add(x + 1, y, x, y);
      }
      // Arête de gauche : entre (x-1, y) et (x, y).
      if (y < h && cur !== at(x - 1, y)) {
        if (cur) add(x, y + 1, x, y);
        else add(x, y, x, y + 1);
      }
    }
  const lines: number[][] = [];
  for (const [start, list] of next) {
    while (list.length) {
      let k = list.pop()!;
      const line = [start % (w + 1), Math.floor(start / (w + 1))];
      let prevDir = -1;
      for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
        const x = k % (w + 1),
          y = Math.floor(k / (w + 1));
        const lx = line[line.length - 2];
        const dir = x !== lx ? 0 : 1;
        // On ne garde que les coins : les points alignés sont fusionnés.
        if (dir === prevDir && line.length >= 4) {
          line[line.length - 2] = x;
          line[line.length - 1] = y;
        } else line.push(x, y);
        prevDir = dir;
        const nl = next.get(k);
        if (!nl || !nl.length) break;
        k = nl.pop()!;
      }
      lines.push(line);
    }
  }
  return lines;
}

/** Boîte des pixels non nuls d'un masque, ou null s'il est vide. */
export function maskBounds(
  mask: Uint8Array,
  w: number,
  h: number,
  threshold = 1,
): { x: number; y: number; width: number; height: number } | null {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++)
      if (mask[row + x] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
