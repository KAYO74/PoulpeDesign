//! Recalage d'images pour le panorama : corrélation normalisée de deux images en niveaux de gris.
//!
//! Même calcul que `ncc` dans packages/core/src/panorama.ts, avec les mêmes sommes dans le même
//! ordre (nombres de 64 bits) : les notes sont identiques à la virgule près.

use crate::par;

/// Recouvrement minimal pour se fier à un recalage (part de la plus petite image).
const MIN_OVERLAP: f64 = 0.1;

/// Image en niveaux de gris (valeurs de 0 à 1).
pub struct Gray<'a> {
    pub w: usize,
    pub h: usize,
    pub d: &'a [f32],
}

/// Corrélation normalisée de `b` posée à (dx, dy) sur `a` ; -2 si le recouvrement est trop petit,
/// -1 si une des zones est unie.
pub fn ncc(a: &Gray, b: &Gray, dx: i64, dy: i64) -> f64 {
    let (aw, ah, bw, bh) = (a.w as i64, a.h as i64, b.w as i64, b.h as i64);
    let x0 = dx.max(0);
    let x1 = aw.min(dx + bw);
    let y0 = dy.max(0);
    let y1 = ah.min(dy + bh);
    let ow = x1 - x0;
    let oh = y1 - y0;
    let small = (aw * ah).min(bw * bh) as f64;
    if ow < 4 || oh < 4 || ((ow * oh) as f64) < MIN_OVERLAP * small {
        return -2.0;
    }
    let (mut sa, mut sb, mut saa, mut sbb, mut sab) = (0f64, 0f64, 0f64, 0f64, 0f64);
    let len = ow as usize;
    for y in y0..y1 {
        let ia = (y * aw + x0) as usize;
        let ib = ((y - dy) * bw + (x0 - dx)) as usize;
        let ra = &a.d[ia..ia + len];
        let rb = &b.d[ib..ib + len];
        for (&va, &vb) in ra.iter().zip(rb) {
            let (va, vb) = (va as f64, vb as f64);
            sa += va;
            sb += vb;
            saa += va * va;
            sbb += vb * vb;
            sab += va * vb;
        }
    }
    let n = (ow * oh) as f64;
    let cov = sab - (sa * sb) / n;
    let va = saa - (sa * sa) / n;
    let vb = sbb - (sb * sb) / n;
    if va < 1e-6 || vb < 1e-6 {
        return -1.0;
    }
    cov / (va * vb).sqrt()
}

/// Note de chaque décalage (dx de `x0` à `x0 + nx - 1`, dy de `y0` à `y0 + ny - 1`), ligne par ligne,
/// écrite dans `out` (`nx` × `ny` notes). Les lignes sont réparties sur tous les cœurs sur le bureau.
pub fn ncc_scan(a: &Gray, b: &Gray, x0: i64, y0: i64, nx: usize, ny: usize, out: &mut [f64]) {
    debug_assert_eq!(out.len(), nx * ny);
    par::each_row(out, nx.max(1), |j, row| {
        let dy = y0 + j as i64;
        for (i, s) in row.iter_mut().enumerate() {
            *s = ncc(a, b, x0 + i as i64, dy);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene(w: usize, h: usize) -> Vec<f32> {
        (0..w * h)
            .map(|i| {
                let (x, y) = ((i % w) as f32, (i / w) as f32);
                0.5 + 0.3 * (x / 7.0 + (y / 11.0).sin() * 2.0).sin()
            })
            .collect()
    }

    #[test]
    fn retrouve_le_decalage() {
        let (w, h) = (80, 40);
        let s = scene(w, h);
        // b = fenêtre de a décalée de (17, 3)
        let (bw, bh) = (50, 30);
        let mut b = vec![0f32; bw * bh];
        for y in 0..bh {
            for x in 0..bw {
                b[y * bw + x] = s[(y + 3) * w + x + 17];
            }
        }
        let (ga, gb) = (
            Gray { w, h, d: &s },
            Gray {
                w: bw,
                h: bh,
                d: &b,
            },
        );
        let (nx, ny) = (w + bw - 1, h + bh - 1);
        let mut out = vec![0f64; nx * ny];
        ncc_scan(
            &ga,
            &gb,
            -(bw as i64) + 1,
            -(bh as i64) + 1,
            nx,
            ny,
            &mut out,
        );
        let (mut best, mut at) = (-3.0, (0, 0));
        for j in 0..ny {
            for i in 0..nx {
                if out[j * nx + i] > best {
                    best = out[j * nx + i];
                    at = (i as i64 - bw as i64 + 1, j as i64 - bh as i64 + 1);
                }
            }
        }
        assert_eq!(at, (17, 3));
        assert!(best > 0.999);
    }
}
