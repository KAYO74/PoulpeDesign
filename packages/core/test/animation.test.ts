import { describe, expect, it } from 'vitest';
import {
  animateArtboard,
  animationLength,
  createDocument,
  createRect,
  encodeGif,
  hasAnimation,
  validAnimation,
} from '../src';

function board() {
  const doc = createDocument();
  const ab = doc.artboards[0];
  const a = createRect({ x: 100, y: 100, width: 200, height: 100 });
  const b = createRect({ x: 400, y: 400, width: 100, height: 100 });
  a.animation = { kind: 'rise', delay: 0, duration: 1 };
  b.animation = { kind: 'zoom', delay: 0.5, duration: 1 };
  ab.children.push(a, b);
  return { ab, a, b };
}

describe('animation simple', () => {
  it('calcule la durée et ne touche pas au document', () => {
    const { ab, a } = board();
    expect(hasAnimation(ab)).toBe(true);
    expect(animationLength(ab)).toBe(1.5);
    animateArtboard(ab, 0.2);
    expect(a.y).toBe(100);
    expect(a.opacity).toBe(1);
  });

  it('place chaque objet dans son état du moment', () => {
    const { ab } = board();
    const start = animateArtboard(ab, 0);
    expect(start.children[0].opacity).toBe(0);
    expect(start.children[1].opacity).toBe(0);
    const mid = animateArtboard(ab, 0.5);
    expect(mid.children[0].y).toBeGreaterThan(100);
    expect(mid.children[0].opacity).toBeGreaterThan(0.5);
    expect(mid.children[1].opacity).toBe(0);
    const zoom = animateArtboard(ab, 0.8);
    expect(zoom.children[1].width).toBeLessThan(100);
    const end = animateArtboard(ab, 2);
    expect(end.children[0]).toMatchObject({ x: 100, y: 100, opacity: 1 });
    expect(end.children[1]).toMatchObject({ width: 100, opacity: 1 });
  });

  it('ignore une animation abîmée', () => {
    expect(validAnimation({ kind: 'boom', delay: 0, duration: 1 })).toBeNull();
    expect(validAnimation({ kind: 'fade', delay: NaN, duration: 1 })).toBeNull();
    expect(validAnimation({ kind: 'fade', delay: -3, duration: 1e9 })).toEqual({
      kind: 'fade',
      delay: 0,
      duration: 60,
    });
  });

  it('écrit un GIF animé', () => {
    const w = 8,
      h = 4;
    const frame = (rgb: number[]) => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) d.set([...rgb, 255], i * 4);
      return { data: d, delay: 10 };
    };
    const gif = encodeGif([frame([255, 0, 0]), frame([0, 0, 255])], w, h);
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a');
    expect(gif[gif.length - 1]).toBe(0x3b);
  });
});
