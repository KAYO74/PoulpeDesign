//! Arithmétique identique à celle de JavaScript, pour que le moteur Rust donne exactement les mêmes
//! pixels que l'ancien code TypeScript (la version navigateur et l'appli de bureau doivent afficher
//! la même image).

/// Écriture dans un `Uint8ClampedArray` : bornée à 0..255, arrondie au plus proche, les moitiés
/// vers le nombre pair (règle ToUint8Clamp de JavaScript), NaN donne 0.
#[inline(always)]
pub fn clamp_u8(x: f64) -> u8 {
    if !(x > 0.0) {
        0
    } else if x >= 255.0 {
        255
    } else {
        // Une seule instruction (`f64.nearest` en WebAssembly, `roundsd` sur x86).
        x.round_ties_even() as u8
    }
}

/// Reste de la division par 1 (`t % 1` de JavaScript), sans appel à `fmod` pour t ≥ 0.
#[inline(always)]
pub fn frac(t: f64) -> f64 {
    if t >= 0.0 {
        t - t.floor()
    } else {
        t % 1.0
    }
}

/// `Math.max` / `Math.min` de trois nombres (sans NaN), en simples comparaisons.
#[inline(always)]
pub fn max3(a: f64, b: f64, c: f64) -> f64 {
    let m = if a > b { a } else { b };
    if m > c {
        m
    } else {
        c
    }
}

#[inline(always)]
pub fn min3(a: f64, b: f64, c: f64) -> f64 {
    let m = if a < b { a } else { b };
    if m < c {
        m
    } else {
        c
    }
}

/// `Math.round` : les moitiés vers le haut.
#[inline(always)]
pub fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}

#[inline(always)]
pub fn clamp01(v: f64) -> f64 {
    if v < 0.0 {
        0.0
    } else if v > 1.0 {
        1.0
    } else {
        v
    }
}

/// Luminance perçue (Rec. 709) d'une couleur 0..255.
#[inline(always)]
pub fn luma(r: f64, g: f64, b: f64) -> f64 {
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arrondit_comme_uint8clampedarray() {
        assert_eq!(clamp_u8(f64::NAN), 0);
        assert_eq!(clamp_u8(-3.0), 0);
        assert_eq!(clamp_u8(300.0), 255);
        assert_eq!(clamp_u8(0.5), 0);
        assert_eq!(clamp_u8(1.5), 2);
        assert_eq!(clamp_u8(2.5), 2);
        assert_eq!(clamp_u8(2.5000001), 3);
        assert_eq!(clamp_u8(254.6), 255);
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
    }
}
