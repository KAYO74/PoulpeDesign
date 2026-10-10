//! Moteur de Poulpe Design, écrit en Rust.
//!
//! Il reprend le travail lourd sur les pixels (réglages, filtres, flous), le découpage des grandes
//! images en tuiles et la mesure des performances. Le même code tourne :
//! - dans l'appli de bureau, sur tous les cœurs (fonction `parallel`) et sur la carte graphique
//!   (fonction `gpu`, via wgpu : Vulkan, Metal, DirectX 12 ou OpenGL) ;
//! - dans le navigateur et la vue web, compilé en WebAssembly (crate `poulpe-engine-wasm`).

pub mod adjust;
pub mod blur;
pub mod js;
pub mod par;
pub mod stats;
pub mod tiles;

#[cfg(feature = "gpu")]
pub mod gpu;
