//! Fusion d'images prises à la suite (méthode de Mertens, Kautz et Van Reeth) : même calcul que
//! `fuseImages` (packages/core/src/fusion.ts), en flottants 32 bits.
//!
//! La fusion se fait en deux passes pour que l'interface puisse suivre l'avancement et annuler :
//! `add_weight` pour chaque image (cartes de poids), `normalize`, puis `blend` pour chaque image
//! (pyramide laplacienne mélangée niveau par niveau), et enfin `finish`.

const KERNEL: [f32; 5] = [1.0, 4.0, 6.0, 4.0, 1.0];

#[derive(Clone)]
pub struct Level {
    pub data: Vec<f32>,
    pub w: usize,
    pub h: usize,
}

#[inline]
fn clamp_idx(i: isize, n: usize) -> usize {
    i.clamp(0, n as isize - 1) as usize
}

/// Passage horizontal du flou 5 points (bords répétés) ; `step_x` > 1 ne calcule qu'une colonne sur
/// `step_x` (sous-échantillonnage).
fn blur_h(src: &[f32], w: usize, h: usize, ch: usize, step_x: usize) -> (Vec<f32>, usize) {
    let ow = w.div_ceil(step_x);
    let mut out = vec![0f32; ow * h * ch];
    for y in 0..h {
        let row = &src[y * w * ch..(y + 1) * w * ch];
        let orow = &mut out[y * ow * ch..(y + 1) * ow * ch];
        for ox in 0..ow {
            let x = ox * step_x;
            for c in 0..ch {
                let mut s = 0f32;
                if x >= 2 && x + 2 < w {
                    for (k, kv) in KERNEL.iter().enumerate() {
                        s += kv * row[(x + k - 2) * ch + c];
                    }
                } else {
                    for (k, kv) in KERNEL.iter().enumerate() {
                        s += kv * row[clamp_idx(x as isize + k as isize - 2, w) * ch + c];
                    }
                }
                orow[ox * ch + c] = s / 16.0;
            }
        }
    }
    (out, ow)
}

/// Passage vertical ; `step_y` > 1 ne calcule qu'une ligne sur `step_y`.
fn blur_v(src: &[f32], w: usize, h: usize, ch: usize, step_y: usize) -> (Vec<f32>, usize) {
    let oh = h.div_ceil(step_y);
    let rw = w * ch;
    let mut out = vec![0f32; rw * oh];
    for oy in 0..oh {
        let y = oy * step_y;
        let rows: [&[f32]; 5] = std::array::from_fn(|k| {
            let yy = clamp_idx(y as isize + k as isize - 2, h);
            &src[yy * rw..(yy + 1) * rw]
        });
        let orow = &mut out[oy * rw..(oy + 1) * rw];
        for i in 0..rw {
            let s =
                rows[0][i] + 4.0 * rows[1][i] + 6.0 * rows[2][i] + 4.0 * rows[3][i] + rows[4][i];
            orow[i] = s / 16.0;
        }
    }
    (out, oh)
}

/// Flou séparable 5 points (bords répétés) sur `ch` canaux entrelacés.
pub fn blur(src: &[f32], w: usize, h: usize, ch: usize) -> Vec<f32> {
    let (t, _) = blur_h(src, w, h, ch, 1);
    blur_v(&t, w, h, ch, 1).0
}

/// Réduit de moitié (après flou) : seuls les pixels gardés sont calculés.
pub fn down(src: &[f32], w: usize, h: usize, ch: usize) -> Level {
    let (t, ow) = blur_h(src, w, h, ch, 2);
    let (data, oh) = blur_v(&t, ow, h, ch, 2);
    Level { data, w: ow, h: oh }
}

/// Agrandit à (W, H) : insertion de zéros puis flou, comme dans la pyramide de Burt et Adelson.
pub fn up(src: &[f32], w: usize, h: usize, ch: usize, ww: usize, hh: usize) -> Vec<f32> {
    let mut big = vec![0f32; ww * hh * ch];
    for y in 0..h {
        let yy = y * 2;
        if yy >= hh {
            continue;
        }
        for x in 0..w {
            let xx = x * 2;
            if xx >= ww {
                continue;
            }
            for c in 0..ch {
                big[(yy * ww + xx) * ch + c] = src[(y * w + x) * ch + c] * 4.0;
            }
        }
    }
    blur(&big, ww, hh, ch)
}

fn gaussian_pyramid(src: Vec<f32>, w: usize, h: usize, ch: usize, levels: usize) -> Vec<Level> {
    let mut out = vec![Level { data: src, w, h }];
    for i in 1..levels {
        let p = &out[i - 1];
        let n = down(&p.data, p.w, p.h, ch);
        out.push(n);
    }
    out
}

fn laplacian_pyramid(src: Vec<f32>, w: usize, h: usize, ch: usize, levels: usize) -> Vec<Level> {
    let mut g = gaussian_pyramid(src, w, h, ch, levels);
    let mut out = Vec::with_capacity(levels);
    for i in 0..levels - 1 {
        let (a, b) = (&g[i], &g[i + 1]);
        let u = up(&b.data, b.w, b.h, ch, a.w, a.h);
        let d: Vec<f32> = a.data.iter().zip(u.iter()).map(|(x, y)| x - y).collect();
        out.push(Level {
            data: d,
            w: a.w,
            h: a.h,
        });
    }
    out.push(g.pop().expect("au moins un niveau"));
    out
}

/// Niveaux de la pyramide : jusqu'à environ 16 pixels de côté, au plus 9.
pub fn levels_for(w: usize, h: usize) -> usize {
    let m = (w.min(h) as f64 / 16.0).max(2.0);
    (m.log2().floor() as usize + 1).clamp(1, 9)
}

/// Fusion en cours.
pub struct Fusion {
    w: usize,
    h: usize,
    focus: bool,
    wc: f32,
    ws: f32,
    we: f32,
    levels: usize,
    weights: Vec<Vec<f32>>,
    alpha: Vec<u8>,
    result: Option<Vec<Level>>,
}

impl Fusion {
    pub fn new(w: usize, h: usize, focus: bool, wc: f32, ws: f32, we: f32) -> Self {
        Fusion {
            w,
            h,
            focus,
            wc,
            ws,
            we,
            levels: levels_for(w, h),
            weights: Vec::new(),
            alpha: vec![0; w * h],
            result: None,
        }
    }

    /// Vrai si l'image `k` a une carte de poids (pas encore mélangée).
    pub fn has_weight(&self, k: usize) -> bool {
        k < self.weights.len() && !self.weights[k].is_empty()
    }

    /// Carte de poids d'une image : produit des critères choisis, nul là où elle est transparente.
    pub fn add_weight(&mut self, px: &[u8]) {
        let (w, h) = (self.w, self.h);
        let n = w * h;
        let mut gray = vec![0f32; n];
        for (g, p) in gray.iter_mut().zip(px.chunks_exact(4)) {
            *g = (0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32) / 255.0;
        }
        // Contraste : valeur absolue du laplacien de la luminance.
        let mut contrast = vec![0f32; n];
        for y in 0..h {
            let (ym, yp) = (y.saturating_sub(1), (y + 1).min(h - 1));
            for x in 0..w {
                let (xm, xp) = (x.saturating_sub(1), (x + 1).min(w - 1));
                let c = gray[y * w + x];
                let s = gray[y * w + xm] + gray[y * w + xp] + gray[ym * w + x] + gray[yp * w + x];
                contrast[y * w + x] = (s - 4.0 * c).abs();
            }
        }
        // Mise au point : l'énergie du contraste est lissée, pour que le choix suive des zones.
        let sharp = if self.focus {
            blur(&contrast, w, h, 1)
        } else {
            contrast
        };
        let mut out = vec![0f32; n];
        let pw = |v: f32, e: f32| if e == 1.0 { v } else { v.powf(e) };
        // Bonne exposition par valeur de canal (256 cas) : la courbe de Gauss est calculée une fois.
        let well: Vec<f32> = (0..256)
            .map(|b| {
                let v = b as f32 / 255.0;
                (-((v - 0.5) * (v - 0.5)) / (2.0 * 0.2 * 0.2)).exp()
            })
            .collect();
        for i in 0..n {
            let p = &px[i * 4..i * 4 + 4];
            let alpha = p[3] as f32 / 255.0;
            if p[3] > self.alpha[i] {
                self.alpha[i] = p[3];
            }
            if alpha <= 0.0 {
                continue;
            }
            if self.focus {
                out[i] = sharp[i] * alpha + 1e-12;
                continue;
            }
            let (r, g, b) = (
                p[0] as f32 / 255.0,
                p[1] as f32 / 255.0,
                p[2] as f32 / 255.0,
            );
            let mean = (r + g + b) / 3.0;
            let sat = (((r - mean).powi(2) + (g - mean).powi(2) + (b - mean).powi(2)) / 3.0).sqrt();
            let e = well[p[0] as usize] * well[p[1] as usize] * well[p[2] as usize];
            out[i] = pw(sharp[i] + 1e-3, self.wc)
                * pw(sat + 1e-3, self.ws)
                * pw(e + 1e-3, self.we)
                * alpha;
        }
        self.weights.push(out);
    }

    /// Les poids de chaque pixel sont ramenés à une somme de 1.
    pub fn normalize(&mut self) {
        for i in 0..self.w * self.h {
            let sum: f32 = self.weights.iter().map(|wm| wm[i]).sum();
            if sum > 0.0 {
                for wm in self.weights.iter_mut() {
                    wm[i] /= sum;
                }
            }
        }
    }

    /// Mélange l'image `k` (pixels RGBA) dans la pyramide du résultat.
    pub fn blend(&mut self, k: usize, px: &[u8]) {
        let (w, h, levels) = (self.w, self.h, self.levels);
        let n = w * h;
        let mut rgb = vec![0f32; n * 3];
        for (o, p) in rgb.chunks_exact_mut(3).zip(px.chunks_exact(4)) {
            o[0] = p[0] as f32 / 255.0;
            o[1] = p[1] as f32 / 255.0;
            o[2] = p[2] as f32 / 255.0;
        }
        let lap = laplacian_pyramid(rgb, w, h, 3, levels);
        let wt = std::mem::take(&mut self.weights[k]);
        let gw = gaussian_pyramid(wt, w, h, 1, levels);
        let result = self.result.get_or_insert_with(|| {
            lap.iter()
                .map(|l| Level {
                    data: vec![0f32; l.data.len()],
                    w: l.w,
                    h: l.h,
                })
                .collect()
        });
        for l in 0..levels {
            let dst = &mut result[l].data;
            let a = &lap[l].data;
            for (i, &v) in gw[l].data.iter().enumerate() {
                dst[i * 3] += a[i * 3] * v;
                dst[i * 3 + 1] += a[i * 3 + 1] * v;
                dst[i * 3 + 2] += a[i * 3 + 2] * v;
            }
        }
    }

    /// Remonte la pyramide et écrit l'image fusionnée (RGBA) dans `out`.
    pub fn finish(mut self, out: &mut [u8]) {
        let mut result = self.result.take().unwrap_or_default();
        let levels = result.len();
        if levels > 0 {
            for l in (0..levels.saturating_sub(1)).rev() {
                let cur = result.pop().expect("niveau");
                let target = &mut result[l];
                let u = up(&cur.data, cur.w, cur.h, 3, target.w, target.h);
                for (t, v) in target.data.iter_mut().zip(u.iter()) {
                    *t += v;
                }
            }
            let cur = &result[0];
            for i in 0..self.w * self.h {
                // Conversion saturante, comme Uint8ClampedArray (arrondi au plus proche, pair si égalité).
                for c in 0..3 {
                    out[i * 4 + c] = (cur.data[i * 3 + c] * 255.0)
                        .clamp(0.0, 255.0)
                        .round_ties_even() as u8;
                }
                out[i * 4 + 3] = self.alpha[i];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(images: &[Vec<u8>], w: usize, h: usize, focus: bool) -> Vec<u8> {
        let mut f = Fusion::new(w, h, focus, 1.0, 1.0, 1.0);
        for im in images {
            f.add_weight(im);
        }
        f.normalize();
        for (k, im) in images.iter().enumerate() {
            f.blend(k, im);
        }
        let mut out = vec![0u8; w * h * 4];
        f.finish(&mut out);
        out
    }

    fn picture(w: usize, h: usize, gain: f32) -> Vec<u8> {
        let mut v = vec![255u8; w * h * 4];
        for i in 0..w * h {
            let (x, y) = (i % w, i / w);
            v[i * 4] = ((x * 255 / w) as f32 * gain).min(255.0) as u8;
            v[i * 4 + 1] = ((y * 255 / h) as f32 * gain).min(255.0) as u8;
            v[i * 4 + 2] = (((x * y) % 200) as f32 * gain).min(255.0) as u8;
        }
        v
    }

    #[test]
    fn une_image_revient_a_elle_meme() {
        let im = picture(40, 30, 1.0);
        let out = run(&[im.clone()], 40, 30, false);
        for (a, b) in im.iter().zip(out.iter()) {
            assert!((*a as i32 - *b as i32).abs() <= 1);
        }
    }

    #[test]
    fn transparent_partout_reste_transparent() {
        let mut im = picture(20, 20, 1.0);
        for p in im.chunks_exact_mut(4) {
            p[3] = 0;
        }
        let out = run(&[im.clone(), im], 20, 20, false);
        assert!(out.chunks_exact(4).all(|p| p[3] == 0));
    }

    #[test]
    fn deux_expositions_donnent_une_image_entre_les_deux() {
        let (a, b) = (picture(48, 48, 0.3), picture(48, 48, 1.0));
        let out = run(&[a.clone(), b.clone()], 48, 48, false);
        let mid = (24 * 48 + 24) * 4;
        assert!(out[mid] >= a[mid].min(b[mid]) && out[mid] <= a[mid].max(b[mid]) + 1);
    }

    #[test]
    fn niveaux_de_pyramide() {
        assert_eq!(levels_for(16, 16), 2);
        assert_eq!(levels_for(1, 1), 2);
        assert_eq!(levels_for(4000, 3000), 8);
        assert_eq!(levels_for(100000, 100000), 9);
    }
}
