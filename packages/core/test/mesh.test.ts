import { describe, expect, it } from 'vitest';
import {
  artboardToSvg,
  cornerMesh,
  createDocument,
  createRect,
  designColors,
  encodePngRgba,
  insertMeshColumn,
  insertMeshRow,
  meshDataUrl,
  meshLocate,
  newMesh,
  rasterizeMesh,
  removeMeshLines,
  splitMeshAt,
} from '../src';

const at = (d: Uint8ClampedArray, w: number, x: number, y: number) => [
  ...d.slice((y * w + x) * 4, (y * w + x) * 4 + 4),
];

describe('filet de dégradé', () => {
  it('un filet uni peint toute la boîte de sa couleur', () => {
    const d = rasterizeMesh(newMesh('#2ba59a'), 20, 10);
    expect(at(d, 20, 0, 0)).toEqual([0x2b, 0xa5, 0x9a, 255]);
    expect(at(d, 20, 19, 9)).toEqual([0x2b, 0xa5, 0x9a, 255]);
  });

  it('les couleurs des coins se fondent au milieu', () => {
    const m = cornerMesh(['#000000', '#ffffff', '#000000', '#ffffff']);
    const d = rasterizeMesh(m, 41, 41);
    // Coins haut gauche et bas droit noirs, haut droit et bas gauche blancs.
    expect(at(d, 41, 0, 0)[0]).toBeLessThan(10);
    expect(at(d, 41, 40, 0)[0]).toBeGreaterThan(245);
    expect(at(d, 41, 0, 40)[0]).toBeGreaterThan(245);
    expect(Math.abs(at(d, 41, 20, 20)[0] - 128)).toBeLessThan(6);
  });

  it('ajoute et retire des lignes en gardant les couleurs', () => {
    const m = cornerMesh(['#000000', '#ffffff', '#ffffff', '#000000']);
    const c = insertMeshColumn(m, 0.5);
    expect(c.cols).toBe(2);
    expect(c.points).toHaveLength(6);
    expect(c.colors[1]).toBe('#808080');
    const r = insertMeshRow(c, 0.25);
    expect(r.rows).toBe(2);
    expect(r.points).toHaveLength(9);
    expect(r.points[4]).toEqual({ x: 0.5, y: 0.25 });
    const back = removeMeshLines(r, 1, 1);
    expect(back.cols).toBe(1);
    expect(back.rows).toBe(1);
    expect(back.points).toEqual(m.points);
  });

  it('un clic dans le filet pose un point à cet endroit', () => {
    const out = splitMeshAt(newMesh('#ff0000'), { x: 0.3, y: 0.7 })!;
    expect(out.mesh.cols).toBe(2);
    expect(out.mesh.rows).toBe(2);
    expect(out.mesh.points[out.index]).toEqual({ x: 0.3, y: 0.7 });
    expect(out.index).toBe(4);
    // Hors du filet : rien.
    expect(splitMeshAt(newMesh('#ff0000'), { x: 1.5, y: 0.5 })).toBeNull();
  });

  it('retrouve la position dans une case déformée', () => {
    const m = newMesh('#000000');
    m.points[3] = { x: 1.3, y: 1.2 };
    const p = meshLocate(m, { x: 0.6, y: 0.6 })!;
    expect(p.u).toBeGreaterThan(0);
    expect(p.u).toBeLessThan(1);
  });

  it('un point déplacé déforme les couleurs', () => {
    const m = cornerMesh(['#000000', '#000000', '#000000', '#000000']);
    const out = splitMeshAt(m, { x: 0.5, y: 0.5 })!;
    out.mesh.colors[out.index] = '#ffffff';
    out.mesh.points[out.index] = { x: 0.25, y: 0.25 };
    const d = rasterizeMesh(out.mesh, 40, 40);
    expect(at(d, 40, 10, 10)[0]).toBeGreaterThan(230);
    expect(at(d, 40, 30, 30)[0]).toBeLessThan(at(d, 40, 10, 10)[0]);
  });

  it('écrit une image PNG lisible', () => {
    const png = encodePngRgba(new Uint8ClampedArray(4 * 4 * 4).fill(255), 4, 4);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(meshDataUrl(newMesh('#00ff00'), 300, 100)).toMatch(/^data:image\/png;base64,/);
  });

  it('compte les couleurs du filet dans le design (recoloriser)', () => {
    const m = cornerMesh(['#ff0000', '#00ff00', '#0000ff', '#ffffff']);
    const node = { type: 'rect', fill: m, stroke: { paint: { type: 'none' }, width: 0 } } as never;
    expect(designColors({ nodes: [node] })).toHaveLength(4);
  });

  it("s'exporte en SVG comme une image", () => {
    const doc = createDocument();
    const r = createRect({ x: 10, y: 10, width: 200, height: 100 });
    (r as { fill: unknown }).fill = cornerMesh(['#ff0000', '#00ff00', '#0000ff', '#ffffff']);
    doc.artboards[0].children.push(r);
    const svg = artboardToSvg(doc, doc.artboards[0]);
    expect(svg).toContain('<pattern id="msh');
    expect(svg).toContain('href="data:image/png;base64,');
  });

  it('un filet abîmé ne fait pas planter le rendu', () => {
    const bad = (patch: (m: ReturnType<typeof newMesh>) => void) => {
      const m = newMesh('#ff0000');
      patch(m);
      return () => rasterizeMesh(m, 8, 8);
    };
    expect(bad((m) => ((m.points as unknown[])[1] = null))).not.toThrow();
    expect(bad((m) => ((m.points as unknown[])[2] = { x: 'a', y: 0 }))).not.toThrow();
    expect(bad((m) => ((m.colors as unknown[])[0] = 12))).not.toThrow();
    expect(bad((m) => ((m as { points: unknown }).points = 'x'))).not.toThrow();
    expect(
      rasterizeMesh({ ...newMesh('#ff0000'), colors: [null, 1, 2, 3] as never }, 4, 4).every((v) => v === 0),
    ).toBe(true);
  });
});
