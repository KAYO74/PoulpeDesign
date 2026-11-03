//! Moteur Rust natif (crates/poulpe-engine) dans l'appli de bureau : filtres et réglages appliqués
//! aux grandes images sur la carte graphique ou sur tous les cœurs du processeur, hors du fil de
//! l'interface (l'appli ne se fige pas pendant le calcul).
//!
//! La carte graphique n'est ouverte qu'au premier calcul qui en a besoin : le démarrage reste
//! rapide et l'appli au repos n'occupe pas de mémoire vidéo.

use std::sync::{Arc, Mutex};

use poulpe_engine::adjust::Request;
use poulpe_engine::gpu::{self, AdapterSummary, Gpu, GpuSettings};
use poulpe_engine::stats::{Profiler, Summary};
use serde::Serialize;

#[derive(Default)]
struct Inner {
    settings: GpuSettings,
    /// None : pas encore ouverte ; Some(None) : aucune carte utilisable (calcul sur le processeur).
    gpu: Option<Option<Arc<Gpu>>>,
    profiler: Profiler,
}

#[derive(Clone, Default)]
pub struct Engine(Arc<Mutex<Inner>>);

impl Engine {
    pub fn new(settings: GpuSettings) -> Self {
        Engine(Arc::new(Mutex::new(Inner { settings, ..Default::default() })))
    }

    fn gpu(&self) -> Option<Arc<Gpu>> {
        let settings = {
            let inner = self.0.lock().unwrap();
            if let Some(g) = &inner.gpu {
                return g.clone();
            }
            inner.settings.clone()
        };
        // Ouverture hors du verrou : elle peut prendre quelques centaines de millisecondes.
        let opened = Gpu::open(&settings).map(Arc::new);
        let mut inner = self.0.lock().unwrap();
        inner.gpu.get_or_insert(opened).clone()
    }

    fn configure(&self, settings: GpuSettings) {
        let mut inner = self.0.lock().unwrap();
        inner.settings = settings;
        inner.gpu = None;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    /// Cartes graphiques trouvées.
    adapters: Vec<AdapterSummary>,
    /// Carte utilisée par le moteur (None : processeur).
    active: Option<AdapterSummary>,
    settings: GpuSettings,
    /// Cœurs du processeur utilisés quand la carte graphique ne sert pas.
    cores: usize,
    /// Durée des derniers calculs, par sorte (`gpu:levels`, `cpu:gaussianBlur`…).
    timings: std::collections::HashMap<String, Summary>,
}

/// État du moteur pour les Préférences et la fenêtre Diagnostic.
#[tauri::command]
pub async fn engine_info(engine: tauri::State<'_, Engine>) -> Result<EngineInfo, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let gpu = engine.gpu();
        let inner = engine.0.lock().unwrap();
        EngineInfo {
            adapters: gpu::list_adapters(inner.settings.backend),
            active: gpu.map(|g| g.adapter.clone()),
            settings: inner.settings.clone(),
            cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
            timings: inner.profiler.summary(),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Change la carte graphique, l'interface graphique ou la limite de mémoire vidéo du moteur.
#[tauri::command]
pub fn engine_configure(engine: tauri::State<'_, Engine>, settings: GpuSettings) {
    engine.configure(settings);
}

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string())
        .ok_or_else(|| format!("en-tête {name} manquant"))
}

/// Applique un réglage à des pixels RGBA. Corps : la longueur du réglage en JSON (4 octets, petit
/// boutiste), le réglage, puis les pixels bruts ; en-têtes : `x-width` et `x-height`. Renvoie les
/// pixels calculés.
#[tauri::command]
pub async fn engine_apply(
    engine: tauri::State<'_, Engine>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("pixels attendus".into());
    };
    let w: usize = header(&request, "x-width")?.parse().map_err(|_| "largeur invalide")?;
    let h: usize = header(&request, "x-height")?.parse().map_err(|_| "hauteur invalide")?;
    let (json, pixels) = split_body(body).ok_or("corps invalide")?;
    let req: Request = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    if w.checked_mul(h).and_then(|n| n.checked_mul(4)) != Some(pixels.len()) {
        return Err("taille des pixels incorrecte".into());
    }
    let mut data = pixels.to_vec();
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let gpu = engine.gpu();
        let (place, ms) = gpu::apply(gpu.as_deref(), &mut data, w, h, &req.adjustment, &req.options);
        let kind = json_kind(&json);
        let place = if place == gpu::Where::Gpu { "gpu" } else { "cpu" };
        engine.0.lock().unwrap().profiler.record(&format!("{place}:{kind}"), ms);
        tauri::ipc::Response::new(data)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Gomme magique (remplissage d'après le contenu). Corps : les pixels RGBA puis le masque du trou
/// (un octet par pixel) ; en-têtes : `x-width`, `x-height` et `x-seed`. Renvoie les pixels.
#[tauri::command]
pub async fn engine_inpaint(
    engine: tauri::State<'_, Engine>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("pixels attendus".into());
    };
    let w: usize = header(&request, "x-width")?.parse().map_err(|_| "largeur invalide")?;
    let h: usize = header(&request, "x-height")?.parse().map_err(|_| "hauteur invalide")?;
    let seed: u32 = header(&request, "x-seed")?.parse().map_err(|_| "graine invalide")?;
    let n = w.checked_mul(h).ok_or("taille incorrecte")?;
    if n.checked_mul(5) != Some(body.len()) {
        return Err("taille des pixels incorrecte".into());
    }
    let (pixels, hole) = body.split_at(n * 4);
    let (mut data, hole) = (pixels.to_vec(), hole.to_vec());
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let t = std::time::Instant::now();
        poulpe_engine::inpaint::inpaint(&mut data, w, h, &hole, 7, seed);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        engine.0.lock().unwrap().profiler.record("cpu:inpaint", ms);
        tauri::ipc::Response::new(data)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Sépare le réglage (JSON) des pixels dans le corps de la demande.
fn split_body(body: &[u8]) -> Option<(String, &[u8])> {
    let len = u32::from_le_bytes(body.get(..4)?.try_into().ok()?) as usize;
    let json = std::str::from_utf8(body.get(4..4 + len)?).ok()?.to_string();
    Some((json, &body[4 + len..]))
}

fn json_kind(json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v["adjustment"]["kind"].as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_le_corps_de_la_demande() {
        let json = br#"{"adjustment":{"kind":"levels"}}"#;
        let mut body = (json.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(json);
        body.extend_from_slice(&[1, 2, 3, 4]);
        let (j, px) = split_body(&body).unwrap();
        assert_eq!(json_kind(&j), "levels");
        assert_eq!(px, &[1, 2, 3, 4]);
        assert!(split_body(&[200, 0, 0, 0, 1]).is_none());
        assert!(split_body(&[]).is_none());
    }

    /// La commande telle que l'interface l'appelle (engine.ts) : réglage et pixels dans le corps.
    #[test]
    fn applique_un_reglage_par_la_commande() {
        let app = tauri::test::mock_builder()
            .manage(Engine::new(GpuSettings { device: gpu::GpuChoice::Cpu, ..Default::default() }))
            .invoke_handler(tauri::generate_handler![engine_apply])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        let json = br#"{"adjustment":{"kind":"invert"},"options":{"scale":1,"origin":[0,0],"frame":null}}"#;
        let mut body = (json.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(json);
        body.extend_from_slice(&[10, 20, 30, 255, 0, 0, 0, 0]);
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert("x-width", "2".parse().unwrap());
        headers.insert("x-height", "1".parse().unwrap());
        let res = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "engine_apply".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Raw(body),
                headers,
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .unwrap();
        let tauri::ipc::InvokeResponseBody::Raw(out) = res else { panic!("pixels attendus") };
        assert_eq!(out, vec![245, 235, 225, 255, 255, 255, 255, 0]);
    }

    /// La gomme magique telle que l'interface l'appelle : pixels puis masque du trou. Même
    /// résultat que le moteur WebAssembly (même code, même graine), vérifié contre une image connue.
    #[test]
    fn gomme_magique_par_la_commande() {
        let app = tauri::test::mock_builder()
            .manage(Engine::new(GpuSettings { device: gpu::GpuChoice::Cpu, ..Default::default() }))
            .invoke_handler(tauri::generate_handler![engine_inpaint])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        let (w, h) = (40usize, 30usize);
        let mut pixels: Vec<u8> = (0..w * h).flat_map(|i| [((i % w) * 6) as u8, 90, 160, 255]).collect();
        let mut hole = vec![0u8; w * h];
        for y in 12..18 {
            for x in 16..22 {
                hole[y * w + x] = 1;
                pixels[(y * w + x) * 4 + 1] = 255;
            }
        }
        let mut expected = pixels.clone();
        poulpe_engine::inpaint::inpaint(&mut expected, w, h, &hole, 7, 1234567);
        let mut body = pixels.clone();
        body.extend_from_slice(&hole);
        let call = |body: Vec<u8>| {
            let mut headers = tauri::http::HeaderMap::new();
            headers.insert("x-width", w.to_string().parse().unwrap());
            headers.insert("x-height", h.to_string().parse().unwrap());
            headers.insert("x-seed", "1234567".parse().unwrap());
            tauri::test::get_ipc_response(
                &webview,
                tauri::webview::InvokeRequest {
                    cmd: "engine_inpaint".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Raw(body),
                    headers,
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
        };
        let res = call(body.clone()).unwrap();
        let tauri::ipc::InvokeResponseBody::Raw(out) = res else { panic!("pixels attendus") };
        assert_eq!(out, expected);
        // Le trou ne garde pas le vert ajouté ; le reste ne bouge pas.
        assert_eq!(out[(14 * w + 18) * 4 + 1], 90);
        assert_eq!(out[..4], pixels[..4]);
        assert!(call(body[..body.len() - 1].to_vec()).is_err());
    }

    #[test]
    fn le_moteur_calcule_sur_le_processeur_si_demande() {
        let engine = Engine::new(GpuSettings { device: gpu::GpuChoice::Cpu, ..Default::default() });
        assert!(engine.gpu().is_none());
    }
}
