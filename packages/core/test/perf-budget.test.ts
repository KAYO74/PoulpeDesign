import { describe, expect, it } from 'vitest';
import { booleanCommands, refineMatte, type PathCommand } from '../src';

/* Budgets de temps larges : ils ne servent qu'à repérer une régression grave (x5 ou plus). */

/** Polygone fermé à `n` points, en étoile irrégulière autour de (cx, 0). */
function star(n: number, cx: number, radius: number): PathCommand[] {
  const cmds: PathCommand[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radius * (1 + 0.15 * Math.sin(a * 17));
    const p = { x: cx + Math.cos(a) * r, y: Math.sin(a) * r };
    cmds.push(i === 0 ? { op: 'M', x: p.x, y: p.y } : { op: 'L', x: p.x, y: p.y });
  }
  cmds.push({ op: 'Z' });
  return cmds;
}

describe('budgets de temps', () => {
  it('réunion de deux contours de 8000 points en moins de 3 s', () => {
    const shapes = [{ cmds: star(8000, 0, 500) }, { cmds: star(8000, 300, 500) }];
    const t = performance.now();
    const out = booleanCommands(shapes, 'unite');
    const ms = performance.now() - t;
    console.log(`booléen 2×8000 points : ${Math.round(ms)} ms`);
    expect(out.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(3000);
  });

  it('affinage du détourage sur 1024×768 en moins de 300 ms', () => {
    const w = 1024,
      h = 768;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([(i * 7) % 256, (i * 3) % 256, (i >> 3) % 256, 255], i * 4);
    const size = 320;
    const raw = new Float32Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) raw[y * size + x] = Math.hypot(x - 160, y - 160) < 100 ? 1 : 0;
    refineMatte({ data, width: w, height: h }, raw, size);
    const t = performance.now();
    const out = refineMatte({ data, width: w, height: h }, raw, size);
    const ms = performance.now() - t;
    console.log(`détourage 1024×768 : ${Math.round(ms)} ms`);
    expect(out.length).toBe(w * h);
    expect(ms).toBeLessThan(300);
  });
});
