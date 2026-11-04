//! Interface WebAssembly du moteur, sans outil de liaison : l'interface (packages/engine) réserve
//! de la mémoire avec `alloc`, y copie les pixels et le réglage (JSON), puis appelle `apply`.

use poulpe_engine::adjust::{apply as apply_adjustment, Request};

/// Réserve `len` octets et renvoie leur adresse.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Libère une zone réservée par `alloc`.
///
/// # Safety
/// `ptr` et `len` doivent venir d'un appel à `alloc`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

/// Applique le réglage décrit en JSON (`{ adjustment, options }`) aux pixels RGBA, sur place.
/// Renvoie 0 si tout va bien, 1 si le JSON n'est pas compris, 2 si les tailles ne vont pas.
///
/// # Safety
/// Les deux zones doivent avoir été réservées par `alloc` avec au moins ces longueurs.
#[no_mangle]
pub unsafe extern "C" fn apply(
    px: *mut u8,
    len: usize,
    w: usize,
    h: usize,
    json: *const u8,
    json_len: usize,
) -> u32 {
    if w.checked_mul(h).and_then(|n| n.checked_mul(4)) != Some(len) {
        return 2;
    }
    let text = std::slice::from_raw_parts(json, json_len);
    let Ok(req) = serde_json::from_slice::<Request>(text) else {
        return 1;
    };
    let data = std::slice::from_raw_parts_mut(px, len);
    apply_adjustment(data, w, h, &req.adjustment, &req.options);
    0
}

/// Version du moteur (1.5.0 → 10500).
#[no_mangle]
pub extern "C" fn version() -> u32 {
    10500
}

/// Floute les pixels RGBA sur place (flou gaussien approché, écart type `sigma` en pixels).
///
/// # Safety
/// La zone doit avoir été réservée par `alloc` avec au moins `len` octets.
#[no_mangle]
pub unsafe extern "C" fn blur(px: *mut u8, len: usize, w: usize, h: usize, sigma: f64) -> u32 {
    if w.checked_mul(h).and_then(|n| n.checked_mul(4)) != Some(len) {
        return 2;
    }
    let data = std::slice::from_raw_parts_mut(px, len);
    let out = poulpe_engine::blur::gaussian_blurred(data, w, h, sigma);
    data.copy_from_slice(&out);
    0
}

/// Correcteur : écrit dans `dest` la texture de `src` avec la lumière de `dest` (voir
/// `poulpe_engine::retouch::heal_blend`).
///
/// # Safety
/// Les deux zones doivent avoir été réservées par `alloc` avec au moins `len` octets.
#[no_mangle]
pub unsafe extern "C" fn heal(
    dest: *mut u8,
    src: *const u8,
    len: usize,
    w: usize,
    h: usize,
    sigma: f64,
) -> u32 {
    if w.checked_mul(h).and_then(|n| n.checked_mul(4)) != Some(len) {
        return 2;
    }
    let d = std::slice::from_raw_parts_mut(dest, len);
    let s = std::slice::from_raw_parts(src, len);
    let out = poulpe_engine::retouch::heal_blend(d, s, w, h, sigma);
    d.copy_from_slice(&out);
    0
}

/// Remplissage d'après le contenu sur place (`px` RGBA, `hole` un octet par pixel).
/// 0 = fait, 2 = tailles incohérentes.
///
/// # Safety
/// `px` doit pointer sur `len` octets et `hole` sur `len / 4` octets, réservés par `alloc`.
#[no_mangle]
pub unsafe extern "C" fn inpaint(
    px: *mut u8,
    hole: *const u8,
    len: usize,
    w: usize,
    h: usize,
    patch: usize,
    seed: u32,
) -> u32 {
    if w.checked_mul(h).and_then(|n| n.checked_mul(4)) != Some(len) {
        return 2;
    }
    let d = std::slice::from_raw_parts_mut(px, len);
    let m = std::slice::from_raw_parts(hole, len / 4);
    poulpe_engine::inpaint::inpaint(d, w, h, m, patch, seed);
    0
}

/// Épreuvage CMJN sur place (`lut` : `lut_len` nombres en 32 bits, table `grid`³ × 3).
/// 0 = fait, 2 = tailles incohérentes.
///
/// # Safety
/// `px` doit pointer sur `len` octets et `lut` sur `lut_len` × 4 octets, réservés par `alloc`.
#[no_mangle]
pub unsafe extern "C" fn proof(
    px: *mut u8,
    len: usize,
    lut: *const f32,
    lut_len: usize,
    grid: usize,
) -> u32 {
    if len % 4 != 0 || grid < 2 || lut_len != grid * grid * grid * 3 || (lut as usize) % 4 != 0 {
        return 2;
    }
    let d = std::slice::from_raw_parts_mut(px, len);
    let l = std::slice::from_raw_parts(lut, lut_len);
    poulpe_engine::cmyk::soft_proof(d, l, grid);
    0
}

/// Vectorisation : étiquette chaque pixel avec le centre le plus proche (`centers` : `n_centers`
/// nombres, `dim` par centre), écrit les étiquettes dans `labels` (`len / 4` entiers) et les
/// totaux des groupes dans `sums` (4 nombres par centre). 0 = fait, 2 = tailles incohérentes.
///
/// # Safety
/// Les zones doivent avoir été réservées par `alloc` avec les tailles indiquées.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn label(
    px: *const u8,
    len: usize,
    centers: *const f64,
    n_centers: usize,
    dim: usize,
    ignore_white: u32,
    labels: *mut i32,
    sums: *mut f64,
) -> u32 {
    if len % 4 != 0
        || !(dim == 1 || dim == 3)
        || n_centers % dim != 0
        || (centers as usize) % 8 != 0
        || (labels as usize) % 4 != 0
        || (sums as usize) % 8 != 0
    {
        return 2;
    }
    let d = std::slice::from_raw_parts(px, len);
    let c = std::slice::from_raw_parts(centers, n_centers);
    let l = std::slice::from_raw_parts_mut(labels, len / 4);
    let out = poulpe_engine::trace::label(d, c, dim, ignore_white != 0, l);
    let s = std::slice::from_raw_parts_mut(sums, out.len() * 4);
    for (j, g) in out.iter().enumerate() {
        s[j * 4..j * 4 + 4].copy_from_slice(g);
    }
    0
}

// ————— Fusion d'images (exposition, mise au point) —————
// État de la fusion en cours, gardé entre les appels pour que l'interface suive l'avancement.
thread_local! {
    static FUSION: std::cell::RefCell<Option<poulpe_engine::fusion::Fusion>> =
        const { std::cell::RefCell::new(None) };
    static FUSION_SIZE: std::cell::Cell<(usize, usize)> = const { std::cell::Cell::new((0, 0)) };
}

/// Commence une fusion de `w` × `h` pixels. `focus` = 1 pour la mise au point. 0 = fait, 2 = tailles
/// incohérentes.
#[no_mangle]
pub extern "C" fn fusion_begin(w: usize, h: usize, focus: u32, wc: f32, ws: f32, we: f32) -> u32 {
    if w == 0 || h == 0 || w.checked_mul(h).and_then(|n| n.checked_mul(4)).is_none() {
        return 2;
    }
    FUSION_SIZE.with(|s| s.set((w, h)));
    FUSION.with(|f| {
        *f.borrow_mut() = Some(poulpe_engine::fusion::Fusion::new(
            w,
            h,
            focus != 0,
            wc,
            ws,
            we,
        ))
    });
    0
}

/// Première passe : carte de poids d'une image. 0 = fait, 2 = tailles incohérentes ou pas de fusion.
///
/// # Safety
/// `px` doit pointer sur `len` octets réservés par `alloc`.
#[no_mangle]
pub unsafe extern "C" fn fusion_weight(px: *const u8, len: usize) -> u32 {
    let (w, h) = FUSION_SIZE.with(|s| s.get());
    if len != w * h * 4 {
        return 2;
    }
    let d = std::slice::from_raw_parts(px, len);
    FUSION.with(|f| match f.borrow_mut().as_mut() {
        Some(fu) => {
            fu.add_weight(d);
            0
        }
        None => 2,
    })
}

/// Fin de la première passe : les poids de chaque pixel sont ramenés à une somme de 1.
#[no_mangle]
pub extern "C" fn fusion_normalize() -> u32 {
    FUSION.with(|f| match f.borrow_mut().as_mut() {
        Some(fu) => {
            fu.normalize();
            0
        }
        None => 2,
    })
}

/// Seconde passe : mélange l'image `k` (les mêmes pixels, dans le même ordre qu'à la première passe).
///
/// # Safety
/// `px` doit pointer sur `len` octets réservés par `alloc`.
#[no_mangle]
pub unsafe extern "C" fn fusion_blend(k: usize, px: *const u8, len: usize) -> u32 {
    let (w, h) = FUSION_SIZE.with(|s| s.get());
    if len != w * h * 4 {
        return 2;
    }
    let d = std::slice::from_raw_parts(px, len);
    FUSION.with(|f| match f.borrow_mut().as_mut() {
        Some(fu) if fu.has_weight(k) => {
            fu.blend(k, d);
            0
        }
        _ => 2,
    })
}

/// Écrit l'image fusionnée (RGBA, `len` octets) et termine la fusion.
///
/// # Safety
/// `out` doit pointer sur `len` octets réservés par `alloc`.
#[no_mangle]
pub unsafe extern "C" fn fusion_finish(out: *mut u8, len: usize) -> u32 {
    let (w, h) = FUSION_SIZE.with(|s| s.get());
    if len != w * h * 4 {
        return 2;
    }
    let o = std::slice::from_raw_parts_mut(out, len);
    match FUSION.with(|f| f.borrow_mut().take()) {
        Some(fu) => {
            fu.finish(o);
            0
        }
        None => 2,
    }
}

/// Abandonne la fusion en cours (annulation) et libère sa mémoire.
#[no_mangle]
pub extern "C" fn fusion_reset() {
    FUSION.with(|f| *f.borrow_mut() = None);
}
