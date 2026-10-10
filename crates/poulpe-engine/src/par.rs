//! Boucles sur les pixels, réparties sur tous les cœurs quand la fonction `parallel` est activée
//! (appli de bureau), sur un seul fil sinon (WebAssembly dans le navigateur).

#[cfg(feature = "parallel")]
use rayon::prelude::*;

/// Pixels traités par bloc : assez pour que le partage entre cœurs ne coûte rien.
const BLOCK: usize = 16 * 1024;

/// Appelle `f` sur chaque pixel RGBA (4 octets).
pub fn each_pixel(data: &mut [u8], f: impl Fn(&mut [u8; 4]) + Sync + Send) {
    let run = |block: &mut [u8]| {
        for px in block.chunks_exact_mut(4) {
            // Taille connue : pas de vérification de bornes à chaque accès.
            f(px.try_into().unwrap());
        }
    };
    #[cfg(feature = "parallel")]
    data.par_chunks_mut(BLOCK * 4).for_each(run);
    #[cfg(not(feature = "parallel"))]
    run(data);
}

/// Appelle `f(y, ligne)` sur chaque ligne d'une image de largeur `stride` éléments.
pub fn each_row<T: Send>(data: &mut [T], stride: usize, f: impl Fn(usize, &mut [T]) + Sync + Send) {
    if stride == 0 {
        return;
    }
    #[cfg(feature = "parallel")]
    data.par_chunks_mut(stride)
        .enumerate()
        .for_each(|(y, row)| f(y, row));
    #[cfg(not(feature = "parallel"))]
    data.chunks_mut(stride)
        .enumerate()
        .for_each(|(y, row)| f(y, row));
}

/// Appelle `f(i, bloc)` sur des blocs consécutifs de `n` pixels, avec l'indice du premier pixel.
pub fn each_block(data: &mut [u8], f: impl Fn(usize, &mut [u8]) + Sync + Send) {
    #[cfg(feature = "parallel")]
    data.par_chunks_mut(BLOCK * 4)
        .enumerate()
        .for_each(|(b, block)| f(b * BLOCK, block));
    #[cfg(not(feature = "parallel"))]
    data.chunks_mut(BLOCK * 4)
        .enumerate()
        .for_each(|(b, block)| f(b * BLOCK, block));
}
