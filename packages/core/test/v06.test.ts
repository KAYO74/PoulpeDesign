import { describe, expect, it } from 'vitest';
import {
  Editor,
  FORMAT_VERSION,
  LUT_PRESETS,
  applyAdjustment,
  applyHomography,
  applyLut,
  createDocument,
  decodeLut,
  defaultAdjustment,
  encodeLut,
  healBlend,
  homography,
  liquifyDab,
  lutFromFunction,
  migrate,
  parseCube,
  resamplePixels,
  warpPerspective,
  writeCube,
  type Pixels,
} from '../src';

function solid(w: number, h: number, rgba: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { data, width: w, height: h };
}

function px(p: Pixels, x: number, y: number): number[] {
  const i = (y * p.width + x) * 4;
  return [...p.data.slice(i, i + 4)];
}

describe('tables LUT', () => {
  const identity = lutFromFunction(5, (r, g, b) => [r, g, b]);

  it('une table neutre ne change pas les couleurs', () => {
    const p = solid(1, 1, [12, 130, 250, 255]);
    applyLut(p, identity);
    expect(px(p, 0, 0)).toEqual([12, 130, 250, 255]);
  });

  it('lit et écrit le format .cube', () => {
    const text = writeCube(
      lutFromFunction(3, (r, g, b) => [1 - r, 1 - g, 1 - b]),
      'Négatif',
    );
    const lut = parseCube(text);
    expect(lut.size).toBe(3);
    expect(lut.title).toBe('Négatif');
    const p = solid(1, 1, [0, 255, 51, 128]);
    applyLut(p, lut);
    expect(px(p, 0, 0)).toEqual([255, 0, 204, 128]);
  });

  it('refuse un fichier incomplet', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1\n')).toThrow();
    expect(() => parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n')).toThrow();
  });

  it('garde la table dans le document (16 bits, base64) sans perte visible', () => {
    const lut = lutFromFunction(9, LUT_PRESETS.warmFilm);
    const back = decodeLut(9, encodeLut(lut));
    for (let i = 0; i < lut.data.length; i++) expect(Math.abs(back.data[i] - lut.data[i])).toBeLessThan(1e-4);
  });

  it('sert de calque de réglage', () => {
    const adj = defaultAdjustment('lut');
    expect(adj.kind).toBe('lut');
    const p = solid(2, 2, [40, 90, 200, 255]);
    applyAdjustment(p, adj);
    expect(px(p, 1, 1)).toEqual([40, 90, 200, 255]);
    const noir = {
      kind: 'lut' as const,
      name: 'noir',
      size: 9,
      data: encodeLut(lutFromFunction(9, LUT_PRESETS.noir)),
    };
    applyAdjustment(p, noir);
    const [r, g, b] = px(p, 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});

describe('perspective', () => {
  it('homographie : les coins vont sur les coins', () => {
    const from = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const to = [
      { x: 2, y: 1 },
      { x: 9, y: 0 },
      { x: 12, y: 11 },
      { x: -1, y: 8 },
    ];
    const H = homography(from, to);
    from.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(q.x).toBeCloseTo(to[i].x, 6);
      expect(q.y).toBeCloseTo(to[i].y, 6);
    });
  });

  it('un quadrilatère devient le rectangle entier', () => {
    // Image 20 × 20 : un carré rouge de 10 × 10 au centre, sur fond blanc.
    const src = solid(20, 20, [255, 255, 255, 255]);
    for (let y = 5; y < 15; y++)
      for (let x = 5; x < 15; x++) src.data.set([255, 0, 0, 255], (y * 20 + x) * 4);
    const out = warpPerspective(
      src,
      [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
        { x: 5, y: 15 },
      ],
      20,
      20,
    );
    expect(out.width).toBe(20);
    // Le carré rouge remplit maintenant toute l'image.
    expect(px(out, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(out, 18, 18)).toEqual([255, 0, 0, 255]);
  });
});

describe('fluidité et correcteur', () => {
  it('pousser déplace les pixels dans le sens du geste', () => {
    // Bande noire verticale en x = 10..11, poussée vers la droite.
    const p = solid(30, 30, [255, 255, 255, 255]);
    for (let y = 0; y < 30; y++) for (let x = 10; x < 12; x++) p.data.set([0, 0, 0, 255], (y * 30 + x) * 4);
    for (let k = 0; k < 4; k++) liquifyDab(p, 11 + k, 15, 8, 'push', 1, 1, 0);
    expect(px(p, 14, 15)[0]).toBeLessThan(128);
    expect(px(p, 10, 15)[0]).toBeGreaterThan(200);
    // Loin du pinceau, rien ne bouge.
    expect(px(p, 13, 2)).toEqual([255, 255, 255, 255]);
    expect(px(p, 10, 2)).toEqual([0, 0, 0, 255]);
  });

  it('le masque de gel protège les pixels gelés', () => {
    const p = solid(30, 30, [255, 255, 255, 255]);
    for (let y = 0; y < 30; y++) for (let x = 10; x < 12; x++) p.data.set([0, 0, 0, 255], (y * 30 + x) * 4);
    // Moitié haute gelée : la bande n'y bouge pas, elle bouge en bas.
    const freeze = new Uint8Array(30 * 30);
    freeze.fill(255, 0, 15 * 30);
    for (let k = 0; k < 4; k++) {
      liquifyDab(p, 11 + k, 12, 8, 'push', 1, 1, 0, freeze);
      liquifyDab(p, 11 + k, 19, 8, 'push', 1, 1, 0, freeze);
    }
    expect(px(p, 10, 12)).toEqual([0, 0, 0, 255]);
    expect(px(p, 14, 12)).toEqual([255, 255, 255, 255]);
    expect(px(p, 14, 19)[0]).toBeLessThan(128);
  });

  it('gonfler et pincer gardent le centre et les zones éloignées', () => {
    const p = solid(20, 20, [10, 20, 30, 255]);
    liquifyDab(p, 10, 10, 6, 'bloat', 1);
    liquifyDab(p, 10, 10, 6, 'pinch', 1);
    liquifyDab(p, 10, 10, 6, 'twirl', -1);
    expect(px(p, 10, 10)).toEqual([10, 20, 30, 255]);
    expect(px(p, 0, 0)).toEqual([10, 20, 30, 255]);
  });

  it('le correcteur garde la texture de la source et la lumière de la destination', () => {
    const dest = solid(16, 16, [200, 200, 200, 255]);
    const src = solid(16, 16, [50, 50, 50, 255]);
    // Un détail dans la source.
    src.data.set([90, 50, 50, 255], (8 * 16 + 8) * 4);
    const out = { data: healBlend(dest, src, 3), width: 16, height: 16 };
    const flat = px(out, 2, 2);
    expect(Math.abs(flat[0] - 200)).toBeLessThan(3);
    const detail = px(out, 8, 8);
    expect(detail[0] - detail[1]).toBeGreaterThan(30);
  });
});

describe('rééchantillonnage', () => {
  it('réduit en faisant la moyenne', () => {
    const p = solid(4, 4, [0, 0, 0, 255]);
    for (let i = 0; i < 16; i += 2) p.data.set([255, 255, 255, 255], i * 4);
    const out = resamplePixels(p, 2, 2);
    expect(out.width).toBe(2);
    expect(Math.abs(px(out, 0, 0)[0] - 128)).toBeLessThan(2);
  });

  it('agrandit sans changer une couleur unie', () => {
    const out = resamplePixels(solid(3, 3, [10, 200, 30, 255]), 7, 5);
    expect(px(out, 6, 4)).toEqual([10, 200, 30, 255]);
  });
});

describe('historique de la sélection', () => {
  it('mark : une étape sans changement du document, annulable', () => {
    const editor = new Editor(createDocument());
    let sel: unknown = null;
    editor.setExtraState({ get: () => sel, set: (v) => (sel = v ?? null) });
    const before = sel;
    sel = 'rectangle';
    editor.mark('history.selection', before);
    expect(editor.getState().canUndo).toBe(true);
    expect(editor.getState().dirty).toBe(false);
    editor.apply('history.add', (d) => void (d.name = 'changé'));
    editor.undo();
    expect(sel).toBe('rectangle');
    editor.undo();
    expect(sel).toBe(null);
    editor.redo();
    expect(sel).toBe('rectangle');
  });
});

describe('format 7', () => {
  it('lit les documents de la version 6', () => {
    const doc = createDocument();
    const v6 = { ...JSON.parse(JSON.stringify(doc)), version: 6 };
    expect(FORMAT_VERSION).toBeGreaterThanOrEqual(7);
    expect(migrate(v6).version).toBe(FORMAT_VERSION);
  });
});
