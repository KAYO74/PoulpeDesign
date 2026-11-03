//! Épreuvage CMJN à l'écran : même calcul que `softProofPixels` (packages/core/src/cmyk.ts). La
//! table (sRVB → encres → sRVB, `grid`³ entrées de 3 valeurs) est construite par le TypeScript.

use crate::js::{clamp01, round};

/// Interpolation trilinéaire dans la table, comme `interp` (sommes rangées en 32 bits, coins
/// dans le même ordre).
#[inline(always)]
fn interp3(lut: &[f32], grid: usize, r: f64, g: f64, b: f64) -> [f32; 3] {
    let s = (grid - 1) as f64;
    let (fr, fg, fb) = (clamp01(r) * s, clamp01(g) * s, clamp01(b) * s);
    let r0 = (s - 1.0).min(fr.floor());
    let g0 = (s - 1.0).min(fg.floor());
    let b0 = (s - 1.0).min(fb.floor());
    let (dr, dg, db) = (fr - r0, fg - g0, fb - b0);
    let wr = [1.0 - dr, dr];
    let wg = [1.0 - dg, dg];
    let wb = [1.0 - db, db];
    let base = ((r0 as usize * grid + g0 as usize) * grid + b0 as usize) * 3;
    let (sg, sr) = (grid * 3, grid * grid * 3);
    // Les 8 coins de la case : la table est lue d'un seul bloc vérifié.
    let cell = &lut[base..base + sr + sg + 6];
    let mut out = [0f32; 3];
    for c in 0..8 {
        let (ir, ig, ib) = ((c >> 2) & 1, (c >> 1) & 1, c & 1);
        let w = wr[ir] * wg[ig] * wb[ib];
        if w == 0.0 {
            continue;
        }
        let k = ir * sr + ig * sg + ib * 3;
        let v = &cell[k..k + 3];
        out[0] = (out[0] as f64 + w * v[0] as f64) as f32;
        out[1] = (out[1] as f64 + w * v[1] as f64) as f32;
        out[2] = (out[2] as f64 + w * v[2] as f64) as f32;
    }
    out
}

/// Couleurs déjà calculées (les photos en répètent beaucoup), comme la version TypeScript.
const CACHE: usize = 1 << 16;

/// Pixels par part quand le calcul est réparti sur plusieurs cœurs (chaque part a son cache).
#[cfg(feature = "parallel")]
const PART: usize = 1 << 18;

fn proof_part(part: &mut [u8], lut: &[f32], grid: usize) {
    // Clé 24 bits + 1 (0 = vide) et résultat.
    let mut keys = vec![0u32; CACHE];
    let mut vals = vec![[0u8; 3]; CACHE];
    for p in part.chunks_exact_mut(4) {
        if p[3] == 0 {
            continue;
        }
        let key = ((p[0] as u32) << 16 | (p[1] as u32) << 8 | p[2] as u32) + 1;
        let slot = (key.wrapping_mul(0x9e37_79b1) >> 16) as usize;
        let v = if keys[slot] == key {
            vals[slot]
        } else {
            let out = interp3(
                lut,
                grid,
                p[0] as f64 / 255.0,
                p[1] as f64 / 255.0,
                p[2] as f64 / 255.0,
            );
            let v = out.map(|o| round(clamp01(o as f64) * 255.0) as u8);
            keys[slot] = key;
            vals[slot] = v;
            v
        };
        p[..3].copy_from_slice(&v);
    }
}

/// Remplace chaque pixel visible par la couleur qu'il aurait une fois imprimé, sur place.
pub fn soft_proof(data: &mut [u8], lut: &[f32], grid: usize) {
    if grid < 2 || lut.len() < grid * grid * grid * 3 {
        return;
    }
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        data.par_chunks_mut(PART * 4)
            .for_each(|part| proof_part(part, lut, grid));
    }
    #[cfg(not(feature = "parallel"))]
    proof_part(data, lut, grid);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Table identité : chaque nœud vaut sa position.
    fn identity(grid: usize) -> Vec<f32> {
        let s = (grid - 1) as f32;
        let mut lut = Vec::new();
        for r in 0..grid {
            for g in 0..grid {
                for b in 0..grid {
                    lut.extend_from_slice(&[r as f32 / s, g as f32 / s, b as f32 / s]);
                }
            }
        }
        lut
    }

    #[test]
    fn table_identite_ne_change_rien() {
        let lut = identity(17);
        let mut px: Vec<u8> = (0..256u32 * 4).map(|i| (i * 37 % 256) as u8).collect();
        for p in px.chunks_mut(4) {
            p[3] = 255;
        }
        let before = px.clone();
        soft_proof(&mut px, &lut, 17);
        assert_eq!(px, before);
    }

    #[test]
    fn pixels_transparents_et_table_invalide_ignores() {
        let lut = vec![0.5f32; 17 * 17 * 17 * 3];
        let mut px = vec![10, 20, 30, 0, 10, 20, 30, 255];
        soft_proof(&mut px, &lut, 17);
        assert_eq!(px, vec![10, 20, 30, 0, 128, 128, 128, 255]);
        soft_proof(&mut px, &lut[..10], 17);
        assert_eq!(px[4], 128);
    }
}
