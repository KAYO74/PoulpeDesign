//! Connexion aux IA (Préférences > IA) : clés API rangées dans le trousseau du système
//! (Trousseau macOS, Gestionnaire d'identification Windows, Secret Service sous Linux), jamais
//! dans un fichier ni dans l'interface, et requêtes envoyées par Rust (pas de blocage CORS).
//!
//! Une clé n'est ajoutée qu'aux requêtes vers l'adresse enregistrée avec elle : on ne peut pas
//! l'envoyer ailleurs, même par erreur.

use base64::Engine;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "Poulpe Design IA";

/// Contenu d'une entrée du trousseau : la clé et l'adresse du fournisseur.
#[derive(Serialize, Deserialize)]
struct Secret {
    url: String,
    key: String,
}

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, id).map_err(|e| e.to_string())
}

fn read_secret(id: &str) -> Option<Secret> {
    serde_json::from_str(&entry(id).ok()?.get_password().ok()?).ok()
}

/// Enregistre la clé d'un fournisseur, liée à son adresse.
#[tauri::command]
pub fn ai_key_set(id: String, url: String, key: String) -> Result<(), String> {
    let secret = serde_json::to_string(&Secret { url, key }).map_err(|e| e.to_string())?;
    entry(&id)?.set_password(&secret).map_err(|e| e.to_string())
}

/// Vrai si une clé est enregistrée pour ce fournisseur (la clé elle-même ne quitte pas Rust).
#[tauri::command]
pub fn ai_key_has(id: String) -> bool {
    read_secret(&id).is_some()
}

#[tauri::command]
pub fn ai_key_delete(id: String) -> Result<(), String> {
    match entry(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Où placer la clé dans la requête.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyUse {
    id: String,
    /// En-tête (`Authorization`, `x-api-key`…) ; `prefix` est ajouté devant (`Bearer `).
    header: String,
    #[serde(default)]
    prefix: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    key: Option<KeyUse>,
    /// Réponse en base64 (images téléchargées).
    #[serde(default)]
    binary: bool,
}

#[derive(Serialize)]
pub struct AiResponse {
    status: u16,
    body: String,
}

/// La clé n'accompagne que les requêtes vers l'adresse enregistrée avec elle.
fn same_origin(saved: &str, url: &str) -> bool {
    let saved = saved.trim_end_matches('/');
    url == saved || url.starts_with(&format!("{saved}/")) || url.starts_with(&format!("{saved}?"))
}

#[tauri::command]
pub async fn ai_fetch(req: AiRequest) -> Result<AiResponse, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(req.method.as_deref().unwrap_or("GET").as_bytes())
        .map_err(|e| e.to_string())?;
    let mut builder = client.request(method, &req.url);
    for (name, value) in &req.headers {
        builder = builder.header(name, value);
    }
    if let Some(k) = &req.key {
        let secret = read_secret(&k.id).ok_or("clé API introuvable")?;
        if !same_origin(&secret.url, &req.url) {
            return Err("adresse différente de celle du fournisseur".into());
        }
        builder = builder.header(&k.header, format!("{}{}", k.prefix, secret.key));
    }
    if let Some(body) = req.body {
        builder = builder.header("content-type", "application/json").body(body);
    }
    let res = builder.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let body = if req.binary {
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(AiResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::same_origin;

    #[test]
    fn la_cle_ne_part_que_vers_son_adresse() {
        let saved = "https://api.openai.com/v1";
        assert!(same_origin(saved, "https://api.openai.com/v1/chat/completions"));
        assert!(same_origin("https://api.openai.com/v1/", "https://api.openai.com/v1/models"));
        assert!(!same_origin(saved, "https://api.openai.com/v10/models"));
        assert!(!same_origin(saved, "https://api.openai.com.evil.example/v1/models"));
        assert!(!same_origin(saved, "https://evil.example/?https://api.openai.com/v1"));
    }
}
