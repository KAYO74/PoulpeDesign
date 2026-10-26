//! Lecture d'un RAW et développement : niveaux du capteur, dématriçage bilinéaire, balance des
//! blancs de l'appareil, passage des couleurs de l'appareil au sRGB, puis réglages (exposition,
//! température, tons, contraste, saturation) et gamma sRGB.

use rawloader::{Orientation, RawImageData};
use serde::Deserialize;
use std::io::Cursor;

/// Réglages du développement, de -100 à 100 (exposition en IL, de -5 à 5).
#[derive(Deserialize, Default, Clone, Copy)]
#[serde(default)]
pub struct Develop {
    pub exposure: f32,
    pub temperature: f32,
    pub tint: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub vibrance: f32,
    pub saturation: f32,
}

/// Valeurs linéaires sRGB stockées sur 16 bits : 1.0 vaut `ONE` (marge pour les hautes lumières).
const ONE: f32 = 8192.0;

/// Photo dématricée, en couleurs linéaires sRGB, avant orientation.
pub struct Linear {
    w: usize,
    h: usize,
    rgb: Vec<u16>,
    orientation: Orientation,
}

const XYZ_FROM_SRGB: [[f32; 3]; 3] = [
    [0.412_453, 0.357_580, 0.180_423],
    [0.212_671, 0.715_160, 0.072_169],
    [0.019_334, 0.119_193, 0.950_227],
];

fn mul3(a: &[[f32; 3]; 3], b: &[[f32; 3]; 3]) -> [[f32; 3]; 3] {
    let mut m = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    m
}

fn inverse3(m: &[[f32; 3]; 3]) -> Option<[[f32; 3]; 3]> {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if det.abs() < 1e-9 {
        return None;
    }
    let d = 1.0 / det;
    Some([
        [
            (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * d,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * d,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * d,
        ],
        [
            (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * d,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * d,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * d,
        ],
        [
            (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * d,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * d,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * d,
        ],
    ])
}

/// Matrice appareil → sRGB linéaire (comme dcraw), ou l'identité si l'appareil est inconnu.
fn camera_to_srgb(xyz_to_cam: &[[f32; 3]; 4]) -> [[f32; 3]; 3] {
    let cam_xyz = [xyz_to_cam[0], xyz_to_cam[1], xyz_to_cam[2]];
    let mut cam_rgb = mul3(&cam_xyz, &XYZ_FROM_SRGB);
    for row in cam_rgb.iter_mut() {
        let s: f32 = row.iter().sum();
        if s.abs() < 1e-6 {
            return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        }
        for v in row.iter_mut() {
            *v /= s;
        }
    }
    inverse3(&cam_rgb).unwrap_or([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
}

/// Lit un fichier RAW et le dématrice. None si le format n'est pas reconnu.
pub fn decode(bytes: &[u8]) -> Option<Linear> {
    let img = rawloader::decode(&mut Cursor::new(bytes)).ok()?;
    let (w, h, cpp) = (img.width, img.height, img.cpp);
    if w == 0 || h == 0 || (cpp != 1 && cpp != 3) {
        return None;
    }
    let raw: Vec<f32> = match img.data {
        RawImageData::Integer(v) => v.into_iter().map(|x| x as f32).collect(),
        RawImageData::Float(v) => v,
    };
    if raw.len() < w * h * cpp {
        return None;
    }
    // Zone utile du capteur : haut, droite, bas, gauche.
    let [top, right, bottom, left] = img.crops;
    let (x0, y0, cw, ch) = if left + right < w && top + bottom < h {
        (left, top, w - left - right, h - top - bottom)
    } else {
        (0, 0, w, h)
    };
    let mut wb = img.wb_coeffs;
    if wb.iter().take(3).any(|v| !v.is_finite() || *v <= 0.0) {
        wb = [1.0; 4];
    }
    let g = wb[1];
    let wb: Vec<f32> = wb
        .iter()
        .map(|v| {
            if v.is_finite() && *v > 0.0 {
                v / g
            } else {
                1.0
            }
        })
        .collect();
    let black: Vec<f32> = img.blacklevels.iter().map(|v| *v as f32).collect();
    let range: Vec<f32> = img
        .whitelevels
        .iter()
        .zip(&black)
        .map(|(w, b)| (*w as f32 - b).max(1.0))
        .collect();
    let m = camera_to_srgb(&img.xyz_to_cam);
    // Couleur d'un photosite : 0 rouge, 1 vert, 2 bleu (le 4e d'un capteur CMJV compte comme vert).
    let color = |row: usize, col: usize| -> usize {
        let c = img.cfa.color_at(row, col);
        if c > 2 {
            1
        } else {
            c
        }
    };
    let level = |c: usize, v: f32| ((v - black[c]) / range[c]).max(0.0) * wb[c];
    let mut rgb = vec![0u16; cw * ch * 3];
    let mut put = |i: usize, cam: [f32; 3]| {
        for k in 0..3 {
            let v = m[k][0] * cam[0] + m[k][1] * cam[1] + m[k][2] * cam[2];
            rgb[i * 3 + k] = (v * ONE).clamp(0.0, 65535.0) as u16;
        }
    };
    if cpp == 3 {
        for y in 0..ch {
            for x in 0..cw {
                let s = ((y + y0) * w + x + x0) * 3;
                put(
                    y * cw + x,
                    [level(0, raw[s]), level(1, raw[s + 1]), level(2, raw[s + 2])],
                );
            }
        }
    } else {
        // Dématriçage bilinéaire : chaque couleur manquante est la moyenne des voisins qui l'ont.
        for y in 0..ch {
            for x in 0..cw {
                let (ry, rx) = (y + y0, x + x0);
                let mut sum = [0.0f32; 3];
                let mut n = [0u32; 3];
                let here = color(ry, rx);
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        let (sy, sx) = (ry as i32 + dy, rx as i32 + dx);
                        if sy < y0 as i32
                            || sx < x0 as i32
                            || sy >= (y0 + ch) as i32
                            || sx >= (x0 + cw) as i32
                        {
                            continue;
                        }
                        let c = color(sy as usize, sx as usize);
                        // La couleur du photosite lui-même : sa seule valeur, sans voisins.
                        if c == here && (dx != 0 || dy != 0) {
                            continue;
                        }
                        sum[c] += level(c, raw[sy as usize * w + sx as usize]);
                        n[c] += 1;
                    }
                }
                let cam = [0, 1, 2].map(|c| if n[c] > 0 { sum[c] / n[c] as f32 } else { 0.0 });
                put(y * cw + x, cam);
            }
        }
    }
    Some(Linear {
        w: cw,
        h: ch,
        rgb,
        orientation: img.orientation,
    })
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn to_srgb(v: f32) -> f32 {
    if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// Une couleur linéaire développée selon les réglages, en sRGB de 0 à 1.
pub fn develop_pixel(p: &Develop, mut c: [f32; 3]) -> [f32; 3] {
    let t = p.temperature / 100.0;
    let u = p.tint / 100.0;
    let gain = 2f32.powf(p.exposure);
    c[0] *= 2f32.powf(0.35 * t) * gain;
    c[1] *= 2f32.powf(-0.25 * u) * gain;
    c[2] *= 2f32.powf(-0.35 * t) * gain;
    let l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    let k = (1.0 + p.shadows / 100.0 * 1.5 * (1.0 - smoothstep(0.0, 0.35, l)))
        * (1.0 + p.highlights / 100.0 * 0.5 * smoothstep(0.35, 1.2, l));
    for v in c.iter_mut() {
        *v *= k;
    }
    // Épaule douce : les hautes lumières tendent vers le blanc sans être coupées net.
    let m = c[0].max(c[1]).max(c[2]);
    if m > 0.75 {
        let soft = 0.75 + 0.25 * (1.0 - (-(m - 0.75) / 0.25).exp());
        for v in c.iter_mut() {
            *v *= soft / m;
        }
    }
    let mut s = c.map(|v| to_srgb(v.max(0.0)));
    let ct = p.contrast / 100.0;
    for v in s.iter_mut() {
        let x = v.clamp(0.0, 1.0);
        *v = if ct >= 0.0 {
            x + (x * x * (3.0 - 2.0 * x) - x) * ct
        } else {
            x + (0.5 - x) * -ct * 0.5
        };
    }
    let l = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    let sat = s[0].max(s[1]).max(s[2]) - s[0].min(s[1]).min(s[2]);
    let f = (1.0 + p.saturation / 100.0) * (1.0 + p.vibrance / 100.0 * (1.0 - sat));
    s.map(|v| (l + (v - l) * f).clamp(0.0, 1.0))
}

impl Linear {
    /// Taille de la photo une fois tournée selon son orientation.
    pub fn out_size(&self) -> (usize, usize) {
        match self.orientation {
            Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Transpose
            | Orientation::Transverse => (self.h, self.w),
            _ => (self.w, self.h),
        }
    }

    /// Point (x, y) de la photo tournée → photosite de l'image lue.
    fn source(&self, x: usize, y: usize) -> (usize, usize) {
        let (w, h) = (self.w, self.h);
        match self.orientation {
            Orientation::HorizontalFlip => (w - 1 - x, y),
            Orientation::Rotate180 => (w - 1 - x, h - 1 - y),
            Orientation::VerticalFlip => (x, h - 1 - y),
            Orientation::Transpose => (y, x),
            Orientation::Rotate90 => (y, h - 1 - x),
            Orientation::Transverse => (w - 1 - y, h - 1 - x),
            Orientation::Rotate270 => (w - 1 - y, x),
            _ => (x, y),
        }
    }

    /// Développe la photo, réduite pour tenir dans `max_side` pixels (0 : taille réelle) :
    /// (largeur, hauteur, pixels RGBA).
    pub fn render(&self, p: &Develop, max_side: usize) -> (usize, usize, Vec<u8>) {
        let (ow, oh) = self.out_size();
        let step = if max_side > 0 {
            ow.max(oh).div_ceil(max_side).max(1)
        } else {
            1
        };
        let (rw, rh) = (ow.div_ceil(step), oh.div_ceil(step));
        // Au plus 4 × 4 échantillons par pixel réduit : assez pour un aperçu net, et rapide.
        let probe = step.min(4);
        let mut out = vec![0u8; rw * rh * 4];
        for y in 0..rh {
            for x in 0..rw {
                let mut acc = [0.0f32; 3];
                let mut n = 0.0;
                for j in 0..probe {
                    for i in 0..probe {
                        let (px, py) = (x * step + i * step / probe, y * step + j * step / probe);
                        if px >= ow || py >= oh {
                            continue;
                        }
                        let (sx, sy) = self.source(px, py);
                        let s = (sy * self.w + sx) * 3;
                        for k in 0..3 {
                            acc[k] += self.rgb[s + k] as f32;
                        }
                        n += 1.0;
                    }
                }
                let c = develop_pixel(p, acc.map(|v| v / (n * ONE)));
                let o = (y * rw + x) * 4;
                for k in 0..3 {
                    out[o + k] = (c[k] * 255.0 + 0.5) as u8;
                }
                out[o + 3] = 255;
            }
        }
        (rw, rh, out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_settings_keep_grey_grey() {
        let c = develop_pixel(&Develop::default(), [0.18, 0.18, 0.18]);
        assert!((c[0] - c[1]).abs() < 1e-4 && (c[1] - c[2]).abs() < 1e-4);
        assert!((c[0] - 0.46).abs() < 0.02, "gris moyen à {}", c[0]);
    }

    #[test]
    fn exposure_and_temperature() {
        let base = develop_pixel(&Develop::default(), [0.1, 0.1, 0.1]);
        let brighter = develop_pixel(
            &Develop {
                exposure: 1.0,
                ..Default::default()
            },
            [0.1, 0.1, 0.1],
        );
        assert!(brighter[1] > base[1]);
        let warm = develop_pixel(
            &Develop {
                temperature: 50.0,
                ..Default::default()
            },
            [0.1, 0.1, 0.1],
        );
        assert!(warm[0] > warm[2]);
    }

    #[test]
    fn rotation_swaps_sides() {
        let l = Linear {
            w: 4,
            h: 2,
            rgb: vec![0; 24],
            orientation: Orientation::Rotate90,
        };
        assert_eq!(l.out_size(), (2, 4));
        let (w, h, px) = l.render(&Develop::default(), 0);
        assert_eq!((w, h, px.len()), (2, 4, 32));
    }
}
