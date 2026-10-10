//! Appli de bureau Poulpe Design : une fenêtre Tauri qui embarque l'éditeur web (`apps/editor`).
//!
//! Le côté Rust : moteur de calcul des images (crates/poulpe-engine : filtres et réglages sur la
//! carte graphique ou sur tous les cœurs), ouverture des fichiers `.poulpe` par double-clic,
//! liste et données des polices installées, mesure des performances, réglages de la carte
//! graphique et mémoire de l'ordinateur (Préférences), langue choisie dans l'installeur Windows,
//! et accès aux fichiers via les extensions officielles de Tauri.

mod engine;
mod launch;

use std::path::PathBuf;
use std::sync::Mutex;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::{Emitter, Manager};

/// Fichier passé au lancement de l'appli (double-clic sur un `.poulpe`), en attente d'être ouvert.
#[derive(Default)]
struct OpenedFile(Mutex<Option<String>>);

/// Premier argument de la ligne de commande qui désigne un fichier `.poulpe` existant.
fn poulpe_file_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| {
            p.extension()
                .map(|e| e.eq_ignore_ascii_case("poulpe"))
                .unwrap_or(false)
                && p.is_file()
        })
        .map(|p| p.to_string_lossy().into_owned())
}

/// Renvoie (une seule fois) le fichier à ouvrir au démarrage.
#[tauri::command]
fn opened_file(state: tauri::State<'_, OpenedFile>) -> Option<String> {
    state.0.lock().ok()?.take()
}

/// Familles de polices installées sur l'ordinateur, triées et sans doublons.
#[tauri::command]
fn list_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut families: Vec<String> = db
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        .collect();
    families.sort_by_key(|f| f.to_lowercase());
    families.dedup();
    families
}

/// Fichier TrueType d'une police installée, pour l'intégrer dans un PDF. Les polices
/// PostScript (OpenType CFF) et les collections ne sont pas prises en charge par l'export PDF.
#[tauri::command]
fn font_data(family: String, weight: u16, italic: bool) -> Result<tauri::ipc::Response, String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let bytes = truetype_face(&db, &family, weight, italic).ok_or("police introuvable")?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn truetype_face(db: &fontdb::Database, family: &str, weight: u16, italic: bool) -> Option<Vec<u8>> {
    let id = db.query(&fontdb::Query {
        families: &[fontdb::Family::Name(family)],
        weight: fontdb::Weight(weight),
        style: if italic { fontdb::Style::Italic } else { fontdb::Style::Normal },
        stretch: fontdb::Stretch::Normal,
    })?;
    // La requête renvoie la face la plus proche, éventuellement d'une autre famille : on vérifie.
    let face = db.face(id)?;
    if !face.families.iter().any(|(name, _)| name.eq_ignore_ascii_case(family)) {
        return None;
    }
    db.with_face_data(id, |data, index| {
        let truetype = data.len() > 4 && (data[..4] == [0, 1, 0, 0] || &data[..4] == b"true");
        (index == 0 && truetype).then(|| data.to_vec())
    })?
}

/// Mode mesure de performances : `POULPE_BENCH=1` lance un scénario de dessin au démarrage.
#[tauri::command]
fn bench_mode() -> bool {
    std::env::var("POULPE_BENCH").map(|v| v == "1").unwrap_or(false)
}

/// Écrit le rapport de mesure sur la sortie standard, puis ferme l'appli.
#[tauri::command]
fn bench_report(app: tauri::AppHandle, report: String) {
    if bench_mode() {
        println!("{report}");
        app.exit(0);
    }
}

/// Mémoire de l'ordinateur (Préférences > Performances, Diagnostic).
#[tauri::command]
fn system_memory() -> launch::SystemMemory {
    launch::system_memory()
}

/// Enregistre l'accélération matérielle et la carte graphique préférée, appliquées au prochain lancement.
#[tauri::command]
fn save_launch_prefs(app: tauri::AppHandle, prefs: String) -> Result<(), String> {
    launch::write(&app.config().identifier, &prefs)
}

/// Langue choisie dans l'installeur Windows : `langue.txt`, écrit à côté de l'appli par l'installeur
/// (windows/langue.nsh). Rien sous macOS et Linux, ni avec l'installeur MSI : l'appli la demande
/// alors au premier lancement.
#[tauri::command]
fn installer_language() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    parse_language(&std::fs::read_to_string(exe.parent()?.join("langue.txt")).ok()?)
}

fn parse_language(text: &str) -> Option<String> {
    let lang = text.trim();
    matches!(lang, "fr" | "en").then(|| lang.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let identifier = context.config().identifier.clone();
    launch::apply(&identifier);
    let engine = engine::Engine::new(launch::read(&identifier).engine_settings());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            // Mises à jour automatiques : vérifiées et installées depuis l'interface (updater.ts).
            #[cfg(desktop)]
            _app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .manage(engine)
        .manage(OpenedFile(Mutex::new(poulpe_file_from_args(std::env::args()))))
        .invoke_handler(tauri::generate_handler![
            opened_file,
            list_fonts,
            font_data,
            bench_mode,
            bench_report,
            system_memory,
            save_launch_prefs,
            installer_language,
            engine::engine_info,
            engine::engine_configure,
            engine::engine_apply
        ])
        .build(context)
        .expect("impossible de démarrer Poulpe Design");

    app.run(|_handle, _event| {
        // macOS transmet les fichiers ouverts depuis le Finder par un événement, pas par les arguments.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path = path.to_string_lossy().into_owned();
                    if let Some(window) = _handle.get_webview_window("main") {
                        let _ = window.emit("open-file", path.clone());
                    }
                    if let Some(state) = _handle.try_state::<OpenedFile>() {
                        if let Ok(mut slot) = state.0.lock() {
                            slot.get_or_insert(path);
                        }
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trouve_le_fichier_poulpe_dans_les_arguments() {
        let dir = std::env::temp_dir().join("poulpe-test-args");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("Affiche.POULPE");
        std::fs::write(&file, b"x").unwrap();
        let args = vec![
            "poulpe".to_string(),
            "--flag".to_string(),
            file.to_string_lossy().into_owned(),
        ];
        assert_eq!(poulpe_file_from_args(args), Some(file.to_string_lossy().into_owned()));
        assert_eq!(poulpe_file_from_args(vec!["poulpe".to_string(), "absent.poulpe".to_string()]), None);
    }

    #[test]
    fn ne_renvoie_que_la_famille_demandee() {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        assert!(truetype_face(&db, "Police qui n'existe pas", 400, false).is_none());
        let first = db.faces().find_map(|f| f.families.first().map(|(n, _)| n.clone()));
        if let Some(name) = first {
            if let Some(bytes) = truetype_face(&db, &name, 400, false) {
                assert!(bytes[..4] == [0, 1, 0, 0] || &bytes[..4] == b"true");
            }
        }
    }

    #[test]
    fn lit_la_langue_de_l_installeur() {
        assert_eq!(parse_language("fr"), Some("fr".to_string()));
        assert_eq!(parse_language("en\r\n"), Some("en".to_string()));
        assert_eq!(parse_language("de"), None);
        assert_eq!(parse_language(""), None);
    }

    #[test]
    fn liste_les_polices_sans_doublons() {
        let fonts = list_fonts();
        let mut sorted = fonts.clone();
        sorted.dedup();
        assert_eq!(fonts.len(), sorted.len());
    }
}
