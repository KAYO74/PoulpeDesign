import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeHeic, HeicError, isHeic } from '../src/heic';

const file = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)));
const wasm = file('../wasm/poulpe_heic.wasm');
const sample = new Uint8Array(file('./fixtures/gradient48x32.heic'));

describe('photos HEIC', () => {
  it('reconnaît un fichier HEIC à son contenu', () => {
    expect(isHeic(sample)).toBe(true);
    expect(isHeic(new Uint8Array(64))).toBe(false);
    expect(isHeic(new Uint8Array([1, 2, 3]))).toBe(false);
    // Un AVIF est lu par le navigateur, pas par ce décodeur.
    const avif = new Uint8Array(32);
    avif.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
    expect(isHeic(avif)).toBe(false);
  });

  it('décode une photo en pixels RGBA', async () => {
    const img = await decodeHeic(wasm, sample);
    expect([img.width, img.height]).toEqual([48, 32]);
    expect(img.data.length).toBe(48 * 32 * 4);
    // Dégradé : rouge croissant vers la droite, vert croissant vers le bas.
    const px = (x: number, y: number) => img.data.slice((y * 48 + x) * 4, (y * 48 + x) * 4 + 4);
    expect(px(44, 2)[0]).toBeGreaterThan(px(2, 2)[0] + 100);
    expect(px(2, 28)[1]).toBeGreaterThan(px(2, 2)[1] + 100);
    expect(px(10, 10)[3]).toBe(255);
  });

  it('refuse proprement un fichier abîmé ou tronqué', async () => {
    await expect(decodeHeic(wasm, sample.slice(0, 80))).rejects.toBeInstanceOf(HeicError);
    await expect(decodeHeic(wasm, new Uint8Array(100))).rejects.toMatchObject({ reason: 'unreadable' });
    await expect(decodeHeic(wasm, new Uint8Array(0))).rejects.toBeInstanceOf(HeicError);
  });
});
