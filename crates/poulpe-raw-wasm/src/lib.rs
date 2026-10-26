//! Développement des photos RAW, compilé en WebAssembly sans outil de liaison (comme
//! poulpe-engine-wasm). L'interface (packages/engine/src/raw.ts) réserve de la mémoire avec
//! `alloc`, y copie le fichier, appelle `decode`, puis `render` autant de fois que l'utilisateur
//! bouge un curseur : le RAW n'est lu et dématricé qu'une fois.
//!
//! La lecture des formats RAW vient de rawloader (LGPL-2.1).

pub mod develop;

use develop::{Develop, Linear};
use std::cell::RefCell;

thread_local! {
    static IMAGE: RefCell<Option<Linear>> = const { RefCell::new(None) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

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

/// Lit et dématrice un fichier RAW. Renvoie 0 si tout va bien, 1 si le format n'est pas reconnu.
///
/// # Safety
/// La zone doit avoir été réservée par `alloc` avec au moins `len` octets.
#[no_mangle]
pub unsafe extern "C" fn decode(ptr: *const u8, len: usize) -> u32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let image = develop::decode(bytes);
    let ok = image.is_some();
    IMAGE.with(|i| *i.borrow_mut() = image);
    if ok {
        0
    } else {
        1
    }
}

/// Largeur de la photo lue (après rotation), 0 sans photo.
#[no_mangle]
pub extern "C" fn width() -> u32 {
    IMAGE.with(|i| i.borrow().as_ref().map_or(0, |l| l.out_size().0 as u32))
}

/// Hauteur de la photo lue (après rotation), 0 sans photo.
#[no_mangle]
pub extern "C" fn height() -> u32 {
    IMAGE.with(|i| i.borrow().as_ref().map_or(0, |l| l.out_size().1 as u32))
}

/// Développe la photo avec les réglages (JSON), réduite pour tenir dans `max_side` pixels (0 :
/// taille réelle). Renvoie l'adresse des pixels RGBA ; leur taille se lit avec `out_width` et
/// `out_height`. 0 en cas d'erreur.
///
/// # Safety
/// La zone du JSON doit avoir été réservée par `alloc` avec au moins `json_len` octets.
#[no_mangle]
pub unsafe extern "C" fn render(json: *const u8, json_len: usize, max_side: u32) -> *const u8 {
    let text = std::slice::from_raw_parts(json, json_len);
    let Ok(params) = serde_json::from_slice::<Develop>(text) else {
        return std::ptr::null();
    };
    IMAGE.with(|i| {
        let img = i.borrow();
        let Some(l) = img.as_ref() else {
            return std::ptr::null();
        };
        let (w, h, px) = l.render(&params, max_side as usize);
        OUT_SIZE.with(|s| s.set((w as u32, h as u32)));
        OUTPUT.with(|o| {
            *o.borrow_mut() = px;
            o.borrow().as_ptr()
        })
    })
}

thread_local! {
    static OUT_SIZE: std::cell::Cell<(u32, u32)> = const { std::cell::Cell::new((0, 0)) };
}

/// Largeur de la dernière image développée.
#[no_mangle]
pub extern "C" fn out_width() -> u32 {
    OUT_SIZE.with(|s| s.get().0)
}

/// Hauteur de la dernière image développée.
#[no_mangle]
pub extern "C" fn out_height() -> u32 {
    OUT_SIZE.with(|s| s.get().1)
}

/// Oublie la photo et les pixels développés (libère la mémoire).
#[no_mangle]
pub extern "C" fn clear() {
    IMAGE.with(|i| *i.borrow_mut() = None);
    OUTPUT.with(|o| *o.borrow_mut() = Vec::new());
}
