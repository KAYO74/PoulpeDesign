//! Mesure du moteur natif : `cargo run --release --features gpu --example bench`.
use poulpe_engine::adjust::{Adjustment, Options};
use poulpe_engine::gpu::{self, list_adapters, BackendChoice, Gpu, GpuSettings};

fn main() {
    println!("Cartes : {:?}", list_adapters(BackendChoice::Auto));
    let g = Gpu::open(&GpuSettings::default());
    println!("Choisie : {:?}", g.as_ref().map(|g| &g.adapter.name));
    let (w, h) = (4000, 3000);
    let src: Vec<u8> = (0..w * h * 4)
        .map(|i| ((i as u64 * 2654435761) >> 24) as u8)
        .collect();
    let cases = [
        r#"{"kind":"levels","black":20,"white":230,"gamma":1.4,"outBlack":10,"outWhite":240}"#,
        r#"{"kind":"hsl","hue":47,"saturation":30,"lightness":-12}"#,
        r#"{"kind":"vibrance","vibrance":45,"saturation":10}"#,
        r#"{"kind":"gaussianBlur","radius":20}"#,
        r#"{"kind":"clarity","amount":60}"#,
        r#"{"kind":"noise","amount":15,"monochrome":false}"#,
        r#"{"kind":"unsharpMask","amount":120,"radius":2.5,"threshold":3}"#,
    ];
    for c in cases {
        let adj: Adjustment = serde_json::from_str(c).unwrap();
        for (label, gg) in [("processeur", None), ("carte", g.as_ref())] {
            let mut d = src.clone();
            let (wh, ms) = gpu::apply(gg, &mut d, w, h, &adj, &Options::default());
            println!(
                "{:<55} {label:<10} {:?} {ms:>7.0} ms",
                &c[..c.len().min(55)],
                wh
            );
        }
    }
}
