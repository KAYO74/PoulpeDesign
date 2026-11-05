//! Lecture des photos HEIC/HEIF, compilée en WebAssembly sans outil de liaison (comme
//! poulpe-raw-wasm). L'interface (packages/engine/src/heic.ts) réserve de la mémoire avec `alloc`,
//! y copie le fichier, appelle `decode`, lit les pixels (RGBA 8 bits, en sRGB) puis appelle `clear`.
//!
//! Le décodage vient de heifer (Rust pur, sans code C ni `unsafe`, MIT ou Apache-2.0). Le HEIC
//! repose sur le codec vidéo HEVC, couvert par des brevets que la licence du code ne règle pas.

use std::cell::RefCell;

/// Plus grande photo lue (pixels) : au-delà, la mémoire du navigateur ne suffit plus.
const MAX_PIXELS: u64 = 100_000_000;

/// Codes de retour de `decode`.
const OK: u32 = 0;
const UNREADABLE: u32 = 1;
const TOO_BIG: u32 = 2;
const UNSUPPORTED: u32 = 3;

struct Decoded {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

thread_local! {
    static IMAGE: RefCell<Option<Decoded>> = const { RefCell::new(None) };
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

/// Décode des octets HEIC/HEIF en RGBA 8 bits (sRGB, rotation et recadrage appliqués).
pub fn decode_bytes(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), u32> {
    let options = heifer::Options {
        // Pas de fils d'exécution en WebAssembly.
        max_threads: 1,
        max_pixels: MAX_PIXELS,
    };
    let image = match heifer::decode_srgb_rgba8(bytes, &options) {
        Ok(img) => img,
        // Fichier HDR (PQ, HLG) ou profil de couleur inconnu : on garde les valeurs du fichier.
        Err(heifer::Error::Unsupported(_)) => {
            heifer::decode_rgba8(bytes, &options).map_err(|e| code_of(&e))?
        }
        Err(e) => return Err(code_of(&e)),
    };
    Ok((image.width, image.height, image.data))
}

fn code_of(e: &heifer::Error) -> u32 {
    let text = format!("{e:?}");
    if text.contains("TooLarge") || text.contains("max_pixels") || text.contains("limit") {
        TOO_BIG
    } else if text.contains("Unsupported") {
        UNSUPPORTED
    } else {
        UNREADABLE
    }
}

/// Lit une photo HEIC/HEIF. Renvoie 0 si tout va bien, 1 si le fichier est illisible ou abîmé, 2 si
/// la photo est trop grande, 3 si le format n'est pas pris en charge.
///
/// # Safety
/// La zone doit avoir été réservée par `alloc` avec au moins `len` octets.
#[no_mangle]
pub unsafe extern "C" fn decode(ptr: *const u8, len: usize) -> u32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    match decode_bytes(bytes) {
        Ok((width, height, rgba)) => {
            IMAGE.with(|i| {
                *i.borrow_mut() = Some(Decoded {
                    width,
                    height,
                    rgba,
                })
            });
            OK
        }
        Err(code) => {
            IMAGE.with(|i| *i.borrow_mut() = None);
            code
        }
    }
}

/// Largeur de la photo lue, 0 sans photo.
#[no_mangle]
pub extern "C" fn width() -> u32 {
    IMAGE.with(|i| i.borrow().as_ref().map_or(0, |d| d.width))
}

/// Hauteur de la photo lue, 0 sans photo.
#[no_mangle]
pub extern "C" fn height() -> u32 {
    IMAGE.with(|i| i.borrow().as_ref().map_or(0, |d| d.height))
}

/// Adresse des pixels RGBA (largeur × hauteur × 4 octets), 0 sans photo. Valable jusqu'au prochain
/// appel de `decode` ou de `clear`.
#[no_mangle]
pub extern "C" fn pixels() -> *const u8 {
    IMAGE.with(|i| {
        i.borrow()
            .as_ref()
            .map_or(std::ptr::null(), |d| d.rgba.as_ptr())
    })
}

/// Libère la photo lue.
#[no_mangle]
pub extern "C" fn clear() {
    IMAGE.with(|i| *i.borrow_mut() = None);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_fichier_qui_n_est_pas_du_heic_est_illisible() {
        assert_eq!(
            decode_bytes(b"pas une image du tout").unwrap_err(),
            UNREADABLE
        );
        assert_eq!(decode_bytes(&[]).unwrap_err(), UNREADABLE);
    }

    #[test]
    fn un_fichier_tronque_ne_fait_pas_planter() {
        let mut v = vec![0, 0, 0, 24];
        v.extend_from_slice(b"ftypheic");
        v.extend_from_slice(&[0; 12]);
        assert!(decode_bytes(&v).is_err());
    }

    #[test]
    fn aller_retour_avec_l_encodeur_de_heifer() {
        let (w, h) = (48usize, 32usize);
        let mut rgba = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                rgba[i] = (x * 255 / w) as u8;
                rgba[i + 1] = (y * 255 / h) as u8;
                rgba[i + 2] = 90;
            }
        }
        let heic = heifer::encode_rgba8(
            w as u32,
            h as u32,
            &rgba,
            &heifer::EncodeOptions {
                quality: 90,
                ..Default::default()
            },
        )
        .unwrap();
        let (ow, oh, out) = decode_bytes(&heic).unwrap();
        assert_eq!((ow as usize, oh as usize), (w, h));
        assert_eq!(out.len(), w * h * 4);
        // Compression avec pertes : les couleurs restent proches.
        let mut worst = 0i32;
        for i in 0..w * h {
            for c in 0..3 {
                worst = worst.max((out[i * 4 + c] as i32 - rgba[i * 4 + c] as i32).abs());
            }
        }
        assert!(worst < 24, "écart {worst}");
    }
}
