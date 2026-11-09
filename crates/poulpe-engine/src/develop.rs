//! Réglage « Développer » (balance des blancs, tons, présence, couleur par plage de teintes).
//! Portage exact de `applyDevelop` (packages/core/src/develop.ts) : mêmes formules, mêmes arrondis,
//! chaque étape relisant les octets de l'étape précédente comme le fait le code TypeScript.

use crate::js::{clamp01, clamp_u8, round};
use crate::par::each_pixel;

/// Teinte centrale de chaque plage (rouge, orange, jaune, vert, aqua, bleu, violet, magenta).
const CENTERS: [f64; 8] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 275.0, 320.0];

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(default)]
pub struct Develop {
    pub temperature: f64,
    pub tint: f64,
    pub exposure: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub whites: f64,
    pub blacks: f64,
    pub vibrance: f64,
    pub saturation: f64,
    pub hue: Vec<f64>,
    pub sat: Vec<f64>,
    pub lum: Vec<f64>,
}

/// Huit valeurs par tableau : les manquantes valent 0 (fichier incomplet).
fn bands(v: &[f64]) -> [f64; 8] {
    let mut out = [0.0; 8];
    for (o, x) in out.iter_mut().zip(v) {
        if x.is_finite() {
            *o = *x;
        }
    }
    out
}

fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let t = clamp01((v - a) / (b - a));
    t * t * (3.0 - 2.0 * t)
}

fn to_linear(v: f64) -> f64 {
    let c = v / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn to_srgb(l: f64) -> f64 {
    255.0
        * (if l <= 0.0031308 {
            l * 12.92
        } else {
            1.055 * l.powf(1.0 / 2.4) - 0.055
        })
}

fn band_value(vals: &[f64; 8], hue_deg: f64) -> f64 {
    let mut a = 7;
    for (i, c) in CENTERS.iter().enumerate() {
        if *c <= hue_deg {
            a = i;
        }
    }
    let b = (a + 1) % 8;
    let ca = CENTERS[a];
    let cb = CENTERS[b] + if b == 0 { 360.0 } else { 0.0 };
    let h = if hue_deg < ca {
        hue_deg + 360.0
    } else {
        hue_deg
    };
    let t = (h - ca) / (cb - ca);
    vals[a] + (vals[b] - vals[a]) * t
}

/// Courbe de tons appliquée à la luminance (0..1 → 0..1), arrondie sur 32 bits.
fn tone_curve(a: &Develop) -> [f32; 256] {
    let c = a.contrast / 100.0;
    let mut t = [0.0f32; 256];
    for (i, o) in t.iter_mut().enumerate() {
        let v = i as f64 / 255.0;
        let mut x = v + c * (v * v * (3.0 - 2.0 * v) - v);
        x += 0.3
            * ((a.shadows / 100.0) * (1.0 - smooth(0.0, 0.65, v))
                + (a.highlights / 100.0) * smooth(0.35, 1.0, v)
                + (a.blacks / 100.0) * (1.0 - smooth(0.0, 0.3, v))
                + (a.whites / 100.0) * smooth(0.7, 1.0, v));
        *o = clamp01(x) as f32;
    }
    t
}

/// Applique le réglage Développer aux pixels RGBA, sur place.
pub fn apply(data: &mut [u8], adj: &Develop) {
    let hue = bands(&adj.hue);
    let sat_b = bands(&adj.sat);
    let lum_b = bands(&adj.lum);
    let tones_neutral = adj.contrast == 0.0
        && adj.highlights == 0.0
        && adj.shadows == 0.0
        && adj.whites == 0.0
        && adj.blacks == 0.0;
    let bands_neutral = hue.iter().chain(&sat_b).chain(&lum_b).all(|v| *v == 0.0);
    let t = adj.temperature / 100.0;
    let tint = adj.tint / 100.0;

    // 1. Balance des blancs et exposition.
    if adj.temperature != 0.0 || adj.tint != 0.0 || adj.exposure != 0.0 {
        let k = 2f64.powf(adj.exposure);
        let gains = [1.0 + t * 0.35, 1.0 - tint * 0.3, 1.0 - t * 0.35];
        let mut tabs = [[0u8; 256]; 3];
        for (c, g) in gains.iter().enumerate() {
            for (i, o) in tabs[c].iter_mut().enumerate() {
                *o = clamp_u8(round(to_srgb(to_linear(i as f64) * g * k)));
            }
        }
        each_pixel(data, |px| {
            px[0] = tabs[0][px[0] as usize];
            px[1] = tabs[1][px[1] as usize];
            px[2] = tabs[2][px[2] as usize];
        });
    }

    // 2. Tons.
    if !tones_neutral {
        let curve = tone_curve(adj);
        each_pixel(data, |px| {
            let (r, g, b) = (px[0] as f64, px[1] as f64, px[2] as f64);
            let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            let y2 = curve[(round(y) as usize).min(255)] as f64 * 255.0;
            let delta = y2 - y;
            let k = clamp01(y / 64.0);
            let ratio = if y > 0.0 { y2 / y } else { 1.0 };
            px[0] = clamp_u8(k * r * ratio + (1.0 - k) * (r + delta));
            px[1] = clamp_u8(k * g * ratio + (1.0 - k) * (g + delta));
            px[2] = clamp_u8(k * b * ratio + (1.0 - k) * (b + delta));
        });
    }

    // 3. Couleur par plage de teintes.
    if !bands_neutral {
        each_pixel(data, |px| {
            let (r, g, b) = (
                px[0] as f64 / 255.0,
                px[1] as f64 / 255.0,
                px[2] as f64 / 255.0,
            );
            let mx = r.max(g).max(b);
            let mn = r.min(g).min(b);
            let c = mx - mn;
            if c < 1e-4 {
                return;
            }
            let mut l = (mx + mn) / 2.0;
            let mut s = if l > 0.5 {
                c / (2.0 - mx - mn)
            } else {
                c / (mx + mn)
            };
            let mut h = if mx == r {
                (g - b) / c + if g < b { 6.0 } else { 0.0 }
            } else if mx == g {
                (b - r) / c + 2.0
            } else {
                (r - g) / c + 4.0
            };
            h *= 60.0;
            let w = clamp01(s * 2.0);
            let dh = (band_value(&hue, h) / 100.0) * 30.0 * w;
            let ds = (band_value(&sat_b, h) / 100.0) * w;
            let dl = (band_value(&lum_b, h) / 100.0) * 0.5 * w;
            h = (h + dh + 360.0) % 360.0;
            s = clamp01(if ds >= 0.0 {
                s + (1.0 - s) * ds
            } else {
                s * (1.0 + ds)
            });
            l = clamp01(if dl >= 0.0 {
                l + (1.0 - l) * dl
            } else {
                l * (1.0 + dl)
            });
            let q = if l < 0.5 {
                l * (1.0 + s)
            } else {
                l + s - l * s
            };
            let p = 2.0 * l - q;
            let hk = h / 360.0;
            let conv = |u: f64| {
                let u = (u + 1.0) % 1.0;
                if u < 1.0 / 6.0 {
                    p + (q - p) * 6.0 * u
                } else if u < 1.0 / 2.0 {
                    q
                } else if u < 2.0 / 3.0 {
                    p + (q - p) * (2.0 / 3.0 - u) * 6.0
                } else {
                    p
                }
            };
            px[0] = clamp_u8(conv(hk + 1.0 / 3.0) * 255.0);
            px[1] = clamp_u8(conv(hk) * 255.0);
            px[2] = clamp_u8(conv(hk - 1.0 / 3.0) * 255.0);
        });
    }

    // 4. Présence.
    if adj.vibrance != 0.0 || adj.saturation != 0.0 {
        let vib = adj.vibrance / 100.0;
        let sat = 1.0 + adj.saturation / 100.0;
        each_pixel(data, |px| {
            let (r, g, b) = (px[0] as f64, px[1] as f64, px[2] as f64);
            let mx = r.max(g).max(b);
            let mn = r.min(g).min(b);
            let s = if mx > 0.0 { (mx - mn) / mx } else { 0.0 };
            let f = ((1.0 + vib * (1.0 - s)) * sat).max(0.0);
            let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            px[0] = clamp_u8(y + (r - y) * f);
            px[1] = clamp_u8(y + (g - y) * f);
            px[2] = clamp_u8(y + (b - y) * f);
        });
    }
}
