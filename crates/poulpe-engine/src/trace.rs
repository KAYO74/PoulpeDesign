//! Vectorisation : étiquetage des pixels par la couleur la plus proche de la palette, même calcul
//! que la fin de `quantize` (packages/core/src/trace.ts). La palette (k-means sur un échantillon)
//! reste calculée par le TypeScript.

/// Couleurs déjà étiquetées (les images en répètent beaucoup).
const CACHE: usize = 1 << 16;

/// Totaux d'un groupe : nombre de pixels et sommes des rouges, verts, bleus.
pub type GroupSums = [f64; 4];

/// Étiquette chaque pixel (−1 : transparent ou blanc ignoré) avec le centre le plus proche
/// (`centers` : `dim` nombres par centre, `dim` = 1 en gris, 3 en couleur), et renvoie les totaux
/// de chaque groupe. Les sommes sont des entiers : leur ordre ne change rien.
pub fn label(
    data: &[u8],
    centers: &[f64],
    dim: usize,
    ignore_white: bool,
    labels: &mut [i32],
) -> Vec<GroupSums> {
    let kk = if dim == 0 { 0 } else { centers.len() / dim };
    let mut sums = vec![[0f64; 4]; kk];
    if kk == 0 {
        labels.fill(-1);
        return sums;
    }
    let nearest = |v: &[f64; 3]| -> i32 {
        let mut best = 0;
        let mut best_d = f64::INFINITY;
        for j in 0..kk {
            let mut d = 0f64;
            for c in 0..dim {
                let e = v[c] - centers[j * dim + c];
                d += e * e;
            }
            if d < best_d {
                best_d = d;
                best = j as i32;
            }
        }
        best
    };
    let mut keys = vec![0u32; CACHE];
    let mut vals = vec![0i32; CACHE];
    for (p, l) in data.chunks_exact(4).zip(labels.iter_mut()) {
        let (r, g, b) = (p[0], p[1], p[2]);
        if p[3] < 128 || (ignore_white && r > 235 && g > 235 && b > 235) {
            *l = -1;
            continue;
        }
        let key = ((r as u32) << 16 | (g as u32) << 8 | b as u32) + 1;
        let slot = (key.wrapping_mul(0x9e37_79b1) >> 16) as usize;
        let j = if keys[slot] == key {
            vals[slot]
        } else {
            let v = if dim == 1 {
                [
                    0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64,
                    0.0,
                    0.0,
                ]
            } else {
                [r as f64, g as f64, b as f64]
            };
            let j = nearest(&v);
            keys[slot] = key;
            vals[slot] = j;
            j
        };
        *l = j;
        let s = &mut sums[j as usize];
        s[0] += 1.0;
        s[1] += r as f64;
        s[2] += g as f64;
        s[3] += b as f64;
    }
    sums
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etiquette_par_le_centre_le_plus_proche() {
        let data = [
            10, 10, 10, 255, 250, 250, 250, 255, 200, 20, 20, 255, 0, 0, 0, 0, 12, 10, 10, 255,
        ];
        let centers = [0.0, 0.0, 0.0, 255.0, 255.0, 255.0, 255.0, 0.0, 0.0];
        let mut labels = [0i32; 5];
        let sums = label(&data, &centers, 3, false, &mut labels);
        assert_eq!(labels, [0, 1, 2, -1, 0]);
        assert_eq!(sums[0], [2.0, 22.0, 20.0, 20.0]);
        // Blanc ignoré, et gris.
        let sums = label(&data, &[0.0, 255.0], 1, true, &mut labels);
        assert_eq!(labels, [0, -1, 0, -1, 0]);
        assert_eq!(sums[1][0], 0.0);
    }
}
