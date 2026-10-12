import { artboardAt, edgeCosts, liveWire, simplifyPolyline, type Vec } from '@poulpe/core';
import { drawArtboard } from '@poulpe/render';
import { images, makeCanvas } from '../../photo/pixels';
import { editor } from '../../store';

/*
 * Lasso magnétique (mode du lasso, comme dans Affinity Photo) : on clique pour commencer, puis le
 * tracé suit les bords les plus marqués entre le dernier point d'ancrage et le pointeur. Des
 * ancrages se posent tout seuls quand on s'éloigne ; un clic en pose un. Les bords sont cherchés
 * sur l'image visible du plan de travail, réduite si elle est très grande.
 */

const MAX_SIDE = 2048;

export class MagneticLasso {
  /** Segments déjà fixés, d'un ancrage au suivant (points du document). */
  readonly segments: Vec[][] = [];
  readonly anchors: Vec[];
  /** Segment qui suit le pointeur, du dernier ancrage au point accroché. */
  live: Vec[] = [];
  lastClick = performance.now();

  private constructor(
    first: Vec,
    private cost: Float32Array,
    private w: number,
    private h: number,
    private x: number,
    private y: number,
    private k: number,
  ) {
    this.anchors = [first];
  }

  /** Premier clic en `p` ; `radius` (document) : distance où l'on cherche un bord. */
  static start(p: Vec, radius: number): MagneticLasso | null {
    const ab = artboardAt(editor.doc, p);
    if (!ab) return null;
    const k = Math.min(2, MAX_SIDE / Math.max(ab.width, ab.height));
    const w = Math.max(1, Math.round(ab.width * k)),
      h = Math.max(1, Math.round(ab.height * k));
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.setTransform(k, 0, 0, k, -ab.x * k, -ab.y * k);
    drawArtboard(ctx, editor.doc, ab, { images: images() });
    const px = ctx.getImageData(0, 0, w, h);
    const s = new MagneticLasso(p, edgeCosts(px), w, h, ab.x, ab.y, k);
    s.anchors[0] = s.snap(p, radius);
    return s;
  }

  /** Document vers grille des bords (centre des pixels : l'inverse exact de `toDoc`). */
  private toGrid(p: Vec): Vec {
    return { x: (p.x - this.x) * this.k - 0.5, y: (p.y - this.y) * this.k - 0.5 };
  }

  private toDoc(q: Vec): Vec {
    return { x: this.x + (q.x + 0.5) / this.k, y: this.y + (q.y + 0.5) / this.k };
  }

  /** Point le plus « bord » à moins de `radius` (document) de `p`. */
  snap(p: Vec, radius: number): Vec {
    const g = this.toGrid(p);
    const r = Math.max(1, Math.round(radius * this.k));
    const cx = Math.round(g.x),
      cy = Math.round(g.y);
    let best = -1,
      bx = cx,
      by = cy;
    for (let y = Math.max(0, cy - r); y <= Math.min(this.h - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(this.w - 1, cx + r); x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 > r * r) continue;
        // Plus le bord est marqué et proche, mieux c'est.
        const score = (1 - this.cost[y * this.w + x]) * (1 - (0.3 * d2) / (r * r));
        if (score > best) {
          best = score;
          bx = x;
          by = y;
        }
      }
    // Pas de bord net autour : on garde le pointeur.
    if (best < 0.5) return p;
    return this.toDoc({ x: bx, y: by });
  }

  private wire(a: Vec, b: Vec, margin: number): Vec[] {
    const path = liveWire(
      this.cost,
      this.w,
      this.h,
      this.toGrid(a),
      this.toGrid(b),
      Math.max(4, Math.round(margin * this.k)),
    );
    return path.map((q) => this.toDoc(q));
  }

  get last(): Vec {
    return this.anchors[this.anchors.length - 1];
  }

  /**
   * Le pointeur bouge : le segment vivant suit les bords jusqu'à lui. Quand il s'est assez
   * éloigné du dernier ancrage (`spacing`, document), un ancrage est posé tout seul.
   */
  move(p: Vec, radius: number, spacing: number): void {
    const target = this.snap(p, radius);
    this.live = this.wire(this.last, target, radius);
    if (Math.hypot(target.x - this.last.x, target.y - this.last.y) > spacing) this.fix();
  }

  /** Fixe le segment vivant et pose un ancrage à son bout. */
  fix(): void {
    if (this.live.length < 2) return;
    this.segments.push(this.live);
    this.anchors.push(this.live[this.live.length - 1]);
    this.live = [];
  }

  /** Retire le dernier ancrage (Retour arrière) ; faux s'il n'en reste plus. */
  undo(): boolean {
    if (this.anchors.length <= 1) return false;
    this.anchors.pop();
    this.segments.pop();
    this.live = [];
    return true;
  }

  /** Contour fermé (retour au premier ancrage le long des bords), simplifié. */
  close(radius: number): Vec[] {
    this.fix();
    const back = this.wire(this.last, this.anchors[0], radius);
    const pts = [...this.segments.flat(), ...back];
    return simplifyPolyline(pts, 0.5 / this.k);
  }

  /** Tous les points à dessiner (segments fixés puis segment vivant). */
  points(): Vec[] {
    return [this.anchors[0], ...this.segments.flat(), ...this.live];
  }
}
