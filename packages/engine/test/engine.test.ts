import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAdjustment,
  defaultAdjustment,
  encodeLut,
  gaussianBlurred,
  healBlend,
  healBlendTs,
  inpaint,
  softProofPixels,
  softProofPixelsTs,
  lutFromFunction,
  setAdjustmentEngine,
  type Adjustment,
  type AdjustOptions,
} from '@poulpe/core';
import {
  engineApplyAny,
  engineHandles,
  engineNccScan,
  engineStats,
  startEngine,
  stopEngine,
} from '../src/index';
import { alignPair, nccScanTs, type Gray } from '@poulpe/core/src/panorama';
import { engineInpaint, startInpaintEngine } from '../src/inpaint';
import { engineLabel, startTraceEngine } from '../src/trace';
import { engineFuse, startFusionEngine } from '../src/fusion';
import { fuseImages } from '@poulpe/core/src/fusion';
import { quantize, setTraceLabeler } from '@poulpe/core/src/trace';

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
  { kind: 'denoise', luminance: 55, color: 70 },
  { kind: 'denoise', luminance: 0, color: 40 },
  { kind: 'denoise', luminance: 90, color: 0 },
  defaultAdjustment('develop'),
  {
    ...(defaultAdjustment('develop') as Extract<Adjustment, { kind: 'develop' }>),
    temperature: 35,
    tint: -20,
    exposure: 0.7,
    contrast: 40,
    highlights: -50,
    shadows: 60,
    whites: 20,
    blacks: -30,
    vibrance: 30,
    saturation: -15,
  },
  {
    ...(defaultAdjustment('develop') as Extract<Adjustment, { kind: 'develop' }>),
    hue: [10, -20, 30, 40, -50, 60, -70, 80],
    sat: [-30, 40, 50, -60, 70, 20, -90, 15],
    lum: [20, -25, 35, 10, -40, 50, 5, -15],
  },
  {
    ...(defaultAdjustment('develop') as Extract<Adjustment, { kind: 'develop' }>),
    temperature: -40,
    exposure: -1.2,
    shadows: -40,
    sat: [0, 0, 0, 0, 60, 60, 0, 0],
  },
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

  it('recalage du panorama : mêmes notes et même décalage que le TypeScript', async () => {
    const gray = (w: number, h: number, seed: number): Gray => {
      const d = new Float32Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          d[y * w + x] =
            0.5 + 0.3 * Math.sin(x / 7 + Math.sin(y / 11 + seed) * 2) + 0.1 * Math.cos(x * y * 0.01 + seed);
      d.fill(0.4, 0, 30); // zone unie : note -1
      return { w, h, d };
    };
    const a = gray(70, 45, 0),
      b = gray(53, 38, 1);
    await startEngine(wasm);
    const rs = engineNccScan(a.d, a.w, a.h, b.d, b.w, b.h, -b.w + 1, -b.h + 1, a.w + b.w - 1, a.h + b.h - 1)!;
    const ts = nccScanTs(a, b, -b.w + 1, -b.h + 1, a.w + b.w - 1, a.h + b.h - 1);
    expect(rs.length).toBe(ts.length);
    let diff = 0;
    for (let i = 0; i < ts.length; i++) if (!Object.is(ts[i], rs[i])) diff++;
    expect(diff).toBe(0);
    // Et le décalage trouvé est le même avec ou sans moteur.
    const px = (g: Gray) => {
      const data = new Uint8ClampedArray(g.w * g.h * 4);
      for (let i = 0; i < g.d.length; i++) data.set([g.d[i] * 255, g.d[i] * 255, g.d[i] * 255, 255], i * 4);
      return { data, width: g.w, height: g.h };
    };
    const withRust = alignPair(px(a), px(b));
    stopEngine();
    const without = alignPair(px(a), px(b));
    expect(withRust).toEqual(without);
  });

  it('correcteur identique au TypeScript', async () => {
    await startEngine(wasm);
    const dest = image(80, 50);
    const src = { ...image(80, 50), data: image(80, 50).data.map((v, i) => (v * 7 + i) % 256) };
    const ts = healBlendTs(dest, src, 4);
    const before = engineStats().calls;
    const rs = healBlend(dest, src, 4);
    expect(engineStats().calls).toBe(before + 1);
    expect(Buffer.from(rs).equals(Buffer.from(ts))).toBe(true);
  });

  it('gomme magique identique au TypeScript (1 niveau de couleur au plus)', async () => {
    expect(await startInpaintEngine(wasm)).toBe(true);
    for (const [w, h, x0, y0, s] of [
      [90, 70, 30, 25, 18],
      [160, 120, 60, 40, 40],
    ]) {
      const src = image(w, h);
      const hole = new Uint8Array(w * h);
      for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) hole[y * w + x] = 1;
      const ts = new Uint8ClampedArray(src.data);
      inpaint({ data: ts, width: w, height: h }, hole, { seed: 42 });
      const rs = new Uint8ClampedArray(src.data);
      expect(engineInpaint(rs, w, h, hole, { seed: 42 })).toBe(true);
      let maxDiff = 0;
      for (let i = 0; i < rs.length; i++) maxDiff = Math.max(maxDiff, Math.abs(rs[i] - ts[i]));
      expect(maxDiff).toBeLessThanOrEqual(1);
    }
  });

  it('épreuve CMJN identique au TypeScript', async () => {
    await startEngine(wasm);
    const src = image(120, 90).data;
    const ts = new Uint8ClampedArray(src);
    softProofPixelsTs(ts);
    const rs = new Uint8ClampedArray(src);
    const before = engineStats().calls;
    softProofPixels(rs);
    expect(engineStats().calls).toBe(before + 1);
    expect(Buffer.from(rs).equals(Buffer.from(ts))).toBe(true);
  });

  it('vectorisation : couleurs identiques au TypeScript', async () => {
    expect(await startTraceEngine(wasm)).toBe(true);
    const img = image(140, 100);
    for (const opts of [
      { mode: 'color', colors: 12, ignoreWhite: false },
      { mode: 'color', colors: 5, ignoreWhite: true },
      { mode: 'gray', colors: 4, ignoreWhite: false },
    ] as const) {
      setTraceLabeler(null);
      const ts = quantize(img, opts as never);
      setTraceLabeler(engineLabel);
      const rs = quantize(img, opts as never);
      setTraceLabeler(null);
      expect(Buffer.from(rs.labels.buffer).equals(Buffer.from(ts.labels.buffer))).toBe(true);
      expect(rs.palette).toEqual(ts.palette);
    }
  });

  it('fusion : mêmes pixels que le TypeScript (à un niveau près)', async () => {
    expect(await startFusionEngine(wasm)).toBe(true);
    const base = image(97, 61);
    // Trois « prises » : plus sombre, normale, plus claire.
    const shots = [0.45, 1, 1.6].map((g) => ({
      width: base.width,
      height: base.height,
      data: base.data.map((v, i) => (i % 4 === 3 ? v : v * g)),
    }));
    for (const opts of [
      { mode: 'exposure' as const },
      { mode: 'exposure' as const, contrast: 0.5, saturation: 1.5, exposure: 2 },
      { mode: 'focus' as const },
    ]) {
      const ts = fuseImages(shots, opts)!;
      const rs = engineFuse(shots, opts)!;
      expect(rs).toBeTruthy();
      let worst = 0;
      for (let i = 0; i < ts.data.length; i++) worst = Math.max(worst, Math.abs(ts.data[i] - rs.data[i]));
      expect(worst).toBeLessThanOrEqual(2);
    }
  });

  it('fusion : plus rapide que le TypeScript', async () => {
    await startFusionEngine(wasm);
    const base = image(900, 700);
    const shots = [0.5, 1, 1.5].map((g) => ({
      width: base.width,
      height: base.height,
      data: base.data.map((v, i) => (i % 4 === 3 ? v : v * g)),
    }));
    const opts = { mode: 'exposure' as const };
    engineFuse(shots, opts);
    let t = performance.now();
    fuseImages(shots, opts);
    const ts = performance.now() - t;
    t = performance.now();
    engineFuse(shots, opts);
    const rs = performance.now() - t;
    console.log(`fusion 3 × 0,6 Mpx : Rust ${Math.round(rs)} ms, TypeScript ${Math.round(ts)} ms`);
    expect(rs).toBeLessThan(ts);
  }, 60_000);

  it('fusion : annulation, tailles différentes', async () => {
    await startFusionEngine(wasm);
    const a = image(40, 30);
    expect(engineFuse([a, a], { mode: 'focus', progress: () => true })).toBeNull();
    expect(engineFuse([a, image(41, 30)], { mode: 'focus' })).toBeUndefined();
    // Le moteur reste utilisable après une annulation.
    expect(engineFuse([a, a], { mode: 'focus' })).toBeTruthy();
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
