//! Réduction du bruit : filtre bilatéral séparable (luminance sur 3 pixels, couleur sur 6).
//! Portage exact de `applyDenoise` (packages/core/src/denoise.ts) : mêmes opérations dans le même
//! ordre, sans exponentielle, donc exactement les mêmes pixels.

use crate::js::clamp_u8;
use crate::par::each_row;

const R_LUMA: f64 = 3.0;
const R_CHROMA: f64 = 6.0;

/// Rayon en pixels pour l'échelle d'aperçu donnée (au moins 1).
pub fn radius(base: f64, scale: f64) -> usize {
    (base * scale + 0.5).floor().max(1.0) as usize
}

/// Marge lue autour de chaque pixel (pixels de l'image, échelle d'aperçu comprise).
pub fn reach(scale: f64) -> usize {
    radius(R_CHROMA, scale)
}

#[inline(always)]
fn spatial(k: i64, r: f64) -> f64 {
    (r + 1.0 - (k.abs() as f64)) / (r + 1.0)
}

#[inline(always)]
fn similar(d: f64, s: f64) -> f64 {
    let q = d / s;
    1.0 / (1.0 + q * q)
}

/// Une passe sur un ou deux plans (`n` = 1 ou 2, entrelacés dans `inp` et `out`).
/// `weight(i, j)` : ressemblance du pixel j au pixel i.
fn pass(
    w: usize,
    h: usize,
    vertical: bool,
    r: usize,
    n: usize,
    inp: &[f64],
    weight: &(impl Fn(usize, usize) -> f64 + Sync),
) -> Vec<f64> {
    let rf = r as f64;
    let mut out = vec![0.0; w * h * n];
    let len = if vertical { h } else { w } as i64;
    each_row(&mut out, w * n, |y, row| {
        for x in 0..w {
            let i = y * w + x;
            let pos = if vertical { y } else { x } as i64;
            let (mut sa, mut sb, mut total) = (0.0, 0.0, 0.0);
            for k in -(r as i64)..=(r as i64) {
                let p = (pos + k).clamp(0, len - 1);
                let j = if vertical {
                    (p as usize) * w + x
                } else {
                    y * w + p as usize
                };
                let wt = spatial(k, rf) * weight(i, j);
                total += wt;
                sa += wt * inp[j * n];
                if n == 2 {
                    sb += wt * inp[j * n + 1];
                }
            }
            row[x * n] = if total > 0.0 { sa / total } else { inp[i * n] };
            if n == 2 {
                row[x * n + 1] = if total > 0.0 {
                    sb / total
                } else {
                    inp[i * n + 1]
                };
            }
        }
    });
    out
}

/// Applique la réduction du bruit sur place (`luminance` et `color` de 0 à 100).
pub fn apply(data: &mut [u8], w: usize, h: usize, luminance: f64, color: f64, scale: f64) {
    let lum = luminance.clamp(0.0, 100.0) / 100.0;
    let col = color.clamp(0.0, 100.0) / 100.0;
    if (lum == 0.0 && col == 0.0) || w * h == 0 {
        return;
    }
    let n = w * h;
    let mut yy = vec![0.0f64; n];
    let mut chroma = vec![0.0f64; n * 2];
    let mut alpha = vec![0.0f64; n];
    for i in 0..n {
        let (r, g, b) = (
            data[i * 4] as f64,
            data[i * 4 + 1] as f64,
            data[i * 4 + 2] as f64,
        );
        let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        yy[i] = y;
        chroma[i * 2] = b - y;
        chroma[i * 2 + 1] = r - y;
        alpha[i] = data[i * 4 + 3] as f64 / 255.0;
    }

    if lum > 0.0 {
        let sigma = 1.0 + lum * 40.0;
        let r = radius(R_LUMA, scale);
        for vertical in [false, true] {
            let src = yy;
            yy = pass(w, h, vertical, r, 1, &src, &|i, j| {
                alpha[j] * similar((src[j] - src[i]).abs(), sigma)
            });
        }
    }
    if col > 0.0 {
        let sigma = 4.0 + col * 30.0;
        let r = radius(R_CHROMA, scale);
        for vertical in [false, true] {
            let src = chroma;
            let y = &yy;
            chroma = pass(w, h, vertical, r, 2, &src, &|i, j| {
                let dcb = (src[j * 2] - src[i * 2]).abs();
                let dcr = (src[j * 2 + 1] - src[i * 2 + 1]).abs();
                alpha[j] * similar((y[j] - y[i]).abs() + 0.5 * (dcb + dcr), sigma)
            });
        }
    }

    for i in 0..n {
        let y = yy[i];
        let r = y + chroma[i * 2 + 1];
        let b = y + chroma[i * 2];
        let g = (y - 0.2126 * r - 0.0722 * b) / 0.7152;
        data[i * 4] = clamp_u8(r);
        data[i * 4 + 1] = clamp_u8(g);
        data[i * 4 + 2] = clamp_u8(b);
    }
}
