import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAdjustment,
  defaultAdjustment,
  encodeLut,
  gaussianBlurred,
  lutFromFunction,
  setAdjustmentEngine,
  type Adjustment,
  type AdjustOptions,
} from '@poulpe/core';
import { engineApplyAny, engineHandles, engineStats, startEngine, stopEngine } from '../src/index';

/*
 * Le moteur Rust doit donner exactement les mêmes pixels que le code TypeScript d'origine, pour
 * chaque réglage. On compare les deux sur une image de test variée (dégradés, bruit, transparence).
 */

const wasm = readFileSync(fileURLToPath(new URL('../wasm/poulpe_engine.wasm', import.meta.url)));

function image(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 255) / (w - 1);
      data[i + 1] = (y * 255) / (h - 1);
      data[i + 2] = rnd() * 255;
      data[i + 3] = x < 8 ? 0 : y < 6 ? rnd() * 255 : 255;
    }
  return { data, width: w, height: h };
}

function both(adj: Adjustment, opts: AdjustOptions = {}) {
  const src = image(97, 61);
  const ts = { ...src, data: new Uint8ClampedArray(src.data) };
  stopEngine();
  applyAdjustment(ts, adj, opts);
  const rs = { ...src, data: new Uint8ClampedArray(src.data) };
  // Tous les réglages sont comparés, même ceux que l'appli laisse au TypeScript.
  return { ts: ts.data, rs: rs.data, run: () => expect(engineApplyAny(rs, adj, opts)).toBe(true) };
}

const OPTS: AdjustOptions = {
  scale: 1.7,
  origin: { x: -13.4, y: 22.2 },
  frame: { x: 5, y: -8, width: 80, height: 50 },
};

const CASES: Adjustment[] = [
  { kind: 'brightnessContrast', brightness: 23, contrast: 41 },
  { kind: 'brightnessContrast', brightness: -40, contrast: -30 },
  { kind: 'levels', black: 20, white: 230, gamma: 1.4, outBlack: 10, outWhite: 240 },
  {
    kind: 'curves',
    rgb: [
      [0, 0.1],
      [0.4, 0.6],
      [1, 0.9],
    ],
    r: [
      [0, 0],
      [0.5, 0.4],
      [1, 1],
    ],
    g: [
      [0, 0],
      [1, 1],
    ],
    b: [
      [0, 0.2],
      [1, 1],
    ],
  },
  { kind: 'exposure', exposure: 1.3, offset: 0.02, gamma: 0.8 },
  { kind: 'whiteBalance', temperature: 35, tint: -20 },
  { kind: 'invert' },
  { kind: 'posterize', levels: 5 },
  { kind: 'hsl', hue: 47, saturation: 30, lightness: -12 },
  { kind: 'hsl', hue: -120, saturation: -60, lightness: 25 },
  { kind: 'vibrance', vibrance: 45, saturation: 10 },
  { kind: 'colorBalance', shadows: [20, -10, 5], midtones: [-15, 30, 0], highlights: [5, 5, -40] },
  { kind: 'blackWhite', red: 40, green: 40, blue: 20 },
  { kind: 'photoFilter', color: '#ec8a00', density: 60 },
  defaultAdjustment('gradientMap'),
  { kind: 'threshold', level: 120 },
  {
    kind: 'lut',
    name: 'test',
    size: 9,
    data: encodeLut(lutFromFunction(9, (r, g, b) => [Math.sqrt(r), g * g, (r + b) / 2])),
  },
  { kind: 'gaussianBlur', radius: 9 },
  { kind: 'unsharpMask', amount: 120, radius: 2.5, threshold: 3 },
  { kind: 'clarity', amount: 60 },
  { kind: 'noise', amount: 15, monochrome: true },
  { kind: 'noise', amount: 22, monochrome: false },
  { kind: 'vignette', amount: 70, size: 40, softness: 60 },
  { kind: 'vignette', amount: -50, size: 30, softness: 20 },
  { kind: 'pixelate', size: 7 },
];

describe('moteur Rust (WebAssembly)', () => {
  beforeAll(async () => {
    expect(await startEngine(wasm)).toBe(true);
  });
  afterAll(() => setAdjustmentEngine(null));

  for (const adj of CASES)
    for (const opts of [{}, OPTS])
      it(`${adj.kind} ${opts === OPTS ? 'avec repères' : ''} donne les mêmes pixels`, async () => {
        const { ts, rs, run } = both(adj, opts);
        await startEngine(wasm);
        const before = engineStats().calls;
        run();
        expect(engineStats().calls).toBe(before + 1);
        let diff = 0;
        for (let i = 0; i < ts.length; i++) if (ts[i] !== rs[i]) diff++;
        expect(diff).toBe(0);
      });

  it('flou de sélection identique', async () => {
    const src = image(64, 40);
    stopEngine();
    const ts = gaussianBlurred(src, 3.3);
    await startEngine(wasm);
    const rs = gaussianBlurred(src, 3.3);
    expect(Buffer.from(rs).equals(Buffer.from(ts))).toBe(true);
  });

  it('un réglage incompris est fait en TypeScript', async () => {
    await startEngine(wasm);
    const src = image(10, 10);
    const before = engineStats().fallbacks;
    applyAdjustment(src, { kind: 'hsl' } as unknown as Adjustment);
    expect(engineStats().fallbacks).toBe(before + 1);
  });

  it('seuls les réglages où le moteur est plus rapide lui sont confiés', async () => {
    await startEngine(wasm);
    expect(engineHandles('gaussianBlur')).toBe(true);
    expect(engineHandles('levels')).toBe(false);
    const before = engineStats().calls;
    applyAdjustment(image(10, 10), { kind: 'invert' });
    expect(engineStats().calls).toBe(before);
    applyAdjustment(image(10, 10), { kind: 'gaussianBlur', radius: 3 });
    expect(engineStats().calls).toBe(before + 1);
  });
});
