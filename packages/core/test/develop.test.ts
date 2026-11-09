import { describe, expect, it } from 'vitest';
import { applyAdjustment, defaultAdjustment, isNeutral, type Adjustment, type Pixels } from '../src';

const px = (colors: [number, number, number][]): Pixels => {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((c, i) => data.set([...c, 255], i * 4));
  return { data, width: colors.length, height: 1 };
};
type Dev = Extract<Adjustment, { kind: 'develop' }>;
const dev = (patch: Partial<Dev>): Dev => ({ ...(defaultAdjustment('develop') as Dev), ...patch });
const run = (c: [number, number, number], patch: Partial<Dev>) => {
  const p = px([c]);
  applyAdjustment(p, dev(patch));
  return [...p.data.slice(0, 3)];
};

describe('develop', () => {
  it('neutre = identité', () => {
    const a = defaultAdjustment('develop');
    expect(isNeutral(a)).toBe(true);
    const p = px([
      [10, 200, 90],
      [255, 0, 0],
    ]);
    applyAdjustment(p, a);
    expect([...p.data]).toEqual([10, 200, 90, 255, 255, 0, 0, 255]);
  });

  it('température : chaud = plus de rouge, moins de bleu', () => {
    const [r, , b] = run([128, 128, 128], { temperature: 60 });
    expect(r).toBeGreaterThan(128);
    expect(b).toBeLessThan(128);
  });

  it('exposition +1 IL éclaircit, −1 IL assombrit', () => {
    expect(run([100, 100, 100], { exposure: 1 })[0]).toBeGreaterThan(100);
    expect(run([100, 100, 100], { exposure: -1 })[0]).toBeLessThan(100);
  });

  it('ombres relevées éclaircissent le sombre sans toucher le clair', () => {
    expect(run([40, 40, 40], { shadows: 80 })[0]).toBeGreaterThan(40);
    expect(run([240, 240, 240], { shadows: 80 })[0]).toBe(240);
  });

  it('hautes lumières baissées assombrissent le clair, pas le sombre', () => {
    expect(run([220, 220, 220], { highlights: -80 })[0]).toBeLessThan(220);
    expect(run([20, 20, 20], { highlights: -80 })[0]).toBe(20);
  });

  it('noirs relevés font remonter le noir pur', () => {
    expect(run([0, 0, 0], { blacks: 60 })[0]).toBeGreaterThan(10);
  });

  it('contraste écarte les tons', () => {
    expect(run([70, 70, 70], { contrast: 60 })[0]).toBeLessThan(70);
    expect(run([190, 190, 190], { contrast: 60 })[0]).toBeGreaterThan(190);
  });

  it('saturation −100 donne du gris, et laisse le gris tel quel', () => {
    const [r, g, b] = run([200, 60, 60], { saturation: -100 });
    expect(Math.abs(r - g)).toBeLessThan(2);
    expect(Math.abs(g - b)).toBeLessThan(2);
    expect(run([90, 90, 90], { saturation: 80 })).toEqual([90, 90, 90]);
  });

  it('une plage ne touche que ses couleurs', () => {
    const sat = [0, 0, 0, 0, 0, 0, 0, 0];
    sat[5] = -100; // bleu
    const blue = run([40, 40, 220], { sat });
    expect(Math.max(...blue) - Math.min(...blue)).toBeLessThan(10);
    expect(run([220, 60, 40], { sat })).toEqual([220, 60, 40]);
  });

  it('teinte de la plage verte : le vert se décale', () => {
    const hue = [0, 0, 0, 80, 0, 0, 0, 0];
    const [, , b] = run([40, 200, 40], { hue });
    expect(b).toBeGreaterThan(40); // le vert glisse vers l'aqua
    expect(run([220, 60, 40], { hue })).toEqual([220, 60, 40]);
  });

  it('garde la transparence', () => {
    const p = px([[100, 100, 100]]);
    p.data[3] = 77;
    applyAdjustment(p, dev({ exposure: 1, saturation: 20, shadows: 30 }));
    expect(p.data[3]).toBe(77);
  });
});
