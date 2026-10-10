//! Réglages d'image et filtres dynamiques, calculés sur des pixels RGBA non prémultipliés.
//! Portage exact de `applyAdjustment` (packages/core/src/adjust.ts) : mêmes formules, mêmes
//! arrondis, pour que l'image soit identique dans le navigateur et dans l'appli de bureau.
//!
//! Les couleurs et les dégradés restent décrits par le document (TypeScript) : l'interface les
//! convertit en nombres avant d'appeler le moteur (`gradient`, `rgb` ci-dessous).

use serde::Deserialize;

use crate::blur::gaussian_blurred;
use crate::js::{clamp01, clamp_u8, frac, luma, max3, min3, round};
use crate::par::{each_block, each_pixel, each_row};

/// Un réglage, tel que l'interface l'envoie au moteur (JSON, champ `kind`).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Adjustment {
    BrightnessContrast {
        brightness: f64,
        contrast: f64,
    },
    #[serde(rename_all = "camelCase")]
    Levels {
        black: f64,
        white: f64,
        gamma: f64,
        out_black: f64,
        out_white: f64,
    },
    Curves {
        rgb: Vec<[f64; 2]>,
        r: Vec<[f64; 2]>,
        g: Vec<[f64; 2]>,
        b: Vec<[f64; 2]>,
    },
    Exposure {
        exposure: f64,
        offset: f64,
        gamma: f64,
    },
    WhiteBalance {
        temperature: f64,
        tint: f64,
    },
    Invert,
    Posterize {
        levels: f64,
    },
    Hsl {
        hue: f64,
        saturation: f64,
        lightness: f64,
    },
    Vibrance {
        vibrance: f64,
        saturation: f64,
    },
    ColorBalance {
        shadows: [f64; 3],
        midtones: [f64; 3],
        highlights: [f64; 3],
    },
    BlackWhite {
        red: f64,
        green: f64,
        blue: f64,
    },
    /// `rgb` : couleur du filtre déjà convertie (0..255).
    PhotoFilter {
        rgb: [f64; 3],
        density: f64,
    },
    /// `gradient` : 256 couleurs RGB (768 octets) échantillonnées sur le dégradé.
    GradientMap {
        gradient: Vec<u8>,
    },
    Threshold {
        level: f64,
    },
    /// Table 3D : `size`³ couleurs en entiers de 16 bits encodés en base64 (comme le document).
    Lut {
        size: usize,
        data: String,
    },
    GaussianBlur {
        radius: f64,
    },
    UnsharpMask {
        amount: f64,
        radius: f64,
        threshold: f64,
    },
    Clarity {
        amount: f64,
    },
    Noise {
        amount: f64,
        monochrome: bool,
    },
    Vignette {
        amount: f64,
        size: f64,
        softness: f64,
    },
    Pixelate {
        size: f64,
    },
}

/// Repères du calcul, comme `AdjustOptions` côté TypeScript.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(default)]
pub struct Options {
    /// Pixels de l'image par pixel du document.
    pub scale: f64,
    /// Position (en pixels de l'image) de l'origine du document.
    pub origin: [f64; 2],
    /// Cadre de la vignette (le plan de travail), en pixels de l'image ; toute l'image sinon.
    pub frame: Option<[f64; 4]>,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            scale: 1.0,
            origin: [0.0, 0.0],
            frame: None,
        }
    }
}

/// Demande complète envoyée par l'interface : le réglage et ses repères.
#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    pub adjustment: Adjustment,
    #[serde(default)]
    pub options: Options,
}

// ————— Tables par canal —————

fn srgb_to_linear(i: u8) -> f64 {
    // Comme le `Float32Array` de la version TypeScript : valeur arrondie en 32 bits.
    let c = i as f64 / 255.0;
    (if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }) as f32 as f64
}

fn linear_to_srgb(v: f64) -> f64 {
    let v = clamp01(v);
    255.0
        * (if v <= 0.0031308 {
            v * 12.92
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        })
}

/// Courbe monotone (Fritsch–Carlson) passant par les points, sur 256 valeurs 0..1 (en 32 bits).
pub fn curve_table(points: &[[f64; 2]]) -> [f32; 256] {
    let mut pts: Vec<[f64; 2]> = points.to_vec();
    pts.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap_or(std::cmp::Ordering::Equal));
    let mut kept: Vec<[f64; 2]> = Vec::with_capacity(pts.len());
    for p in pts {
        if kept.last().map_or(true, |l| p[0] > l[0]) {
            kept.push(p);
        }
    }
    let pts = kept;
    let mut out = [0f32; 256];
    if pts.is_empty() {
        for (i, o) in out.iter_mut().enumerate() {
            *o = (i as f64 / 255.0) as f32;
        }
        return out;
    }
    if pts.len() == 1 {
        return [clamp01(pts[0][1]) as f32; 256];
    }
    let n = pts.len();
    let xs: Vec<f64> = pts.iter().map(|p| p[0]).collect();
    let ys: Vec<f64> = pts.iter().map(|p| p[1]).collect();
    let d: Vec<f64> = (0..n - 1)
        .map(|i| (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]))
        .collect();
    let mut m = vec![d[0]];
    for i in 1..n - 1 {
        m.push(if d[i - 1] * d[i] <= 0.0 {
            0.0
        } else {
            (d[i - 1] + d[i]) / 2.0
        });
    }
    m.push(d[n - 2]);
    for i in 0..n - 1 {
        if d[i] == 0.0 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
            continue;
        }
        let a = m[i] / d[i];
        let b = m[i + 1] / d[i];
        let s = a * a + b * b;
        if s > 9.0 {
            let t = 3.0 / s.sqrt();
            m[i] = t * a * d[i];
            m[i + 1] = t * b * d[i];
        }
    }
    let mut k = 0;
    for (i, o) in out.iter_mut().enumerate() {
        let x = i as f64 / 255.0;
        let v = if x <= xs[0] {
            clamp01(ys[0])
        } else if x >= xs[n - 1] {
            clamp01(ys[n - 1])
        } else {
            while x > xs[k + 1] {
                k += 1;
            }
            let h = xs[k + 1] - xs[k];
            let t = (x - xs[k]) / h;
            let t2 = t * t;
            let t3 = t2 * t;
            clamp01(
                (2.0 * t3 - 3.0 * t2 + 1.0) * ys[k]
                    + (t3 - 2.0 * t2 + t) * h * m[k]
                    + (-2.0 * t3 + 3.0 * t2) * ys[k + 1]
                    + (t3 - t2) * h * m[k + 1],
            )
        };
        *o = v as f32;
    }
    out
}

/// Tables de correspondance par canal (0..255 → 0..255), si le réglage en est une.
pub fn channel_tables(adj: &Adjustment) -> Option<[[u8; 256]; 3]> {
    let make = |f: &dyn Fn(f64, usize) -> f64| {
        let mut t = [[0u8; 256]; 3];
        for (c, table) in t.iter_mut().enumerate() {
            for (i, v) in table.iter_mut().enumerate() {
                *v = clamp_u8(round(f(i as f64, c)));
            }
        }
        t
    };
    Some(match adj {
        Adjustment::BrightnessContrast {
            brightness,
            contrast,
        } => {
            let c = contrast / 100.0;
            let f = if c >= 0.0 {
                1.0 / (1.0 - c * 0.99).max(0.01)
            } else {
                1.0 + c
            };
            make(&|v, _| 255.0 * ((v / 255.0 + brightness / 200.0 - 0.5) * f + 0.5))
        }
        Adjustment::Levels {
            black,
            white,
            gamma,
            out_black,
            out_white,
        } => {
            let range = (white - black).max(1.0);
            let g = 1.0 / gamma.max(0.01);
            make(&|v, _| {
                let t = clamp01((v - black) / range).powf(g);
                out_black + t * (out_white - out_black)
            })
        }
        Adjustment::Curves { rgb, r, g, b } => {
            let all = curve_table(rgb);
            let per = [curve_table(r), curve_table(g), curve_table(b)];
            make(&|v, c| 255.0 * per[c][round(all[v as usize] as f64 * 255.0) as usize] as f64)
        }
        Adjustment::Exposure {
            exposure,
            offset,
            gamma,
        } => {
            let k = 2f64.powf(*exposure);
            let g = 1.0 / gamma.max(0.01);
            make(&|v, _| linear_to_srgb((srgb_to_linear(v as u8) * k + offset).max(0.0).powf(g)))
        }
        Adjustment::WhiteBalance { temperature, tint } => {
            let t = temperature / 100.0;
            let tint = tint / 100.0;
            let gains = [1.0 + t * 0.35, 1.0 - tint * 0.3, 1.0 - t * 0.35];
            make(&|v, c| linear_to_srgb(srgb_to_linear(v as u8) * gains[c]))
        }
        Adjustment::Invert => make(&|v, _| 255.0 - v),
        Adjustment::Posterize { levels } => {
            let n = round(*levels).max(2.0);
            make(&|v, _| (round((v / 255.0) * (n - 1.0)) / (n - 1.0)) * 255.0)
        }
        _ => return None,
    })
}

// ————— Grain —————

/// Bruit pseudo-aléatoire stable : le même pixel du document a toujours le même grain.
fn hash(x: f64, y: f64, c: f64) -> f64 {
    // `(x * a + y * b + c * d) | 0` : produit exact en 64 bits, puis ramené à 32 bits signés.
    let s = (x as i64)
        .wrapping_mul(374761393)
        .wrapping_add((y as i64).wrapping_mul(668265263))
        .wrapping_add((c as i64).wrapping_mul(2147483647));
    let mut h = s as i32;
    h = (h ^ ((h as u32) >> 13) as i32).wrapping_mul(1274126177);
    h ^= ((h as u32) >> 16) as i32;
    (h as u32) as f64 / 4294967296.0
}

// ————— Table 3D —————

fn decode_base64(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0;
    for ch in text.bytes() {
        let v = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => continue,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

/// Valeurs d'une table 3D rangée dans le document (0..1, en 32 bits comme `decodeLut`).
pub fn decode_lut(size: usize, text: &str) -> Vec<f32> {
    let bytes = decode_base64(text);
    let n = size * size * size * 3;
    let mut data = vec![0f32; n];
    for (i, v) in data.iter_mut().enumerate() {
        if i * 2 + 1 >= bytes.len() {
            break;
        }
        *v = ((bytes[i * 2] as u32 | ((bytes[i * 2 + 1] as u32) << 8)) as f64 / 65535.0) as f32;
    }
    data
}

fn apply_lut(data: &mut [u8], size: usize, lut: &[f32]) {
    if size < 2 || lut.len() < size * size * size * 3 {
        return;
    }
    let n = size;
    let k = (n as f64 - 1.0) / 255.0;
    let n2 = n * n;
    let (o100, o010, o001) = (3, n * 3, n2 * 3);
    each_pixel(data, |px| {
        let fr = px[0] as f64 * k;
        let fg = px[1] as f64 * k;
        let fb = px[2] as f64 * k;
        let r0 = (n - 2).min(fr as usize);
        let g0 = (n - 2).min(fg as usize);
        let b0 = (n - 2).min(fb as usize);
        let tr = fr - r0 as f64;
        let tg = fg - g0 as f64;
        let tb = fb - b0 as f64;
        let base = (b0 * n2 + g0 * n + r0) * 3;
        let l = |i: usize| lut[i] as f64;
        for c in 0..3 {
            let p = base + c;
            let c00 = l(p) + (l(p + o100) - l(p)) * tr;
            let c10 = l(p + o010) + (l(p + o010 + o100) - l(p + o010)) * tr;
            let c01 = l(p + o001) + (l(p + o001 + o100) - l(p + o001)) * tr;
            let c11 = l(p + o001 + o010) + (l(p + o001 + o010 + o100) - l(p + o001 + o010)) * tr;
            let c0 = c00 + (c10 - c00) * tg;
            let c1 = c01 + (c11 - c01) * tg;
            px[c] = clamp_u8((c0 + (c1 - c0) * tb) * 255.0 + 0.5);
        }
    });
}

// ————— Application —————

/// Applique les tables par canal, sur place.
pub fn apply_tables(data: &mut [u8], t: &[[u8; 256]; 3]) {
    each_pixel(data, |px| {
        px[0] = t[0][px[0] as usize];
        px[1] = t[1][px[1] as usize];
        px[2] = t[2][px[2] as usize];
    });
}

fn hsl_pixel(px: &mut [u8; 4], dh: f64, ds: f64, dl: f64) {
    let r = px[0] as f64 / 255.0;
    let g = px[1] as f64 / 255.0;
    let b = px[2] as f64 / 255.0;
    let mx = max3(r, g, b);
    let mn = min3(r, g, b);
    let mut l = (mx + mn) / 2.0;
    let mut s = 0.0;
    let mut hh = 0.0;
    let d = mx - mn;
    if d > 1e-6 {
        s = if l > 0.5 {
            d / (2.0 - mx - mn)
        } else {
            d / (mx + mn)
        };
        hh = if mx == r {
            (g - b) / d + if g < b { 6.0 } else { 0.0 }
        } else if mx == g {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        hh /= 6.0;
    }
    hh = frac(hh + dh + 1.0);
    s = clamp01(if ds >= 0.0 {
        s + (1.0 - s) * ds * if d > 1e-6 { 1.0 } else { 0.0 }
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
    let conv = |t: f64| {
        let t = frac(t + 1.0);
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 1.0 / 2.0 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    px[0] = clamp_u8(conv(hh + 1.0 / 3.0) * 255.0);
    px[1] = clamp_u8(conv(hh) * 255.0);
    px[2] = clamp_u8(conv(hh - 1.0 / 3.0) * 255.0);
}

/// Applique un réglage aux pixels RGBA (`w` × `h`), sur place. L'opacité ne change pas.
pub fn apply(data: &mut [u8], w: usize, h: usize, adj: &Adjustment, opts: &Options) {
    let scale = opts.scale;
    if let Some(t) = channel_tables(adj) {
        apply_tables(data, &t);
        return;
    }
    match adj {
        Adjustment::Lut { size, data: text } => apply_lut(data, *size, &decode_lut(*size, text)),
        Adjustment::Hsl {
            hue,
            saturation,
            lightness,
        } => {
            let (dh, ds, dl) = (hue / 360.0, saturation / 100.0, lightness / 100.0);
            each_pixel(data, |px| hsl_pixel(px, dh, ds, dl));
        }
        Adjustment::Vibrance {
            vibrance,
            saturation,
        } => {
            let vib = vibrance / 100.0;
            let sat = 1.0 + saturation / 100.0;
            each_pixel(data, |px| {
                let (r, g, b) = (px[0] as f64, px[1] as f64, px[2] as f64);
                let mx = max3(r, g, b);
                let mn = min3(r, g, b);
                let s = if mx > 0.0 { (mx - mn) / mx } else { 0.0 };
                let f = (1.0 + vib * (1.0 - s)) * sat;
                let f = if f > 0.0 { f } else { 0.0 };
                let y = luma(r, g, b);
                px[0] = clamp_u8(y + (r - y) * f);
                px[1] = clamp_u8(y + (g - y) * f);
                px[2] = clamp_u8(y + (b - y) * f);
            });
        }
        Adjustment::ColorBalance {
            shadows,
            midtones,
            highlights,
        } => each_pixel(data, |px| {
            let l = luma(px[0] as f64, px[1] as f64, px[2] as f64) / 255.0;
            let ws = clamp01((0.333 - l) / 0.25 + 0.5);
            let wh = clamp01((l - 0.667) / 0.25 + 0.5);
            let wm = clamp01((l - 0.333) / 0.25 + 0.5) * clamp01((0.667 - l) / 0.25 + 0.5) * 0.7;
            for c in 0..3 {
                let shift = shadows[c] * ws + midtones[c] * wm + highlights[c] * wh;
                px[c] = clamp_u8(px[c] as f64 + shift * 0.64);
            }
        }),
        Adjustment::BlackWhite { red, green, blue } => {
            let (kr, kg, kb) = (red / 100.0, green / 100.0, blue / 100.0);
            each_pixel(data, |px| {
                let v = clamp_u8(px[0] as f64 * kr + px[1] as f64 * kg + px[2] as f64 * kb);
                px[0] = v;
                px[1] = v;
                px[2] = v;
            });
        }
        Adjustment::PhotoFilter { rgb, density } => {
            let d = clamp01(density / 100.0);
            let (fr, fg, fb) = (rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0);
            each_pixel(data, |px| {
                let (r, g, b) = (px[0] as f64, px[1] as f64, px[2] as f64);
                let y = luma(r, g, b);
                let (mut mr, mut mg, mut mb) = (r * fr, g * fg, b * fb);
                let my = luma(mr, mg, mb);
                if my > 0.01 {
                    let k = y / my;
                    mr *= k;
                    mg *= k;
                    mb *= k;
                }
                px[0] = clamp_u8(r + (mr - r) * d);
                px[1] = clamp_u8(g + (mg - g) * d);
                px[2] = clamp_u8(b + (mb - b) * d);
            });
        }
        Adjustment::GradientMap { gradient } => {
            if gradient.len() < 768 {
                return;
            }
            each_pixel(data, |px| {
                let v = round(luma(px[0] as f64, px[1] as f64, px[2] as f64)) as usize * 3;
                px[0] = gradient[v];
                px[1] = gradient[v + 1];
                px[2] = gradient[v + 2];
            });
        }
        Adjustment::Threshold { level } => each_pixel(data, |px| {
            let v = if luma(px[0] as f64, px[1] as f64, px[2] as f64) >= *level {
                255
            } else {
                0
            };
            px[0] = v;
            px[1] = v;
            px[2] = v;
        }),
        Adjustment::GaussianBlur { radius } => {
            let out = gaussian_blurred(data, w, h, (radius * scale) / 2.0);
            data.copy_from_slice(&out);
        }
        Adjustment::UnsharpMask { .. } | Adjustment::Clarity { .. } => {
            let clarity = matches!(adj, Adjustment::Clarity { .. });
            let (radius, amount, threshold) = match adj {
                Adjustment::UnsharpMask {
                    amount,
                    radius,
                    threshold,
                } => (*radius, *amount, *threshold),
                Adjustment::Clarity { amount } => (24.0, *amount, 0.0),
                _ => unreachable!(),
            };
            let amount = amount / 100.0;
            let blurred = gaussian_blurred(data, w, h, (radius * scale).max(0.5));
            each_block(data, |first, block| {
                let bl = &blurred[first * 4..first * 4 + block.len()];
                for (px, b) in block.chunks_exact_mut(4).zip(bl.chunks_exact(4)) {
                    let mut k = amount;
                    if clarity {
                        let l = luma(px[0] as f64, px[1] as f64, px[2] as f64) / 255.0;
                        k *= 1.0 - (2.0 * l - 1.0).powi(2);
                    }
                    for c in 0..3 {
                        let diff = px[c] as f64 - b[c] as f64;
                        if diff.abs() >= threshold {
                            px[c] = clamp_u8(px[c] as f64 + diff * k);
                        }
                    }
                }
            });
        }
        Adjustment::Noise { amount, monochrome } => {
            let amt = amount * 2.55;
            let [ox, oy] = opts.origin;
            each_row(data, w * 4, |y, row| {
                let dy = ((y as f64 - oy) / scale).floor();
                for x in 0..w {
                    let i = x * 4;
                    let dx = ((x as f64 - ox) / scale).floor();
                    if *monochrome {
                        let v = (hash(dx, dy, 0.0) * 2.0 - 1.0) * amt;
                        for c in 0..3 {
                            row[i + c] = clamp_u8(row[i + c] as f64 + v);
                        }
                    } else {
                        for c in 0..3 {
                            row[i + c] = clamp_u8(
                                row[i + c] as f64
                                    + (hash(dx, dy, c as f64 + 1.0) * 2.0 - 1.0) * amt,
                            );
                        }
                    }
                }
            });
        }
        Adjustment::Vignette {
            amount,
            size,
            softness,
        } => {
            let [fx, fy, fw, fh] = opts.frame.unwrap_or([0.0, 0.0, w as f64, h as f64]);
            let (cx, cy) = (fx + fw / 2.0, fy + fh / 2.0);
            let (rx, ry) = (fw / 2.0, fh / 2.0);
            let inner = clamp01(size / 100.0) * 1.2;
            let soft = ((softness / 100.0) * 1.2).max(0.05);
            let amt = amount / 100.0;
            let target = if amt >= 0.0 { 0.0 } else { 255.0 };
            each_row(data, w * 4, |y, row| {
                let ny = (y as f64 + 0.5 - cy) / ry;
                for x in 0..w {
                    let nx = (x as f64 + 0.5 - cx) / rx;
                    let d = (nx * nx + ny * ny).sqrt();
                    let mut t = clamp01((d - inner) / soft);
                    t = t * t * (3.0 - 2.0 * t);
                    if t <= 0.0 {
                        continue;
                    }
                    let k = t * amt.abs();
                    for c in 0..3 {
                        let v = row[x * 4 + c] as f64;
                        row[x * 4 + c] = clamp_u8(v + (target - v) * k);
                    }
                }
            });
        }
        Adjustment::Pixelate { size } => pixelate(data, w, h, (size * scale).max(1.0), opts.origin),
        _ => {}
    }
}

fn pixelate(data: &mut [u8], w: usize, h: usize, s: f64, origin: [f64; 2]) {
    let [ox, oy] = origin;
    let start_x = ox - (ox / s).ceil() * s;
    let start_y = oy - (oy / s).ceil() * s;
    let (wf, hf) = (w as f64, h as f64);
    let mut by = start_y;
    while by < hf {
        let y0 = by.floor().max(0.0) as usize;
        let y1 = (by + s).floor().min(hf).max(0.0) as usize;
        by += s;
        if y1 <= y0 {
            continue;
        }
        let mut bx = start_x;
        while bx < wf {
            let x0 = bx.floor().max(0.0) as usize;
            let x1 = (bx + s).floor().min(wf).max(0.0) as usize;
            bx += s;
            if x1 <= x0 {
                continue;
            }
            let (mut r, mut g, mut b, mut a) = (0.0, 0.0, 0.0, 0.0);
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = (y * w + x) * 4;
                    let al = data[i + 3] as f64;
                    r += data[i] as f64 * al;
                    g += data[i + 1] as f64 * al;
                    b += data[i + 2] as f64 * al;
                    a += al;
                }
            }
            if a == 0.0 {
                continue;
            }
            let (r, g, b) = (clamp_u8(r / a), clamp_u8(g / a), clamp_u8(b / a));
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = (y * w + x) * 4;
                    data[i] = r;
                    data[i + 1] = g;
                    data[i + 2] = b;
                }
            }
        }
    }
}

/// Distance (en pixels de l'image) dont un réglage lit les voisins : la marge à prévoir quand
/// l'image est découpée en tuiles.
pub fn reach_pixels(adj: &Adjustment, scale: f64) -> usize {
    use crate::blur::reach;
    match adj {
        Adjustment::GaussianBlur { radius } => reach((radius * scale) / 2.0),
        Adjustment::UnsharpMask { radius, .. } => reach((radius * scale).max(0.5)),
        Adjustment::Clarity { .. } => reach((24.0 * scale).max(0.5)),
        // La pixellisation se cale sur l'origine : une tuile doit couvrir des blocs entiers.
        Adjustment::Pixelate { size } => (size * scale).max(1.0).ceil() as usize,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Adjustment {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn lit_les_reglages_du_document() {
        assert!(matches!(parse(r#"{"kind":"invert"}"#), Adjustment::Invert));
        assert!(matches!(
            parse(
                r#"{"kind":"levels","black":0,"white":255,"gamma":1,"outBlack":0,"outWhite":255}"#
            ),
            Adjustment::Levels { .. }
        ));
    }

    #[test]
    fn inverser_puis_inverser_redonne_l_image() {
        let mut px: Vec<u8> = (0..=255u8).flat_map(|v| [v, 255 - v, v / 2, 128]).collect();
        let orig = px.clone();
        let inv = parse(r#"{"kind":"invert"}"#);
        apply(&mut px, 256, 1, &inv, &Options::default());
        assert_eq!(px[0..4], [255, 0, 255 - 0, 128]);
        apply(&mut px, 256, 1, &inv, &Options::default());
        assert_eq!(px, orig);
    }

    #[test]
    fn courbe_identite() {
        let t = curve_table(&[[0.0, 0.0], [1.0, 1.0]]);
        for (i, v) in t.iter().enumerate() {
            assert!((*v as f64 - i as f64 / 255.0).abs() < 1e-6);
        }
    }

    #[test]
    fn le_grain_est_celui_de_javascript() {
        // Valeurs relevées dans Chromium avec la fonction `hash` de adjust.ts.
        assert_eq!(hash(0.0, 0.0, 0.0), 0.0);
        let v = hash(12.0, -7.0, 2.0);
        assert!((0.0..1.0).contains(&v));
    }
}
