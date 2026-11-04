import { parseColor } from './color';
import type { Vec } from './geometry';
import type { Color, Paint } from './types';

/*
 * Filet de dégradé (comme le Remplissage en filet d'Affinity et le Filet d'Illustrator) : une
 * grille de points colorés posée sur l'objet. Chaque point se déplace et prend sa couleur ; les
 * couleurs se fondent entre les points. Les points sont en fractions de la boîte de l'objet,
 * rangée par rangée, (cols + 1) × (rows + 1) points.
 *
 * Le rendu (toile, SVG) passe par `rasterizeMesh`, qui peint l'image du filet pixel par pixel :
 * chaque case est découpée en petits triangles dont les couleurs se fondent (ombrage de Gouraud).
 */

export type MeshPaint = Extract<Paint, { type: 'mesh' }>;

/** Nombre de points d'une rangée. */
export const meshWidth = (m: MeshPaint): number => m.cols + 1;

/** Indice du point (colonne i, rangée j). */
export const meshIndex = (m: MeshPaint, i: number, j: number): number => j * (m.cols + 1) + i;

/** Filet régulier d'une seule couleur. */
export function newMesh(color: Color, cols = 1, rows = 1): MeshPaint {
  const points: Vec[] = [];
  const colors: Color[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      points.push({ x: i / cols, y: j / rows });
      colors.push(color);
    }
  return { type: 'mesh', cols, rows, points, colors };
}

/** Le filet a le bon nombre de points et de couleurs (fichier lu). */
export function isValidMesh(m: MeshPaint): boolean {
  const n = (m.cols + 1) * (m.rows + 1);
  return (
    Number.isInteger(m.cols) &&
    Number.isInteger(m.rows) &&
    m.cols >= 1 &&
    m.rows >= 1 &&
    m.cols <= 64 &&
    m.rows <= 64 &&
    Array.isArray(m.points) &&
    Array.isArray(m.colors) &&
    m.points.length === n &&
    m.colors.length === n &&
    // Fichier abîmé ou piégé : chaque point a des coordonnées finies, chaque couleur est du texte.
    m.points.every((p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y)) &&
    m.colors.every((c) => typeof c === 'string')
  );
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Mélange de deux couleurs (t de 0 à 1), transparence comprise. */
export function lerpColor(a: Color, b: Color, t: number): Color {
  const p = parseColor(a),
    q = parseColor(b);
  const h = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  const alpha = lerp(p.a, q.a, t);
  return `#${h(lerp(p.r, q.r, t))}${h(lerp(p.g, q.g, t))}${h(lerp(p.b, q.b, t))}${alpha < 1 ? h(alpha * 255) : ''}`;
}

/** Ajoute une colonne à la position `u` (0 à cols, fractionnaire) : points et couleurs interpolés. */
export function insertMeshColumn(m: MeshPaint, u: number): MeshPaint {
  const i = Math.min(m.cols - 1, Math.max(0, Math.floor(u)));
  const f = u - i;
  if (f <= 1e-3 || f >= 1 - 1e-3) return m;
  const points: Vec[] = [];
  const colors: Color[] = [];
  for (let j = 0; j <= m.rows; j++)
    for (let k = 0; k <= m.cols; k++) {
      const at = meshIndex(m, k, j);
      points.push(m.points[at]);
      colors.push(m.colors[at]);
      if (k === i) {
        const b = meshIndex(m, k + 1, j);
        points.push(lerpVec(m.points[at], m.points[b], f));
        colors.push(lerpColor(m.colors[at], m.colors[b], f));
      }
    }
  return { ...m, cols: m.cols + 1, points, colors };
}

/** Ajoute une rangée à la position `v` (0 à rows, fractionnaire). */
export function insertMeshRow(m: MeshPaint, v: number): MeshPaint {
  const j = Math.min(m.rows - 1, Math.max(0, Math.floor(v)));
  const f = v - j;
  if (f <= 1e-3 || f >= 1 - 1e-3) return m;
  const points = m.points.slice(0, meshIndex(m, 0, j + 1));
  const colors = m.colors.slice(0, meshIndex(m, 0, j + 1));
  for (let i = 0; i <= m.cols; i++) {
    const a = meshIndex(m, i, j),
      b = meshIndex(m, i, j + 1);
    points.push(lerpVec(m.points[a], m.points[b], f));
    colors.push(lerpColor(m.colors[a], m.colors[b], f));
  }
  points.push(...m.points.slice(meshIndex(m, 0, j + 1)));
  colors.push(...m.colors.slice(meshIndex(m, 0, j + 1)));
  return { ...m, rows: m.rows + 1, points, colors };
}

/** Retire la colonne `i` et la rangée `j` d'un point du milieu (les bords restent). */
export function removeMeshLines(m: MeshPaint, i: number, j: number): MeshPaint {
  let out = m;
  if (i > 0 && i < m.cols) {
    const keep = (k: number) => k % (out.cols + 1) !== i;
    out = {
      ...out,
      cols: out.cols - 1,
      points: out.points.filter((_, k) => keep(k)),
      colors: out.colors.filter((_, k) => keep(k)),
    };
  }
  if (j > 0 && j < m.rows) {
    const w = out.cols + 1;
    const keep = (k: number) => Math.floor(k / w) !== j;
    out = {
      ...out,
      rows: out.rows - 1,
      points: out.points.filter((_, k) => keep(k)),
      colors: out.colors.filter((_, k) => keep(k)),
    };
  }
  return out;
}

/** Point d'une case (colonne i, rangée j) aux coordonnées locales s, t (0 à 1), en fractions de la boîte. */
function cellPoint(m: MeshPaint, i: number, j: number, s: number, t: number): Vec {
  const a = m.points[meshIndex(m, i, j)],
    b = m.points[meshIndex(m, i + 1, j)],
    c = m.points[meshIndex(m, i + 1, j + 1)],
    d = m.points[meshIndex(m, i, j + 1)];
  return lerpVec(lerpVec(a, b, s), lerpVec(d, c, s), t);
}

/**
 * Position dans le filet (u de 0 à cols, v de 0 à rows) d'un point en fractions de la boîte, ou
 * null s'il est hors du filet. Inverse la forme bilinéaire de chaque case par la méthode de Newton.
 */
export function meshLocate(m: MeshPaint, p: Vec): { u: number; v: number } | null {
  for (let j = 0; j < m.rows; j++)
    for (let i = 0; i < m.cols; i++) {
      let s = 0.5,
        t = 0.5;
      for (let it = 0; it < 20; it++) {
        const q = cellPoint(m, i, j, s, t);
        const e = 1e-4;
        const qs = cellPoint(m, i, j, s + e, t),
          qt = cellPoint(m, i, j, s, t + e);
        const a = (qs.x - q.x) / e,
          b = (qt.x - q.x) / e,
          c = (qs.y - q.y) / e,
          d = (qt.y - q.y) / e;
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-12) break;
        const rx = p.x - q.x,
          ry = p.y - q.y;
        s += (d * rx - b * ry) / det;
        t += (a * ry - c * rx) / det;
      }
      const tol = 1e-6;
      if (s >= -tol && s <= 1 + tol && t >= -tol && t <= 1 + tol) {
        const q = cellPoint(m, i, j, s, t);
        if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-4)
          return { u: i + Math.min(1, Math.max(0, s)), v: j + Math.min(1, Math.max(0, t)) };
      }
    }
  return null;
}

/** Ajoute une colonne et une rangée qui passent par `p` (fractions de la boîte) ; renvoie le nouveau point. */
export function splitMeshAt(m: MeshPaint, p: Vec): { mesh: MeshPaint; index: number } | null {
  const at = meshLocate(m, p);
  if (!at) return null;
  let out = insertMeshColumn(m, at.u);
  const i = out === m ? Math.round(at.u) : Math.floor(at.u) + 1;
  const next = insertMeshRow(out, at.v);
  const j = next === out ? Math.round(at.v) : Math.floor(at.v) + 1;
  out = next;
  if (out === m) return null;
  const index = meshIndex(out, i, j);
  // Le nouveau point est exactement sous le pointeur.
  out = { ...out, points: out.points.map((q, k) => (k === index ? { x: p.x, y: p.y } : q)) };
  return { mesh: out, index };
}

/** Dégradé de bout en bout : un point coloré par coin (haut gauche, haut droit, bas droit, bas gauche). */
export function cornerMesh(colors: [Color, Color, Color, Color]): MeshPaint {
  const m = newMesh(colors[0]);
  return { ...m, colors: [colors[0], colors[1], colors[3], colors[2]] };
}

/**
 * Image du filet sur une boîte de w × h pixels (RGBA, non prémultipliée). Hors du filet (points
 * déplacés vers l'intérieur), l'image reste transparente.
 */
export function rasterizeMesh(m: MeshPaint, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  if (!isValidMesh(m) || w <= 0 || h <= 0) return out;
  const rgba = m.colors.map((c) => {
    const p = parseColor(c);
    return [p.r, p.g, p.b, p.a * 255];
  });
  // Découpe de chaque case : assez fine pour que les cases courbées restent lisses.
  const sub = Math.max(2, Math.min(16, Math.ceil(Math.max(w / m.cols, h / m.rows) / 12)));
  const tri = (
    ax: number,
    ay: number,
    ca: number[],
    bx: number,
    by: number,
    cb: number[],
    cx: number,
    cy: number,
    cc: number[],
  ) => {
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-9) return;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
      x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))),
      y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    const e = -1e-7;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const l1 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / det;
        const l2 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < e || l2 < e || l3 < e) continue;
        const o = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) out[o + k] = l1 * ca[k] + l2 * cb[k] + l3 * cc[k];
      }
    }
  };
  const colorAt = (i: number, j: number, s: number, t: number): number[] => {
    const a = rgba[meshIndex(m, i, j)],
      b = rgba[meshIndex(m, i + 1, j)],
      c = rgba[meshIndex(m, i + 1, j + 1)],
      d = rgba[meshIndex(m, i, j + 1)];
    return [0, 1, 2, 3].map((k) => lerp(lerp(a[k], b[k], s), lerp(d[k], c[k], s), t));
  };
  for (let j = 0; j < m.rows; j++)
    for (let i = 0; i < m.cols; i++) {
      const pts: { x: number; y: number; c: number[] }[] = [];
      for (let b = 0; b <= sub; b++)
        for (let a = 0; a <= sub; a++) {
          const q = cellPoint(m, i, j, a / sub, b / sub);
          pts.push({ x: q.x * w, y: q.y * h, c: colorAt(i, j, a / sub, b / sub) });
        }
      for (let b = 0; b < sub; b++)
        for (let a = 0; a < sub; a++) {
          const p00 = pts[b * (sub + 1) + a],
            p10 = pts[b * (sub + 1) + a + 1],
            p01 = pts[(b + 1) * (sub + 1) + a],
            p11 = pts[(b + 1) * (sub + 1) + a + 1];
          tri(p00.x, p00.y, p00.c, p10.x, p10.y, p10.c, p11.x, p11.y, p11.c);
          tri(p00.x, p00.y, p00.c, p11.x, p11.y, p11.c, p01.x, p01.y, p01.c);
        }
    }
  return out;
}

/** Couleur moyenne du filet (aperçu dans les listes, pastilles). */
export function meshAverage(m: MeshPaint): Color {
  let r = 0,
    g = 0,
    b = 0,
    a = 0;
  for (const c of m.colors) {
    const p = parseColor(c);
    r += p.r;
    g += p.g;
    b += p.b;
    a += p.a;
  }
  const n = m.colors.length || 1;
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  const alpha = a / n;
  return `#${h(r / n)}${h(g / n)}${h(b / n)}${alpha < 1 ? h(alpha * 255) : ''}`;
}

// ————— Image PNG (export SVG) —————

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * PNG sans compression (blocs « stored » du format zlib) : petit, sans dépendance, lu partout.
 * Sert aux images du filet dans le SVG exporté.
 */
export function encodePngRgba(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78;
  z[1] = 0x01;
  let o = 2;
  for (let k = 0; k < blocks; k++) {
    const part = raw.subarray(k * 65535, Math.min(raw.length, (k + 1) * 65535));
    z[o++] = k === blocks - 1 ? 1 : 0;
    z[o++] = part.length & 0xff;
    z[o++] = part.length >> 8;
    z[o++] = ~part.length & 0xff;
    z[o++] = (~part.length >> 8) & 0xff;
    z.set(part, o);
    o += part.length;
  }
  let s1 = 1,
    s2 = 0;
  for (let i = 0; i < raw.length; i++) {
    s1 = (s1 + raw[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = ((s2 << 16) | s1) >>> 0;
  z[o++] = adler >>> 24;
  z[o++] = (adler >>> 16) & 0xff;
  z[o++] = (adler >>> 8) & 0xff;
  z[o++] = adler & 0xff;
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z.subarray(0, o)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/** Image du filet en adresse `data:` PNG (au plus 256 pixels de côté). */
export function meshDataUrl(m: MeshPaint, w: number, h: number): string {
  const k = Math.min(1, 256 / Math.max(w, h, 1));
  const W = Math.max(2, Math.round(w * k)),
    H = Math.max(2, Math.round(h * k));
  const png = encodePngRgba(rasterizeMesh(m, W, H), W, H);
  let bin = '';
  for (let i = 0; i < png.length; i += 0x8000)
    bin += String.fromCharCode(...png.subarray(i, Math.min(png.length, i + 0x8000)));
  return `data:image/png;base64,${btoa(bin)}`;
}
