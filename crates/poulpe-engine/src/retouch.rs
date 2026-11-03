//! Retouches : correcteur (texture de la source, lumière de la destination).
//! Même calcul que `healBlend` (packages/core/src/retouch.ts), pixel pour pixel.

use crate::blur::gaussian_blurred;
use crate::par::each_block;

/// Correcteur : la texture de `src` avec les couleurs et la lumière de `dest` (un flou de rayon
/// `sigma` de chacune). Les deux images ont la même taille ; l'opacité est celle de `dest`.
pub fn heal_blend(dest: &[u8], src: &[u8], w: usize, h: usize, sigma: f64) -> Vec<u8> {
    #[cfg(feature = "parallel")]
    let (bd, bs) = rayon::join(
        || gaussian_blurred(dest, w, h, sigma),
        || gaussian_blurred(src, w, h, sigma),
    );
    #[cfg(not(feature = "parallel"))]
    let (bd, bs) = (
        gaussian_blurred(dest, w, h, sigma),
        gaussian_blurred(src, w, h, sigma),
    );
    let mut out = vec![0u8; dest.len()];
    each_block(&mut out, |first, block| {
        let o = first * 4;
        for (k, px) in block.chunks_exact_mut(4).enumerate() {
            let i = o + k * 4;
            for c in 0..3 {
                let v = src[i + c] as i32 + bd[i + c] as i32 - bs[i + c] as i32;
                px[c] = v.clamp(0, 255) as u8;
            }
            px[3] = dest[i + 3];
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meme_source_que_destination_ne_change_rien() {
        let (w, h) = (13, 7);
        let data: Vec<u8> = (0..w * h * 4).map(|i| (i * 37 % 251) as u8).collect();
        assert_eq!(heal_blend(&data, &data, w, h, 2.0), data);
    }

    #[test]
    fn la_lumiere_vient_de_la_destination() {
        let (w, h) = (9, 9);
        let dest: Vec<u8> = (0..w * h).flat_map(|_| [200u8, 200, 200, 255]).collect();
        let src: Vec<u8> = (0..w * h).flat_map(|_| [50u8, 60, 70, 255]).collect();
        let out = heal_blend(&dest, &src, w, h, 2.0);
        assert!(out.chunks_exact(4).all(|p| p == [200, 200, 200, 255]));
    }
}
