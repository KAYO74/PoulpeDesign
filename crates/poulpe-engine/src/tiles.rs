//! Découpage des grandes images en tuiles, et cache des tuiles déjà calculées.
//!
//! Une photo de plusieurs centaines de Mo ne tient ni dans une texture de carte graphique (16 384
//! pixels de côté au plus, souvent 8 192) ni dans la mémoire qu'on veut lui laisser. Elle est donc
//! traitée par morceaux : chaque tuile est lue avec une marge (les pixels voisins dont un flou a
//! besoin), calculée, puis seule sa partie centrale est recopiée.

use std::collections::HashMap;

/// Rectangle en pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Rect {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}

/// Une tuile : la zone lue (avec la marge) et la zone écrite.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tile {
    pub read: Rect,
    pub write: Rect,
}

/// Côté de tuile (multiple de 256) pour que `bytes_per_pixel` × tuile tienne dans `budget` octets,
/// borné par la taille maximale de texture.
pub fn tile_side(budget: u64, bytes_per_pixel: u64, max_side: usize) -> usize {
    let px = (budget / bytes_per_pixel.max(1)).max(256 * 256);
    let side = ((px as f64).sqrt() as usize / 256 * 256).max(256);
    side.min(max_side.max(256))
}

/// Découpe une image `w` × `h` en tuiles de `side` pixels (zone écrite), lues avec `halo` pixels
/// de marge de chaque côté (bornée par l'image).
pub fn plan(w: usize, h: usize, side: usize, halo: usize) -> Vec<Tile> {
    let side = side.max(1);
    let mut tiles = Vec::new();
    let mut y = 0;
    while y < h {
        let th = side.min(h - y);
        let mut x = 0;
        while x < w {
            let tw = side.min(w - x);
            let rx = x.saturating_sub(halo);
            let ry = y.saturating_sub(halo);
            let rx1 = (x + tw + halo).min(w);
            let ry1 = (y + th + halo).min(h);
            tiles.push(Tile {
                read: Rect {
                    x: rx,
                    y: ry,
                    w: rx1 - rx,
                    h: ry1 - ry,
                },
                write: Rect { x, y, w: tw, h: th },
            });
            x += tw;
        }
        y += th;
    }
    tiles
}

/// Copie la zone `r` d'une image RGBA de largeur `w`.
pub fn extract(data: &[u8], w: usize, r: Rect) -> Vec<u8> {
    let mut out = Vec::with_capacity(r.w * r.h * 4);
    for y in r.y..r.y + r.h {
        let s = (y * w + r.x) * 4;
        out.extend_from_slice(&data[s..s + r.w * 4]);
    }
    out
}

/// Recopie la partie `t.write` d'une tuile calculée (de la taille de `t.read`) dans l'image.
pub fn put(data: &mut [u8], w: usize, tile: &[u8], t: &Tile) {
    let dx = t.write.x - t.read.x;
    let dy = t.write.y - t.read.y;
    for row in 0..t.write.h {
        let s = ((dy + row) * t.read.w + dx) * 4;
        let d = ((t.write.y + row) * w + t.write.x) * 4;
        data[d..d + t.write.w * 4].copy_from_slice(&tile[s..s + t.write.w * 4]);
    }
}

/// Cache des tuiles calculées, limité en mémoire : les moins récemment utilisées partent d'abord.
pub struct TileCache<K> {
    budget: usize,
    used: usize,
    clock: u64,
    entries: HashMap<K, (Vec<u8>, u64)>,
    pub hits: u64,
    pub misses: u64,
}

impl<K: std::hash::Hash + Eq + Clone> TileCache<K> {
    pub fn new(budget_bytes: usize) -> Self {
        TileCache {
            budget: budget_bytes,
            used: 0,
            clock: 0,
            entries: HashMap::new(),
            hits: 0,
            misses: 0,
        }
    }

    pub fn set_budget(&mut self, budget_bytes: usize) {
        self.budget = budget_bytes;
        self.evict();
    }

    pub fn used_bytes(&self) -> usize {
        self.used
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get(&mut self, key: &K) -> Option<&[u8]> {
        self.clock += 1;
        let clock = self.clock;
        match self.entries.get_mut(key) {
            Some(e) => {
                e.1 = clock;
                self.hits += 1;
                Some(&e.0)
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    pub fn insert(&mut self, key: K, value: Vec<u8>) {
        if value.len() > self.budget {
            return;
        }
        self.clock += 1;
        self.used += value.len();
        if let Some(old) = self.entries.insert(key, (value, self.clock)) {
            self.used -= old.0.len();
        }
        self.evict();
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.used = 0;
    }

    fn evict(&mut self) {
        while self.used > self.budget {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, v)| v.1)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some((v, _)) = self.entries.remove(&oldest) {
                self.used -= v.len();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_tuiles_couvrent_l_image_une_seule_fois() {
        let (w, h) = (1000, 700);
        let tiles = plan(w, h, 256, 10);
        let mut seen = vec![0u8; w * h];
        for t in &tiles {
            assert!(t.read.x <= t.write.x && t.read.x + t.read.w >= t.write.x + t.write.w);
            for y in t.write.y..t.write.y + t.write.h {
                for x in t.write.x..t.write.x + t.write.w {
                    seen[y * w + x] += 1;
                }
            }
        }
        assert!(seen.iter().all(|v| *v == 1));
        assert_eq!(tiles.len(), 4 * 3);
    }

    #[test]
    fn extraire_puis_remettre() {
        let (w, h) = (300, 200);
        let data: Vec<u8> = (0..w * h * 4).map(|i| (i % 251) as u8).collect();
        let mut out = vec![0u8; data.len()];
        for t in plan(w, h, 128, 7) {
            put(&mut out, w, &extract(&data, w, t.read), &t);
        }
        assert_eq!(out, data);
    }

    #[test]
    fn taille_de_tuile_selon_la_memoire() {
        assert_eq!(tile_side(256 << 20, 16, 8192), 4096);
        assert_eq!(tile_side(4 << 30, 4, 8192), 8192);
        assert_eq!(tile_side(1, 4, 8192), 256);
    }

    #[test]
    fn le_cache_respecte_sa_limite() {
        let mut c = TileCache::new(100);
        c.insert(1, vec![0; 40]);
        c.insert(2, vec![0; 40]);
        assert!(c.get(&1).is_some());
        c.insert(3, vec![0; 40]);
        assert!(c.get(&2).is_none(), "la moins récemment utilisée part");
        assert!(c.get(&1).is_some() && c.get(&3).is_some());
        assert!(c.used_bytes() <= 100);
        c.insert(4, vec![0; 1000]);
        assert!(c.get(&4).is_none(), "trop grande pour le cache");
        c.set_budget(0);
        assert!(c.is_empty());
    }
}
