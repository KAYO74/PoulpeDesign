//! Flou gaussien approché par trois flous en boîte, alpha prémultiplié pour éviter les halos.
//! Même calcul que `gaussianBlurred` (packages/core/src/adjust.ts), pixel pour pixel.
//!
//! Les lignes (passage horizontal) et les bandes de colonnes (passage vertical) sont
//! indépendantes : le travail se répartit sur tous les cœurs, et la mémoire est lue dans l'ordre.

use crate::js::{clamp_u8, round};
use crate::par::each_row;

/// Rayons de trois flous en boîte qui approchent un flou gaussien d'écart type `sigma`.
pub fn box_sizes(sigma: f64) -> [f64; 3] {
    let n = 3.0;
    let w_ideal = ((12.0 * sigma * sigma) / n + 1.0).sqrt();
    let mut wl = w_ideal.floor();
    if wl % 2.0 == 0.0 {
        wl -= 1.0;
    }
    let wu = wl + 2.0;
    let m_ideal = (12.0 * sigma * sigma - n * wl * wl - 4.0 * n * wl - 3.0 * n) / (-4.0 * wl - 4.0);
    let m = round(m_ideal);
    let mut out = [0.0; 3];
    for (i, o) in out.iter_mut().enumerate() {
        *o = ((if (i as f64) < m { wl } else { wu }) - 1.0) / 2.0;
    }
    out
}

/// Distance maximale (en pixels, sur chaque axe) dont le flou lit les voisins.
pub fn reach(sigma: f64) -> usize {
    if sigma < 0.3 {
        return 0;
    }
    box_sizes(sigma)
        .iter()
        .filter(|r| **r >= 1.0)
        .map(|r| *r as usize)
        .sum()
}

/// Flou en boîte horizontal d'une ligne de `w` pixels RGBA (valeurs flottantes). Les quatre
/// canaux avancent ensemble ; chacun garde exactement les mêmes calculs que la version TypeScript.
fn box_row(src: &[f32], dst: &mut [f32], w: usize, r: usize) {
    let k = 1.0 / (2.0 * r as f64 + 1.0);
    let px = |x: usize| -> [f64; 4] {
        let s = &src[x * 4..x * 4 + 4];
        [s[0] as f64, s[1] as f64, s[2] as f64, s[3] as f64]
    };
    let first = px(0);
    let last = px(w - 1);
    let mut acc = first.map(|v| v * (r as f64 + 1.0));
    for x in 0..r {
        let v = px(x.min(w - 1));
        for c in 0..4 {
            acc[c] += v[c];
        }
    }
    for x in 0..w {
        let add = if x + r < w { px(x + r) } else { last };
        let sub = if x > r { px(x - r - 1) } else { first };
        let d = &mut dst[x * 4..x * 4 + 4];
        for c in 0..4 {
            acc[c] += add[c] - sub[c];
            d[c] = (acc[c] * k) as f32;
        }
    }
}

fn box_h(src: &[f32], dst: &mut [f32], w: usize, r: usize) {
    each_row(dst, w * 4, |y, row| {
        box_row(&src[y * w * 4..(y + 1) * w * 4], row, w, r)
    });
}

/// Pointeur partagé entre fils : chaque fil n'écrit que dans ses propres colonnes.
#[derive(Clone, Copy)]
struct Shared(*mut f32);
unsafe impl Send for Shared {}
unsafe impl Sync for Shared {}

/// Flou en boîte vertical des colonnes `x0..x1` : on descend ligne par ligne avec un
/// accumulateur par colonne, la mémoire est lue dans l'ordre.
fn box_v_strip(src: &[f32], dst: Shared, w: usize, h: usize, r: usize, x0: usize, x1: usize) {
    let k = 1.0 / (2.0 * r as f64 + 1.0);
    let stride = w * 4;
    let (a, b) = (x0 * 4, x1 * 4);
    let n = b - a;
    let first: Vec<f64> = src[a..b].iter().map(|v| *v as f64).collect();
    let last: Vec<f64> = src[(h - 1) * stride + a..(h - 1) * stride + b]
        .iter()
        .map(|v| *v as f64)
        .collect();
    let mut acc: Vec<f64> = first.iter().map(|v| v * (r as f64 + 1.0)).collect();
    for y in 0..r {
        let row = &src[y.min(h - 1) * stride + a..y.min(h - 1) * stride + b];
        for i in 0..n {
            acc[i] += row[i] as f64;
        }
    }
    for y in 0..h {
        let add = if y + r < h {
            Some(&src[(y + r) * stride + a..(y + r) * stride + b])
        } else {
            None
        };
        let sub = if y > r {
            Some(&src[(y - r - 1) * stride + a..(y - r - 1) * stride + b])
        } else {
            None
        };
        // SAFETY : les colonnes x0..x1 n'appartiennent qu'à ce fil, et la ligne y existe.
        let out = unsafe { std::slice::from_raw_parts_mut(dst.0.add(y * stride + a), n) };
        for i in 0..n {
            let ad = add.map_or(last[i], |s| s[i] as f64);
            let su = sub.map_or(first[i], |s| s[i] as f64);
            acc[i] += ad - su;
            out[i] = (acc[i] * k) as f32;
        }
    }
}

fn box_v(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize) {
    assert_eq!(dst.len(), w * h * 4);
    let ptr = Shared(dst.as_mut_ptr());
    // Bandes de 256 colonnes : l'accumulateur tient dans le cache.
    let strips: Vec<(usize, usize)> = (0..w).step_by(256).map(|x| (x, (x + 256).min(w))).collect();
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        strips
            .par_iter()
            .for_each(|&(x0, x1)| box_v_strip(src, ptr, w, h, r, x0, x1));
    }
    #[cfg(not(feature = "parallel"))]
    for &(x0, x1) in &strips {
        box_v_strip(src, ptr, w, h, r, x0, x1);
    }
}

/// Appelle `f(pixel source, pixel destination)` pour chaque pixel, sur tous les cœurs si possible.
fn zip_pixels<A: Sync, B: Send>(
    src: &[A],
    dst: &mut [B],
    f: impl Fn(&[A], &mut [B]) + Sync + Send,
) {
    const BLOCK: usize = 64 * 1024;
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        src.par_chunks(BLOCK)
            .zip(dst.par_chunks_mut(BLOCK))
            .for_each(|(s, d)| {
                s.chunks_exact(4)
                    .zip(d.chunks_exact_mut(4))
                    .for_each(|(p, o)| f(p, o));
            });
    }
    #[cfg(not(feature = "parallel"))]
    src.chunks_exact(4)
        .zip(dst.chunks_exact_mut(4))
        .for_each(|(p, o)| f(p, o));
}

/// Copie floutée des pixels RGBA (non prémultipliés), d'écart type `sigma` en pixels.
pub fn gaussian_blurred(data: &[u8], w: usize, h: usize, sigma: f64) -> Vec<u8> {
    let mut out = vec![0u8; data.len()];
    if sigma < 0.3 || w == 0 || h == 0 {
        out.copy_from_slice(data);
        return out;
    }
    let mut a = vec![0f32; data.len()];
    zip_pixels(data, &mut a, |px, o| {
        let al = px[3] as f64 / 255.0;
        o[0] = (px[0] as f64 * al) as f32;
        o[1] = (px[1] as f64 * al) as f32;
        o[2] = (px[2] as f64 * al) as f32;
        o[3] = px[3] as f32;
    });
    let mut b = vec![0f32; data.len()];
    for r in box_sizes(sigma) {
        if r < 1.0 {
            continue;
        }
        let r = r as usize;
        // a → b (horizontal), puis b → a (vertical).
        box_h(&a, &mut b, w, r.min(w));
        box_v(&b, &mut a, w, h, r.min(h));
    }
    zip_pixels(&a, &mut out, |px, o| {
        let al = px[3] as f64;
        o[3] = clamp_u8(al);
        if al > 0.001 {
            let k = 255.0 / al;
            o[0] = clamp_u8(px[0] as f64 * k);
            o[1] = clamp_u8(px[1] as f64 * k);
            o[2] = clamp_u8(px[2] as f64 * k);
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tailles_des_boites() {
        assert_eq!(box_sizes(4.0), [3.0, 3.0, 4.0]);
        assert_eq!(reach(4.0), 10);
        assert_eq!(reach(0.1), 0);
    }

    #[test]
    fn une_image_unie_reste_unie() {
        let (w, h) = (17, 9);
        let data: Vec<u8> = (0..w * h).flat_map(|_| [200u8, 40, 90, 255]).collect();
        let out = gaussian_blurred(&data, w, h, 3.0);
        assert_eq!(out, data);
    }

    #[test]
    fn pas_de_halo_sur_le_transparent() {
        // Un pixel rouge opaque entouré de transparent : le flou reste rouge, seule l'opacité baisse.
        let (w, h) = (9, 9);
        let mut data = vec![0u8; w * h * 4];
        let c = (4 * w + 4) * 4;
        data[c..c + 4].copy_from_slice(&[255, 0, 0, 255]);
        let out = gaussian_blurred(&data, w, h, 1.0);
        for px in out.chunks_exact(4).filter(|p| p[3] > 0) {
            assert_eq!(&px[..3], &[255, 0, 0]);
        }
    }
}
