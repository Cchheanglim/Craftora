//! The AI editing assistant's link to Google's Gemini API. The API key is kept in Windows
//! Credential Manager and never sent to the UI; the UI builds each `generateContent` request
//! (see `src/assistant/`) and this module adds the key and sends it.

use std::time::Duration;

use keyring::Entry;
use serde::Serialize;
use serde_json::Value;

const SERVICE: &str = "Craftora";
const ACCOUNT: &str = "gemini-api-key";
const API: &str = "https://generativelanguage.googleapis.com/v1beta";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Couldn't reach Windows Credential Manager: {e}"))
}

fn stored_key() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Couldn't read the API key: {e}")),
    }
}

/// Whether an API key has been saved.
#[tauri::command]
pub fn assistant_has_key() -> Result<bool, String> {
    Ok(stored_key()?.is_some())
}

/// Saves the API key, or forgets it with `None`.
#[tauri::command]
pub fn assistant_set_key(key: Option<String>) -> Result<(), String> {
    let entry = entry()?;
    match key.as_deref().map(str::trim) {
        Some(key) if !key.is_empty() => {
            if key.len() > 200 || key.chars().any(char::is_whitespace) {
                return Err("That doesn't look like an API key.".into());
            }
            entry.set_password(key).map_err(|e| format!("Couldn't save the API key: {e}"))
        }
        _ => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Couldn't remove the API key: {e}")),
        },
    }
}

async fn call(request: reqwest::RequestBuilder) -> Result<Value, String> {
    let key = stored_key()?.ok_or("Add your Gemini API key first.")?;
    let response = request
        .header("x-goog-api-key", key)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "Gemini took too long to answer.".into() } else { format!("Couldn't reach Gemini: {e}") })?;
    let status = response.status();
    let answer: Value = response.json().await.map_err(|e| format!("Unexpected answer from Gemini: {e}"))?;
    if !status.is_success() {
        // "HTTP <code>: <Google's message>": the UI tells busy servers, plan limits and bad
        // keys apart by the code and words its own message.
        let detail = answer["error"]["message"].as_str().unwrap_or("no details");
        return Err(format!("HTTP {}: {detail}", status.as_u16()));
    }
    Ok(answer)
}

#[derive(Serialize)]
pub struct ModelInfo {
    /// e.g. "gemini-3.8-flash"
    id: String,
    label: String,
}

/// The Gemini models this key can use for chat with tools, newest first as Google lists them.
#[tauri::command]
pub async fn assistant_models() -> Result<Vec<ModelInfo>, String> {
    let client = crate::privacy::client_builder().build().map_err(|e| e.to_string())?;
    let answer = call(client.get(format!("{API}/models?pageSize=200"))).await?;
    // Image, speech, embedding and live-audio models can't run the editing tools.
    let unsuitable = ["embedding", "image", "tts", "audio", "live", "aqa", "banana", "veo", "imagen"];
    let models = answer["models"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter(|m| {
                    m["supportedGenerationMethods"].as_array().is_some_and(|methods| methods.iter().any(|x| x == "generateContent"))
                })
                .filter_map(|m| {
                    let id = m["name"].as_str()?.strip_prefix("models/")?.to_string();
                    let ok = id.starts_with("gemini") && !unsuitable.iter().any(|word| id.contains(word));
                    ok.then(|| ModelInfo { label: m["displayName"].as_str().unwrap_or(&id).to_string(), id })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(models)
}

/// Sends one `generateContent` request to `model` and returns Gemini's answer as JSON.
#[tauri::command]
pub async fn assistant_generate(model: String, body: Value) -> Result<Value, String> {
    let valid = !model.is_empty() && model.len() <= 100 && model.chars().all(|c| c.is_ascii_alphanumeric() || "-._".contains(c));
    if !valid {
        return Err("That isn't a Gemini model name.".into());
    }
    let client = crate::privacy::client_builder().build().map_err(|e| e.to_string())?;
    call(client.post(format!("{API}/models/{model}:generateContent")).json(&body)).await
}
