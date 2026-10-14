//! The AI editing assistant's link to Google's Gemini API. The API key is kept in Windows
//! Credential Manager and never sent to the UI; the UI builds each request (see
//! `src/assistant/`) and this module adds the key and sends it.

use std::time::Duration;

use keyring::Entry;
use serde_json::Value;

const SERVICE: &str = "Craftora";
const ACCOUNT: &str = "gemini-api-key";
const ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/interactions";

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

/// Sends one Interactions API request and returns Gemini's answer as JSON.
#[tauri::command]
pub async fn assistant_request(body: Value) -> Result<Value, String> {
    let key = stored_key()?.ok_or("Add your Gemini API key first.")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(ENDPOINT)
        .header("x-goog-api-key", key)
        .json(&body)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "Gemini took too long to answer.".into() } else { format!("Couldn't reach Gemini: {e}") })?;
    let status = response.status();
    let answer: Value = response.json().await.map_err(|e| format!("Unexpected answer from Gemini: {e}"))?;
    if !status.is_success() {
        let detail = answer["error"]["message"].as_str().unwrap_or("no details");
        return Err(match status.as_u16() {
            400 if detail.contains("API key") => "Gemini didn't accept the API key. Check it in the assistant's settings.".into(),
            401 | 403 => format!("Gemini refused the request: {detail}"),
            429 => "Gemini's usage limit was reached. Wait a minute, or check your plan in Google AI Studio.".into(),
            _ => format!("Gemini error {status}: {detail}"),
        });
    }
    Ok(answer)
}
