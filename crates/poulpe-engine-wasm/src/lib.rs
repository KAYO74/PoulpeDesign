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

/// Version du moteur (1.1.1 → 10101).
#[no_mangle]
pub extern "C" fn version() -> u32 {
    10101
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
