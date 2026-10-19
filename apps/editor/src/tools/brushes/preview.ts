import type { BrushSettings } from '../../store';
import { makeStamp, makeTipStamp } from '../../photo/brushSources';
import { tipCanvas } from './tips';

/**
 * Aperçu d'un trait en S avec les réglages du pinceau (forme, espacement, angle, rondeur,
 * variations), touche après touche comme le vrai pinceau, à une taille ramenée au cadre.
 */
export function drawStrokePreview(c: HTMLCanvasElement, b: BrushSettings, color: string, maxR = 26): void {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  const r = Math.min(maxR, Math.max(1, b.size / 2));
  const tip = tipCanvas(b.tip);
  const stamp = tip ? makeTipStamp(tip, color) : makeStamp(Math.max(r, 8), b.hardness, color);
  const step = Math.max(0.75, r * 2 * Math.max(0.01, (b.spacing ?? 10) / 100));
  const pts: { x: number; y: number }[] = [];
  const N = 400;
  let prev: { x: number; y: number } | null = null;
  let carry = 0;
  for (let i = 0; i <= N; i++) {
    const p = {
      x: 20 + (i / N) * (c.width - 40),
      y: c.height / 2 + Math.sin((i / N) * Math.PI * 2) * Math.min(14, c.height / 4),
    };
    if (prev) {
      carry += Math.hypot(p.x - prev.x, p.y - prev.y);
      if (carry >= step) {
        pts.push(p);
        carry = 0;
      }
    } else pts.push(p);
    prev = p;
  }
  // Variations reproductibles : l'aperçu ne tremble pas à chaque réglage.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  ctx.globalAlpha = Math.max(0.02, (b.flow / 100) * (b.opacity / 100) * (tip ? 0.8 : 0.35));
  for (const p of pts) {
    let rr = r;
    if (b.sizeJitter) rr *= Math.max(0.05, 1 - (rand() * b.sizeJitter) / 100);
    let { x, y } = p;
    if (b.scatter) {
      const a = rand() * Math.PI * 2;
      const d = rand() * (b.scatter / 100) * r * 2;
      x += Math.cos(a) * d;
      y += Math.sin(a) * d;
    }
    const size = stamp.width * (rr / ((stamp.width - 2) / 2));
    const angle = (b.angle ?? 0) + (b.angleJitter ? (rand() * 2 - 1) * b.angleJitter : 0);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.scale(1, Math.max(0.01, (b.roundness ?? 100) / 100));
    ctx.drawImage(stamp, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
