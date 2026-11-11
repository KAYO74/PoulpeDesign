//! Recherche des coutures du « seam carving » (échelle selon le contenu).
//!
//! Même calcul, dans le même ordre, que `findSeams` dans packages/core/src/seamCarve.ts : l'énergie
//! et les coûts sont des nombres de 32 bits arrondis aux mêmes endroits, donc les coutures trouvées
//! sont identiques à celles du TypeScript.

/// Le plus petit de deux coûts. Les coûts sont des nombres positifs ou nuls (jamais NaN) : leur
/// ordre est celui de leurs bits, et le minimum entier se fait sans branche. `f32::min` serait un
/// appel de fonction en WebAssembly, et un `if` y rate une fois sur deux (3 à 10 fois plus lent).
#[inline(always)]
fn lower(a: f32, b: f32) -> f32 {
    f32::from_bits(a.to_bits().min(b.to_bits()))
}

/// Coût ajouté sous une zone protégée.
const PROTECT_COST: f64 = 1e6;

/// Image en cours de rétrécissement, colonne après colonne.
pub struct Carver {
    /// Largeur d'origine (pas d'une ligne) et hauteur.
    full_w: usize,
    h: usize,
    /// Largeur courante.
    w: usize,
    /// Opacité de chaque pixel courant.
    alpha: Vec<u8>,
    prot: Option<Vec<u8>>,
    luma: Vec<f32>,
    energy: Vec<f32>,
    cost: Vec<f32>,
    /// Colonne d'origine de chaque pixel courant.
    col: Vec<i32>,
}

impl Carver {
    /// `data` : pixels RGBA ; `protect` : un octet par pixel (non nul = zone à protéger).
    pub fn new(data: &[u8], w: usize, h: usize, protect: Option<&[u8]>) -> Option<Self> {
        if w == 0 || h == 0 || data.len() != w * h * 4 || protect.is_some_and(|p| p.len() != w * h)
        {
            return None;
        }
        let luma = (0..w * h)
            .map(|i| {
                let p = &data[i * 4..i * 4 + 4];
                ((0.2126 * p[0] as f64 + 0.7152 * p[1] as f64 + 0.0722 * p[2] as f64)
                    * (p[3] as f64 / 255.0)) as f32
            })
            .collect();
        let mut c = Carver {
            full_w: w,
            h,
            w,
            alpha: data.chunks_exact(4).map(|p| p[3]).collect(),
            prot: protect.map(|p| p.to_vec()),
            luma,
            energy: vec![0.0; w * h],
            cost: vec![0.0; w * h],
            col: (0..w * h).map(|i| (i % w) as i32).collect(),
        };
        for y in 0..h {
            for x in 0..w {
                c.energy[y * w + x] = c.energy_at(x, y);
            }
        }
        Some(c)
    }

    /// Largeur restante.
    pub fn width(&self) -> usize {
        self.w
    }

    fn alpha(&self, i: usize) -> f64 {
        self.alpha[i] as f64
    }

    fn energy_at(&self, x: usize, y: usize) -> f32 {
        let (fw, h, w) = (self.full_w, self.h, self.w);
        let r = y * fw;
        let xl = if x > 0 { x - 1 } else { x };
        let xr = if x < w - 1 { x + 1 } else { x };
        let yu = if y > 0 { y - 1 } else { y };
        let yd = if y < h - 1 { y + 1 } else { y };
        let l = &self.luma;
        let mut e = (l[r + xr] as f64 - l[r + xl] as f64).abs()
            + (l[yd * fw + x] as f64 - l[yu * fw + x] as f64).abs()
            + 0.5 * (self.alpha(r + xr) - self.alpha(r + xl)).abs()
            + 0.5 * (self.alpha(yd * fw + x) - self.alpha(yu * fw + x)).abs();
        if self.prot.as_ref().is_some_and(|p| p[r + x] != 0) {
            e += PROTECT_COST;
        }
        e as f32
    }

    /// Trouve et retire la prochaine couture ; écrit, pour chaque ligne, sa colonne d'origine.
    fn next_seam(&mut self, out: &mut [i32]) {
        let (fw, h, w) = (self.full_w, self.h, self.w);
        let (e, m) = (&self.energy, &mut self.cost);
        m[..w].copy_from_slice(&e[..w]);
        for y in 1..h {
            let (r, p) = (y * fw, (y - 1) * fw);
            let (before, after) = m.split_at_mut(r);
            let prev = &before[p..p + w];
            let cur = &mut after[..w];
            let erow = &e[r..r + w];
            // Bords : un seul voisin de moins.
            cur[0] = erow[0]
                + if w > 1 {
                    lower(prev[0], prev[1])
                } else {
                    prev[0]
                };
            if w > 1 {
                cur[w - 1] = erow[w - 1] + lower(prev[w - 1], prev[w - 2]);
            }
            if w > 2 {
                for ((c, &e), p) in cur[1..w - 1]
                    .iter_mut()
                    .zip(&erow[1..w - 1])
                    .zip(prev.windows(3))
                {
                    *c = e + lower(lower(p[0], p[1]), p[2]);
                }
            }
        }
        let mut pos = vec![0usize; h];
        let mut best = 0;
        let last = (h - 1) * fw;
        for x in 1..w {
            if m[last + x] < m[last + best] {
                best = x;
            }
        }
        pos[h - 1] = best;
        for y in (1..h).rev() {
            let p = (y - 1) * fw;
            let x = pos[y];
            let mut bx = x;
            if x > 0 && m[p + x - 1] < m[p + bx] {
                bx = x - 1;
            }
            if x < w - 1 && m[p + x + 1] < m[p + bx] {
                bx = x + 1;
            }
            pos[y - 1] = bx;
        }
        for y in 0..h {
            out[y] = self.col[y * fw + pos[y]];
        }
        // Retrait de la couture.
        for (y, &s) in pos.iter().enumerate() {
            let r = y * fw;
            if w - 1 > s {
                self.alpha.copy_within(r + s + 1..r + w, r + s);
                self.luma.copy_within(r + s + 1..r + w, r + s);
                self.energy.copy_within(r + s + 1..r + w, r + s);
                self.col.copy_within(r + s + 1..r + w, r + s);
                if let Some(p) = self.prot.as_mut() {
                    p.copy_within(r + s + 1..r + w, r + s);
                }
            }
        }
        self.w -= 1;
        // Énergie : seulement près de la couture.
        for (y, &s) in pos.iter().enumerate() {
            let lo = s.saturating_sub(3);
            let hi = (s + 3).min(self.w - 1);
            for x in lo..=hi {
                self.energy[y * fw + x] = self.energy_at(x, y);
            }
        }
    }

    /// Trouve `count` coutures de plus. `out` : `count × h` colonnes, une couture après l'autre.
    /// Renvoie le nombre de coutures trouvées (moins que demandé s'il ne reste qu'une colonne).
    pub fn seams(&mut self, count: usize, out: &mut [i32]) -> usize {
        let mut n = 0;
        while n < count && self.w > 1 && out.len() >= (n + 1) * self.h {
            let h = self.h;
            self.next_seam(&mut out[n * h..(n + 1) * h]);
            n += 1;
        }
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_couture_evite_le_bloc_detaille() {
        // Fond uni avec un bloc très texturé (colonnes 8 à 15) : aucune couture n'y passe.
        let (w, h) = (24, 16);
        let mut d = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let v = if (8..16).contains(&x) {
                    ((x * 97 + y * 53) % 251) as u8
                } else {
                    120
                };
                d[(y * w + x) * 4..(y * w + x) * 4 + 4].copy_from_slice(&[v, v, v, 255]);
            }
        }
        let mut c = Carver::new(&d, w, h, None).unwrap();
        let mut out = vec![0i32; 6 * h];
        assert_eq!(c.seams(6, &mut out), 6);
        assert_eq!(c.width(), w - 6);
        assert!(out.iter().all(|&x| !(8..16).contains(&x)));
    }
}
