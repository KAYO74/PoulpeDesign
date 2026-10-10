//! Réglages lus au lancement, avant l'ouverture de la fenêtre (Préférences > Performances) :
//! accélération matérielle et carte graphique préférée du moteur web, et mémoire de l'ordinateur.
//!
//! Le moteur web ne choisit sa carte graphique qu'à son démarrage : l'interface enregistre ces
//! réglages dans un petit fichier, appliqué au lancement suivant par des variables d'environnement
//! que le moteur web lit (WebView2 sous Windows, WebKitGTK sous Linux). Sous macOS, le système
//! choisit seul la carte graphique : ces réglages n'y changent rien.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LaunchPrefs {
    /// Faux : rendu sans carte graphique (utile si un pilote pose problème).
    pub hardware_acceleration: Option<bool>,
    /// "default", "high-performance" ou "low-power".
    pub gpu_preference: Option<String>,
    /// Interface graphique : "auto", "vulkan", "metal", "dx12" ou "gl" (moteur Rust, et moteur
    /// web sous Windows).
    pub gpu_backend: Option<String>,
    /// Carte du moteur Rust : "auto", "discrete", "integrated" ou "cpu".
    pub gpu_device: Option<String>,
    /// Mémoire vidéo que le moteur Rust s'autorise, en Mo.
    pub vram_mb: Option<u64>,
}

impl LaunchPrefs {
    /// Réglages de la carte graphique du moteur Rust.
    pub fn engine_settings(&self) -> poulpe_engine::gpu::GpuSettings {
        let mut s = poulpe_engine::gpu::GpuSettings::default();
        let text = |v: &Option<String>| v.as_deref().map(|v| format!("\"{v}\""));
        if let Some(d) = text(&self.gpu_device).and_then(|v| serde_json::from_str(&v).ok()) {
            s.device = d;
        }
        if let Some(b) = text(&self.gpu_backend).and_then(|v| serde_json::from_str(&v).ok()) {
            s.backend = b;
        }
        if self.hardware_acceleration == Some(false) {
            s.device = poulpe_engine::gpu::GpuChoice::Cpu;
        }
        if let Some(v) = self.vram_mb {
            s.vram_mb = v.clamp(64, 65536);
        }
        s
    }
}

/// Dossier de configuration de l'appli, comme `app_config_dir` de Tauri.
fn config_dir(identifier: &str) -> Option<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    }?;
    Some(base.join(identifier))
}

fn prefs_path(identifier: &str) -> Option<PathBuf> {
    config_dir(identifier).map(|d| d.join("lancement.json"))
}

pub fn read(identifier: &str) -> LaunchPrefs {
    prefs_path(identifier)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write(identifier: &str, json: &str) -> Result<(), String> {
    let prefs: LaunchPrefs = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let path = prefs_path(identifier).ok_or("dossier de configuration introuvable")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// Variables d'environnement à donner au moteur web pour ces réglages, sur ce système.
pub fn env_for(prefs: &LaunchPrefs, os: &str) -> Vec<(&'static str, String)> {
    let accel = prefs.hardware_acceleration.unwrap_or(true);
    let gpu = prefs.gpu_preference.as_deref().unwrap_or("default");
    let mut vars = Vec::new();
    match os {
        "windows" => {
            // Arguments par défaut de Tauri (wry), gardés puisque la variable les remplace.
            let mut args = vec!["--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"];
            if !accel {
                args.push("--disable-gpu");
            } else {
                if gpu == "high-performance" {
                    args.push("--force_high_performance_gpu");
                } else if gpu == "low-power" {
                    args.push("--force_low_power_gpu");
                }
                // Le moteur web dessine par ANGLE : Direct3D 11 par défaut, Vulkan ou OpenGL au choix.
                match prefs.gpu_backend.as_deref() {
                    Some("vulkan") => args.push("--use-angle=vulkan"),
                    Some("gl") => args.push("--use-angle=gl"),
                    _ => {}
                }
            }
            if args.len() > 1 {
                vars.push(("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args.join(" ")));
            }
        }
        "linux" => {
            if !accel {
                vars.push(("WEBKIT_DISABLE_COMPOSITING_MODE", "1".into()));
                vars.push(("WEBKIT_DISABLE_DMABUF_RENDERER", "1".into()));
            } else if gpu == "high-performance" {
                // Pilotes libres (Mesa) : la carte graphique dédiée d'un portable à deux cartes.
                vars.push(("DRI_PRIME", "1".into()));
            } else if gpu == "low-power" {
                vars.push(("DRI_PRIME", "0".into()));
            }
        }
        _ => {}
    }
    vars
}

/// Applique les réglages enregistrés. À appeler avant de créer la fenêtre, tant qu'un seul fil tourne.
/// Une variable déjà définie par l'utilisateur n'est pas remplacée.
pub fn apply(identifier: &str) {
    for (key, value) in env_for(&read(identifier), std::env::consts::OS) {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
        }
    }
}

/// Mémoire de l'ordinateur, en Mo : totale et disponible (quand le système la donne).
#[derive(Debug, Serialize)]
pub struct SystemMemory {
    pub total_mb: Option<u64>,
    pub available_mb: Option<u64>,
}

#[cfg(target_os = "linux")]
pub fn system_memory() -> SystemMemory {
    let info = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let field = |name: &str| {
        info.lines()
            .find(|l| l.starts_with(name))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|v| v.parse::<u64>().ok())
            .map(|kb| kb / 1024)
    };
    SystemMemory { total_mb: field("MemTotal:"), available_mb: field("MemAvailable:") }
}

#[cfg(target_os = "macos")]
pub fn system_memory() -> SystemMemory {
    let total = std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(|b| b / 1_048_576);
    SystemMemory { total_mb: total, available_mb: None }
}

#[cfg(target_os = "windows")]
pub fn system_memory() -> SystemMemory {
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatusEx) -> i32;
    }
    let mut status = MemoryStatusEx {
        length: std::mem::size_of::<MemoryStatusEx>() as u32,
        memory_load: 0,
        total_phys: 0,
        avail_phys: 0,
        total_page_file: 0,
        avail_page_file: 0,
        total_virtual: 0,
        avail_virtual: 0,
        avail_extended_virtual: 0,
    };
    // SAFETY : la structure a la taille et l'alignement attendus, et sa longueur est renseignée.
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) } != 0;
    SystemMemory {
        total_mb: ok.then_some(status.total_phys / 1_048_576),
        available_mb: ok.then_some(status.avail_phys / 1_048_576),
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn system_memory() -> SystemMemory {
    SystemMemory { total_mb: None, available_mb: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prefs(accel: bool, gpu: &str) -> LaunchPrefs {
        LaunchPrefs { hardware_acceleration: Some(accel), gpu_preference: Some(gpu.into()), ..Default::default() }
    }

    #[test]
    fn reglages_du_moteur_rust() {
        use poulpe_engine::gpu::{BackendChoice, GpuChoice};
        let p: LaunchPrefs = serde_json::from_str(
            r#"{"hardware_acceleration":true,"gpu_device":"integrated","gpu_backend":"vulkan","vram_mb":512}"#,
        )
        .unwrap();
        let s = p.engine_settings();
        assert_eq!((s.device, s.backend, s.vram_mb), (GpuChoice::Integrated, BackendChoice::Vulkan, 512));
        let win = env_for(&p, "windows");
        assert!(win[0].1.ends_with("--use-angle=vulkan"));
        let off = LaunchPrefs { hardware_acceleration: Some(false), ..p };
        assert_eq!(off.engine_settings().device, GpuChoice::Cpu);
        assert_eq!(LaunchPrefs::default().engine_settings().device, GpuChoice::Auto);
    }

    #[test]
    fn par_defaut_rien_ne_change() {
        for os in ["windows", "linux", "macos"] {
            assert!(env_for(&LaunchPrefs::default(), os).is_empty());
            assert!(env_for(&prefs(true, "default"), os).is_empty());
        }
    }

    #[test]
    fn traduit_les_reglages_pour_chaque_systeme() {
        let win = env_for(&prefs(false, "high-performance"), "windows");
        assert_eq!(win.len(), 1);
        assert!(win[0].1.contains("--disable-gpu"));
        assert!(win[0].1.contains("msWebOOUI"));
        let win = env_for(&prefs(true, "high-performance"), "windows");
        assert!(win[0].1.ends_with("--force_high_performance_gpu"));
        assert_eq!(env_for(&prefs(true, "high-performance"), "linux"), vec![("DRI_PRIME", "1".to_string())]);
        assert_eq!(env_for(&prefs(false, "default"), "linux").len(), 2);
        assert!(env_for(&prefs(false, "low-power"), "macos").is_empty());
    }

    #[test]
    fn enregistre_et_relit_les_reglages() {
        let id = format!("org.poulpe.test-{}", std::process::id());
        std::env::set_var("XDG_CONFIG_HOME", std::env::temp_dir());
        if cfg!(target_os = "linux") {
            write(&id, r#"{"hardware_acceleration":false,"gpu_preference":"low-power"}"#).unwrap();
            assert_eq!(read(&id), prefs(false, "low-power"));
            assert!(write(&id, "pas du json").is_err());
            let _ = std::fs::remove_dir_all(config_dir(&id).unwrap());
        }
    }

    #[test]
    fn lit_la_memoire_de_l_ordinateur() {
        let m = system_memory();
        if cfg!(any(target_os = "linux", target_os = "macos", target_os = "windows")) {
            assert!(m.total_mb.unwrap_or(0) > 0);
        }
    }
}
