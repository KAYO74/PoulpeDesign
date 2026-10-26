import { ui } from '../store';
import { commitBitmap, makeCanvas, pixelsOf, selectedImage } from './pixels';

/*
 * Déformation en maillage (Photoshop : Déformation ; Affinity : Déformation de maillage) : une
 * grille de points posée sur le calque de pixels ; on tire les points, l'image suit. Chaque case
 * est coupée en deux triangles, chacun redessiné par une transformation affine.
 */

/** Points de la grille, ligne par ligne, en part de la largeur et de la hauteur (0 à 1). */
export type Mesh = { x: number; y: number }[];

/** Grille régulière de `n` × `n` cases. */
export function regularMesh(n: number): Mesh {
  const pts: Mesh = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pts.push({ x: i / n, y: j / n });
  return pts;
}

/** Dessine `src` déformée : la grille régulière de `n` cases va sur `mesh`, à la taille w × h. */
export function drawWarped(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { width: number; height: number },
  n: number,
  mesh: Mesh,
  w: number,
  h: number,
): void {
  const sw = src.width,
    sh = src.height;
  const at = (i: number, j: number) => mesh[j * (n + 1) + i];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const s = [
        [(i / n) * sw, (j / n) * sh],
        [((i + 1) / n) * sw, (j / n) * sh],
        [((i + 1) / n) * sw, ((j + 1) / n) * sh],
        [(i / n) * sw, ((j + 1) / n) * sh],
      ];
      const d = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)].map((p) => [p.x * w, p.y * h]);
      triangle(ctx, src, [s[0], s[1], s[2]], [d[0], d[1], d[2]]);
      triangle(ctx, src, [s[0], s[2], s[3]], [d[0], d[2], d[3]]);
    }
}

/** Redessine le triangle `s` de l'image sur le triangle `d` (transformation affine). */
function triangle(ctx: CanvasRenderingContext2D, src: CanvasImageSource, s: number[][], d: number[][]) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const [[u0, v0], [u1, v1], [u2, v2]] = d;
  const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!den) return;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / den;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / den;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / den;
  const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / den;
  const e = u0 - a * x0 - c * y0,
    f = v0 - b * x0 - dd * y0;
  // Triangle légèrement agrandi autour de son centre : pas de fines lignes entre les cases.
  const cx = (u0 + u1 + u2) / 3,
    cy = (v0 + v1 + v2) / 3;
  const grow = (x: number, y: number): [number, number] => {
    const dx = x - cx,
      dy = y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * 0.6, y + (dy / l) * 0.6];
  };
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...grow(u0, v0));
  ctx.lineTo(...grow(u1, v1));
  ctx.lineTo(...grow(u2, v2));
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, dd, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

/** Pixels du calque ouvert dans la fenêtre. */
let source: { nodeId: string; canvas: HTMLCanvasElement } | null = null;

export const canMeshWarp = (): boolean => selectedImage() !== null;
export const meshSource = (): HTMLCanvasElement | null => source?.canvas ?? null;

export function openMeshWarp(): void {
  const node = selectedImage();
  const canvas = node && pixelsOf(node);
  if (!node || !canvas) return;
  source = { nodeId: node.id, canvas };
  ui.set({ dialog: 'meshWarp' });
}

export function closeMeshWarp(apply?: { n: number; mesh: Mesh }): void {
  const s = source;
  source = null;
  ui.set({ dialog: null });
  if (!s || !apply) return;
  const out = makeCanvas(s.canvas.width, s.canvas.height);
  drawWarped(out.getContext('2d')!, s.canvas, apply.n, apply.mesh, out.width, out.height);
  commitBitmap(s.nodeId, 'pixels', out, 'history.meshWarp');
}
