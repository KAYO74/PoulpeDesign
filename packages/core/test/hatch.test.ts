import { describe, expect, it } from 'vitest';
import { artboardToSvg, createDocument, createRect, defaultHatch, hatchTile } from '../src';

describe('hachures', () => {
  it('dessine traits, quadrillage et points', () => {
    const p = defaultHatch('#112233');
    expect(hatchTile(p).shapes).toHaveLength(1);
    expect(hatchTile({ ...p, style: 'cross' }).shapes).toHaveLength(2);
    expect(hatchTile({ ...p, style: 'dots' }).shapes[0].kind).toBe('dot');
  });

  it('s’exporte en motif SVG tourné', () => {
    const doc = createDocument();
    const rect = createRect({ x: 0, y: 0, width: 50, height: 50 });
    rect.fill = { ...defaultHatch('#112233'), background: '#ffffff' };
    doc.artboards[0].children.push(rect);
    const svg = artboardToSvg(doc, doc.artboards[0]);
    expect(svg).toMatch(/<pattern id="hat[^"]*"[^>]*patternTransform="rotate\(45\)"/);
    expect(svg).toContain('fill="#112233"');
    expect(svg).toContain('fill="url(#hat');
  });
});
