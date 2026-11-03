import { describe, expect, it } from 'vitest';
import { createRect, designColors, recolorDesign, shiftColor, type SceneNode } from '../src';

function rect(fill: string, stroke = '#000000'): SceneNode {
  const r = createRect({ x: 0, y: 0, width: 10, height: 10 });
  (r as { fill: unknown }).fill = { type: 'solid', color: fill };
  (r as { stroke: unknown }).stroke = { ...r.stroke, paint: { type: 'solid', color: stroke }, width: 1 };
  return r;
}

describe("recoloriser l'illustration", () => {
  it('remplace une couleur partout, en gardant la transparence', () => {
    const a = rect('#ff0000'),
      b = rect('#ff000080', '#ff0000');
    recolorDesign({ nodes: [a, b] }, { '#ff0000': '#00ff00' });
    expect((a as any).fill.color).toBe('#00ff00');
    expect((b as any).fill.color).toBe('#00ff0080');
    expect((b as any).stroke.paint.color).toBe('#00ff00');
    // Le noir n'est pas dans la correspondance : il reste.
    expect((a as any).stroke.paint.color).toBe('#000000');
  });

  it('décale la teinte, la saturation et la luminosité', () => {
    expect(shiftColor('#ff0000', { hue: 120, saturation: 0, lightness: 0 })).toBe('#00ff00');
    expect(shiftColor('#ff0000', { hue: 0, saturation: -100, lightness: 0 })).toBe('#808080');
    expect(shiftColor('#808080', { hue: 0, saturation: 0, lightness: 100 })).toBe('#ffffff');
    expect(shiftColor('#808080', { hue: 0, saturation: 0, lightness: -100 })).toBe('#000000');
  });

  it('applique correspondance et décalage ensemble', () => {
    const a = rect('#ff0000', '#0000ff');
    recolorDesign({ nodes: [a] }, { '#ff0000': '#0000ff' }, { hue: 120, saturation: 0, lightness: 0 });
    expect((a as any).fill.color).toBe('#ff0000');
    expect((a as any).stroke.paint.color).toBe('#ff0000');
    expect(designColors({ nodes: [a] })).toEqual(['#ff0000']);
  });
});
