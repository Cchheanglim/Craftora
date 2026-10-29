//! The AI editing assistant's link to the user's own AI: Google Gemini, OpenAI (ChatGPT) or
//! Anthropic (Claude). Each API key is kept in Windows Credential Manager and never sent to the UI;
//! the UI builds each request in its provider's shape (see `src/assistant/providers.ts`) and this
//! module adds the key and sends it, only ever to that provider's fixed HTTPS address.

use std::time::Duration;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SERVICE: &str = "Craftora";

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Gemini,
    Openai,
    Anthropic,
}

impl Provider {
    /// Its entry in Credential Manager.
    fn account(self) -> &'static str {
        match self {
            Provider::Gemini => "gemini-api-key",
            Provider::Openai => "openai-api-key",
            Provider::Anthropic => "anthropic-api-key",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Provider::Gemini => "Gemini",
            Provider::Openai => "OpenAI",
            Provider::Anthropic => "Claude",
        }
    }

    /// The only addresses a key is sent to. Fixed here, never taken from the UI, so a page that
    /// somehow ran code in the window still couldn't send a key anywhere else.
    fn models_url(self) -> &'static str {
        match self {
            Provider::Gemini => "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
            Provider::Openai => "https://api.openai.com/v1/models",
            Provider::Anthropic => "https://api.anthropic.com/v1/models?limit=100",
        }
    }

    fn generate_url(self, model: &str) -> String {
        match self {
            Provider::Gemini => format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"),
            Provider::Openai => "https://api.openai.com/v1/chat/completions".into(),
            Provider::Anthropic => "https://api.anthropic.com/v1/messages".into(),
        }
    }

    fn authorize(self, request: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
        match self {
            Provider::Gemini => request.header("x-goog-api-key", key),
            Provider::Openai => request.bearer_auth(key),
            Provider::Anthropic => request.header("x-api-key", key).header("anthropic-version", "2023-06-01"),
        }
    }
}

fn entry(provider: Provider) -> Result<Entry, String> {
    Entry::new(SERVICE, provider.account()).map_err(|e| format!("Couldn't reach Windows Credential Manager: {e}"))
}

fn stored_key(provider: Provider) -> Result<Option<String>, String> {
    match entry(provider)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Couldn't read the API key: {e}")),
    }
}

/// Whether an API key has been saved for `provider`.
#[tauri::command]
pub fn assistant_has_key(provider: Provider) -> Result<bool, String> {
    Ok(stored_key(provider)?.is_some())
}

/// Saves the API key for `provider`, or forgets it with `None`.
#[tauri::command]
pub fn assistant_set_key(provider: Provider, key: Option<String>) -> Result<(), String> {
    let entry = entry(provider)?;
    match key.as_deref().map(str::trim) {
        Some(key) if !key.is_empty() => {
            if !looks_like_key(key) {
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

/// Keys are printable ASCII without spaces: anything else (a pasted sentence, line breaks that
/// would add HTTP headers) is refused before it's stored or sent.
fn looks_like_key(key: &str) -> bool {
    (10..=300).contains(&key.len()) && key.chars().all(|c| c.is_ascii_graphic())
}

async fn call(provider: Provider, request: reqwest::RequestBuilder) -> Result<Value, String> {
    let name = provider.name();
    let key = stored_key(provider)?.ok_or_else(|| format!("Add your {name} API key first."))?;
    let response = provider
        .authorize(request, &key)
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| if e.is_timeout() { format!("{name} took too long to answer.") } else { format!("Couldn't reach {name}: {e}") })?;
    let status = response.status();
    let answer: Value = response.json().await.map_err(|e| format!("Unexpected answer from {name}: {e}"))?;
    if !status.is_success() {
        // "HTTP <code>: <the provider's message>": the UI tells busy servers, plan limits and bad
        // keys apart by the code and words its own message. A provider may quote the key back.
        let detail = answer["error"]["message"].as_str().unwrap_or("no details").replace(&key, "[your key]");
        return Err(format!("HTTP {}: {detail}", status.as_u16()));
    }
    Ok(answer)
}

#[derive(Serialize)]
pub struct ModelInfo {
    /// e.g. "gemini-3.8-flash", "gpt-5", "claude-opus-5"
    id: String,
    label: String,
}

/// The chat models `provider`'s key can use, as the provider lists them.
#[tauri::command]
pub async fn assistant_models(provider: Provider) -> Result<Vec<ModelInfo>, String> {
    let client = crate::privacy::client_builder().build().map_err(|e| e.to_string())?;
    let answer = call(provider, client.get(provider.models_url())).await?;
    Ok(chat_models(provider, &answer))
}

fn chat_models(provider: Provider, answer: &Value) -> Vec<ModelInfo> {
    let list = |field: &str| answer[field].as_array().cloned().unwrap_or_default();
    match provider {
        Provider::Gemini => {
            // Image, speech, embedding and live-audio models can't run the editing tools.
            let unsuitable = ["embedding", "image", "tts", "audio", "live", "aqa", "banana", "veo", "imagen"];
            list("models")
                .iter()
                .filter(|m| m["supportedGenerationMethods"].as_array().is_some_and(|methods| methods.iter().any(|x| x == "generateContent")))
                .filter_map(|m| {
                    let id = m["name"].as_str()?.strip_prefix("models/")?.to_string();
                    let ok = id.starts_with("gemini") && !unsuitable.iter().any(|word| id.contains(word));
                    ok.then(|| ModelInfo { label: m["displayName"].as_str().unwrap_or(&id).to_string(), id })
                })
                .collect()
        }
        Provider::Openai => {
            // OpenAI lists every kind of model; only GPT and o-series chat models take tools.
            let unsuitable = ["audio", "realtime", "tts", "transcribe", "image", "search", "instruct", "embedding", "moderation"];
            let mut models: Vec<ModelInfo> = list("data")
                .iter()
                .filter_map(|m| m["id"].as_str())
                .filter(|id| {
                    let chat = id.starts_with("gpt-") || (id.starts_with('o') && id.chars().nth(1).is_some_and(|c| c.is_ascii_digit()));
                    chat && !unsuitable.iter().any(|word| id.contains(word))
                })
                .map(|id| ModelInfo { id: id.to_string(), label: id.to_string() })
                .collect();
            models.sort_by(|a, b| b.id.cmp(&a.id));
            models
        }
        Provider::Anthropic => list("data")
            .iter()
            .filter_map(|m| {
                let id = m["id"].as_str()?.to_string();
                Some(ModelInfo { label: m["display_name"].as_str().unwrap_or(&id).to_string(), id })
            })
            .collect(),
    }
}

/// Sends one request (already in `provider`'s shape) to `model` and returns the answer as JSON.
#[tauri::command]
pub async fn assistant_generate(provider: Provider, model: String, body: Value) -> Result<Value, String> {
    // The model goes into Gemini's address, so nothing but a plain name may reach it.
    let valid = !model.is_empty() && model.len() <= 100 && model.chars().all(|c| c.is_ascii_alphanumeric() || "-._:".contains(c));
    if !valid {
        return Err("That isn't a model name.".into());
    }
    let client = crate::privacy::client_builder().build().map_err(|e| e.to_string())?;
    let mut request = client.post(provider.generate_url(&model)).json(&body);
    // Claude's server-side fallback (a declined request re-runs on another Claude model) is a beta.
    if matches!(provider, Provider::Anthropic) && body.get("fallbacks").is_some() {
        request = request.header("anthropic-beta", "server-side-fallback-2026-07-01");
    }
    call(provider, request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_keys_that_could_add_headers() {
        assert!(looks_like_key("sk-proj-abcDEF123_-xyz"));
        assert!(!looks_like_key("sk-abc\r\nX-Evil: 1"));
        assert!(!looks_like_key("my key is sk-abc"));
        assert!(!looks_like_key("short"));
    }

    #[test]
    fn keeps_only_chat_models() {
        let openai = serde_json::json!({ "data": [{ "id": "gpt-5" }, { "id": "o4-mini" }, { "id": "gpt-4o-realtime-preview" }, { "id": "text-embedding-3-small" }, { "id": "dall-e-3" }] });
        let ids: Vec<String> = chat_models(Provider::Openai, &openai).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["o4-mini", "gpt-5"]);
        let claude = serde_json::json!({ "data": [{ "id": "claude-opus-5", "display_name": "Claude Opus 5" }] });
        assert_eq!(chat_models(Provider::Anthropic, &claude)[0].label, "Claude Opus 5");
    }
}
