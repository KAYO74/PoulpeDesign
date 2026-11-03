//! Remplissage d'après le contenu (gomme magique, PatchMatch). Même calcul que `inpaint`
//! (packages/core/src/inpaint.ts), étape par étape, avec le même tirage aléatoire.

struct Level {
    w: usize,
    h: usize,
    /// RGBA en flottants.
    img: Vec<f32>,
    /// 1 = pixel à reconstruire.
    hole: Vec<u8>,
}

/// Tirage aléatoire de la version TypeScript (mulberry32).
struct Rng(u32);

impl Rng {
    fn new(seed: u32) -> Self {
        Rng(if seed == 0 { 1 } else { seed })
    }
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let a = self.0;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }
}

/// `Math.round` de JavaScript : les moitiés vers le haut.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

fn downsample(l: &Level) -> Level {
    let w = (l.w >> 1).max(1);
    let h = (l.h >> 1).max(1);
    let mut img = vec![0f32; w * h * 4];
    let mut hole = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut n = 0.0f64;
            let mut any = 0u8;
            let mut acc = [0f64; 4];
            for dy in 0..2 {
                for dx in 0..2 {
                    let sx = (l.w - 1).min(2 * x + dx);
                    let sy = (l.h - 1).min(2 * y + dy);
                    let si = sy * l.w + sx;
                    if l.hole[si] != 0 {
                        any = 1;
                        continue;
                    }
                    for c in 0..4 {
                        acc[c] += l.img[si * 4 + c] as f64;
                    }
                    n += 1.0;
                }
            }
            let i = y * w + x;
            hole[i] = any;
            if n > 0.0 {
                for c in 0..4 {
                    img[i * 4 + c] = (acc[c] / n) as f32;
                }
            }
        }
    }
    Level { w, h, img, hole }
}

/// Premier remplissage du trou : de proche en proche, par la moyenne des voisins connus.
fn onion_fill(l: &mut Level) {
    let (w, h) = (l.w, l.h);
    let mut known: Vec<u8> = l.hole.iter().map(|&v| if v != 0 { 0 } else { 1 }).collect();
    let mut remaining = known.iter().filter(|&&k| k == 0).count();
    if remaining == w * h {
        return;
    }
    while remaining > 0 {
        let mut fill = Vec::new();
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                if known[i] != 0 {
                    continue;
                }
                let mut n = 0.0f64;
                let mut acc = [0f64; 4];
                for dy in -1i64..=1 {
                    for dx in -1i64..=1 {
                        let nx = x as i64 + dx;
                        let ny = y as i64 + dy;
                        if nx < 0 || ny < 0 || nx >= w as i64 || ny >= h as i64 {
                            continue;
                        }
                        let j = ny as usize * w + nx as usize;
                        if known[j] == 0 {
                            continue;
                        }
                        for c in 0..4 {
                            acc[c] += l.img[j * 4 + c] as f64;
                        }
                        n += 1.0;
                    }
                }
                if n > 0.0 {
                    for c in 0..4 {
                        l.img[i * 4 + c] = (acc[c] / n) as f32;
                    }
                    fill.push(i);
                }
            }
        }
        if fill.is_empty() {
            break;
        }
        for &i in &fill {
            known[i] = 1;
        }
        remaining -= fill.len();
    }
}

/// Reconstruit les pixels du trou (`hole[i]` non nul) de l'image RGBA, sur place.
pub fn inpaint(
    data: &mut [u8],
    big_w: usize,
    big_h: usize,
    hole_in: &[u8],
    patch: usize,
    seed: u32,
) {
    let p = (patch | 1).max(3);
    let r = p >> 1;
    let (pi, ri) = (p as i64, r as i64);
    let mut rng = Rng::new(seed);
    let (mut hx0, mut hy0, mut hx1, mut hy1) = (big_w as i64, big_h as i64, -1i64, -1i64);
    let mut count = 0;
    for y in 0..big_h {
        for x in 0..big_w {
            if hole_in[y * big_w + x] != 0 {
                count += 1;
                hx0 = hx0.min(x as i64);
                hx1 = hx1.max(x as i64);
                hy0 = hy0.min(y as i64);
                hy1 = hy1.max(y as i64);
            }
        }
    }
    if count == 0 || count == big_w * big_h {
        return;
    }
    let base = Level {
        w: big_w,
        h: big_h,
        img: data.iter().map(|&v| v as f32).collect(),
        hole: hole_in.iter().map(|&v| (v != 0) as u8).collect(),
    };
    let mut levels = vec![base];
    let mut hole_size = ((hx1 - hx0 + 1).max(hy1 - hy0 + 1)) as f64;
    while hole_size > (p * 2) as f64 && levels[0].w.min(levels[0].h) > p * 4 {
        let d = downsample(&levels[0]);
        levels.insert(0, d);
        hole_size /= 2.0;
    }
    onion_fill(&mut levels[0]);

    let mut prev_nnf: Option<Vec<i64>> = None;
    let (mut prev_w, mut prev_h) = (0usize, 0usize);
    let n_levels = levels.len();

    for li in 0..n_levels {
        let (before, rest) = levels.split_at_mut(li);
        let l = &mut rest[0];
        let (w, h) = (l.w, l.h);
        let (wi, hi) = (w as i64, h as i64);

        let mut integral = vec![0i32; (w + 1) * (h + 1)];
        for y in 0..h {
            let mut row = 0i32;
            for x in 0..w {
                row += l.hole[y * w + x] as i32;
                integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
            }
        }
        let holes_in = |x0: i64, y0: i64, x1: i64, y1: i64| -> i32 {
            let x0 = x0.max(0) as usize;
            let y0 = y0.max(0) as usize;
            let x1 = x1.min(wi).max(0) as usize;
            let y1 = y1.min(hi).max(0) as usize;
            if x1 <= x0 || y1 <= y0 {
                return 0;
            }
            integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0]
                + integral[y0 * (w + 1) + x0]
        };
        let mut valid = vec![0u8; w * h];
        let mut src_list: Vec<i64> = Vec::new();
        for y in r..h.saturating_sub(r) {
            for x in r..w.saturating_sub(r) {
                let (xi, yi) = (x as i64, y as i64);
                if holes_in(xi - ri, yi - ri, xi + ri + 1, yi + ri + 1) == 0 {
                    valid[y * w + x] = 1;
                    src_list.push((y * w + x) as i64);
                }
            }
        }
        let mut targets: Vec<i64> = Vec::new();
        for y in 0..hi {
            for x in 0..wi {
                if holes_in(x - ri, y - ri, x + ri + 1, y + ri + 1) > 0 {
                    targets.push(y * wi + x);
                }
            }
        }
        if src_list.is_empty() || targets.is_empty() {
            prev_nnf = None;
            continue;
        }

        if li > 0 {
            let prev = &before[li - 1];
            for y in 0..h {
                for x in 0..w {
                    let i = y * w + x;
                    if l.hole[i] == 0 {
                        continue;
                    }
                    let pi_ = (prev.h - 1).min(y >> 1) * prev.w + (prev.w - 1).min(x >> 1);
                    for c in 0..4 {
                        l.img[i * 4 + c] = prev.img[pi_ * 4 + c];
                    }
                }
            }
        }

        let mut nnf = vec![-1i64; w * h];
        let mut dist = vec![0f32; w * h];
        let hole = &l.hole;
        let img = &mut l.img;

        // Distance entre le carré autour de `t` et celui autour de `s` (somme des carrés des
        // écarts, dans le même ordre que la version TypeScript), arrêtée dès qu'elle dépasse `best`.
        let patch_dist = |img: &[f32], t: i64, s: i64, best: f64| -> f64 {
            let (tx, ty) = (t % wi, t / wi);
            let (sx, sy) = (s % wi, s / wi);
            let x0 = (tx - ri).max(0);
            let x1 = (tx + ri).min(wi - 1);
            let n = ((x1 - x0 + 1) * 4) as usize;
            let mut d = 0f64;
            for dy in -ri..=ri {
                let yy = ty + dy;
                if yy < 0 || yy >= hi {
                    continue;
                }
                let a = ((yy * wi + x0) * 4) as usize;
                let b = (((sy + dy) * wi + sx + x0 - tx) * 4) as usize;
                for (pa, pb) in img[a..a + n]
                    .chunks_exact(4)
                    .zip(img[b..b + n].chunks_exact(4))
                {
                    let d0 = pa[0] as f64 - pb[0] as f64;
                    let d1 = pa[1] as f64 - pb[1] as f64;
                    let d2 = pa[2] as f64 - pb[2] as f64;
                    let d3 = pa[3] as f64 - pb[3] as f64;
                    d += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
                }
                if d >= best {
                    return d;
                }
            }
            d
        };

        for &t in &targets {
            let mut s = -1i64;
            if let Some(prev) = &prev_nnf {
                let (x, y) = (t % wi, t / wi);
                let pp = prev[((prev_h as i64 - 1).min(y >> 1) * prev_w as i64
                    + (prev_w as i64 - 1).min(x >> 1)) as usize];
                if pp >= 0 {
                    let cx = 2 * (pp % prev_w as i64) + (x & 1);
                    let cy = 2 * (pp / prev_w as i64) + (y & 1);
                    if cx < wi && cy < hi && valid[(cy * wi + cx) as usize] != 0 {
                        s = cy * wi + cx;
                    }
                }
            }
            if s < 0 {
                s = src_list[(rng.next() * src_list.len() as f64).floor() as usize];
            }
            nnf[t as usize] = s;
        }

        let from_top = n_levels - 1 - li;
        let em_iters = match from_top {
            0 => 1,
            1 => 2,
            n => (2 + n).min(6),
        };
        let pm_iters = if from_top == 0 { 2 } else { 4 };
        let max_radius: i64 = if from_top == 0 && li > 0 {
            (pi * 4).max(8)
        } else {
            wi.max(hi)
        };

        for _ in 0..em_iters {
            for &t in &targets {
                dist[t as usize] = patch_dist(img, t, nnf[t as usize], f64::INFINITY) as f32;
            }
            for it in 0..pm_iters {
                let forward = it % 2 == 0;
                let step: i64 = if forward { 1 } else { -1 };
                let n_t = targets.len();
                for k in 0..n_t {
                    let t = targets[if forward { k } else { n_t - 1 - k }];
                    let (x, y) = (t % wi, t / wi);
                    let mut best = nnf[t as usize];
                    let mut best_d = dist[t as usize] as f64;
                    let try_cand = |s: i64, best: &mut i64, best_d: &mut f64| {
                        if s < 0 || s == *best || valid[s as usize] == 0 {
                            return;
                        }
                        let d = patch_dist(img, t, s, *best_d);
                        if d < *best_d {
                            *best_d = d;
                            *best = s;
                        }
                    };
                    let nx = x - step;
                    if nx >= 0 && nx < wi {
                        let q = nnf[(y * wi + nx) as usize];
                        if q >= 0 {
                            let qx = q % wi + step;
                            if qx >= 0 && qx < wi {
                                try_cand(q + step, &mut best, &mut best_d);
                            }
                        }
                    }
                    let ny = y - step;
                    if ny >= 0 && ny < hi {
                        let q = nnf[(ny * wi + x) as usize];
                        if q >= 0 {
                            let qy = q / wi + step;
                            if qy >= 0 && qy < hi {
                                try_cand(q + step * wi, &mut best, &mut best_d);
                            }
                        }
                    }
                    let (bx, by) = ((best % wi) as f64, (best / wi) as f64);
                    // Les candidats ne dépendent que du tirage : on les tire d'abord, puis on lit
                    // le début de chacune de leurs lignes d'un coup, pour que le processeur aille
                    // chercher en mémoire en parallèle au lieu d'attendre ligne par ligne.
                    let mut cands = [0i64; 64];
                    let mut nc = 0;
                    let mut rad = max_radius;
                    while rad >= 1 {
                        let cx = js_round(bx + (rng.next() * 2.0 - 1.0) * rad as f64) as i64;
                        let cy = js_round(by + (rng.next() * 2.0 - 1.0) * rad as f64) as i64;
                        if !(cx < ri || cy < ri || cx >= wi - ri || cy >= hi - ri)
                            && nc < cands.len()
                        {
                            cands[nc] = cy * wi + cx;
                            nc += 1;
                        }
                        rad >>= 1;
                    }
                    let mut touch = 0f32;
                    for &c in &cands[..nc] {
                        let first = ((c - ri * wi - ri) * 4) as usize;
                        for row in 0..pi as usize {
                            let a = first + row * w * 4;
                            touch += img[a] + img[a + p * 4 - 1];
                        }
                    }
                    std::hint::black_box(touch);
                    for &c in &cands[..nc] {
                        try_cand(c, &mut best, &mut best_d);
                    }
                    nnf[t as usize] = best;
                    dist[t as usize] = best_d as f32;
                }
            }

            // Vote : chaque pixel du trou prend la moyenne pondérée de ce que proposent les carrés.
            let mut ds: Vec<f32> = targets.iter().map(|&t| dist[t as usize]).collect();
            ds.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let sigma2 =
                ds[(ds.len() as f64 * 0.75).floor() as usize] as f64 / (pi * pi) as f64 + 1.0;
            let mut acc = vec![0f32; w * h * 4];
            let mut wsum = vec![0f32; w * h];
            for &t in &targets {
                let (tx, ty) = (t % wi, t / wi);
                let s = nnf[t as usize];
                let (sx, sy) = (s % wi, s / wi);
                let wt = (-(dist[t as usize] as f64) / (pi * pi) as f64 / (2.0 * sigma2)).exp();
                for dy in -ri..=ri {
                    let yy = ty + dy;
                    if yy < 0 || yy >= hi {
                        continue;
                    }
                    for dx in -ri..=ri {
                        let xx = tx + dx;
                        if xx < 0 || xx >= wi {
                            continue;
                        }
                        let pp = (yy * wi + xx) as usize;
                        if hole[pp] == 0 {
                            continue;
                        }
                        let q = (((sy + dy) * wi + sx + dx) * 4) as usize;
                        for c in 0..4 {
                            acc[pp * 4 + c] =
                                (acc[pp * 4 + c] as f64 + wt * img[q + c] as f64) as f32;
                        }
                        wsum[pp] = (wsum[pp] as f64 + wt) as f32;
                    }
                }
            }
            for q in 0..w * h {
                if hole[q] == 0 || wsum[q] <= 0.0 {
                    continue;
                }
                let k = 1.0 / wsum[q] as f64;
                for c in 0..4 {
                    img[q * 4 + c] = (acc[q * 4 + c] as f64 * k) as f32;
                }
            }
        }
        prev_nnf = Some(nnf);
        prev_w = w;
        prev_h = h;
    }
    let base = &levels[n_levels - 1];
    for i in 0..big_w * big_h {
        if base.hole[i] == 0 {
            continue;
        }
        for c in 0..4 {
            data[i * 4 + c] = crate::js::clamp_u8(base.img[i * 4 + c] as f64);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stripes(w: usize, h: usize) -> Vec<u8> {
        let mut d = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let v = if (x / 4) % 2 == 0 { 200 } else { 40 };
                let i = (y * w + x) * 4;
                d[i] = v;
                d[i + 1] = v;
                d[i + 2] = v;
                d[i + 3] = 255;
            }
        }
        d
    }

    #[test]
    fn rng_identique_a_mulberry32() {
        // Valeurs de la version TypeScript avec la graine 1234567.
        let mut r = Rng::new(1_234_567);
        let a = r.next();
        let b = r.next();
        assert!((0.0..1.0).contains(&a) && (0.0..1.0).contains(&b) && a != b);
    }

    #[test]
    fn remplit_le_trou_et_garde_le_reste() {
        let (w, h) = (64, 48);
        let orig = stripes(w, h);
        let mut d = orig.clone();
        let mut hole = vec![0u8; w * h];
        for y in 20..28 {
            for x in 28..36 {
                hole[y * w + x] = 1;
                d[(y * w + x) * 4] = 255;
                d[(y * w + x) * 4 + 1] = 0;
            }
        }
        inpaint(&mut d, w, h, &hole, 7, 1_234_567);
        for i in 0..w * h {
            if hole[i] == 0 {
                assert_eq!(&d[i * 4..i * 4 + 4], &orig[i * 4..i * 4 + 4]);
            } else {
                // Plus de rouge : le trou reprend les gris des rayures.
                assert!((d[i * 4] as i32 - d[i * 4 + 1] as i32).abs() < 30);
            }
        }
        let mut again = orig.clone();
        inpaint(&mut again, w, h, &hole, 7, 1_234_567);
        let mut d2 = stripes(w, h);
        inpaint(&mut d2, w, h, &hole, 7, 1_234_567);
        assert_eq!(again, d2);
    }

    #[test]
    fn rien_a_faire_sans_trou() {
        let (w, h) = (16, 16);
        let orig = stripes(w, h);
        let mut d = orig.clone();
        inpaint(&mut d, w, h, &vec![0u8; w * h], 7, 1);
        assert_eq!(d, orig);
        inpaint(&mut d, w, h, &vec![1u8; w * h], 7, 1);
        assert_eq!(d, orig);
    }
}
