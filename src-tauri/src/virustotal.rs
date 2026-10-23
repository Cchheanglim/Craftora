//! An optional safety check of the websites links come from, with the user's own VirusTotal API
//! key (kept in Windows Credential Manager, never sent to the UI). Only the website's name is
//! looked up, never the video's link, so VirusTotal learns which sites the user fetches from but
//! not what they watch.

use std::time::Duration;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::Url;

const SERVICE: &str = "Craftora";
const ACCOUNT: &str = "virustotal-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Couldn't reach Windows Credential Manager: {e}"))
}

fn stored_key() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Couldn't read the VirusTotal key: {e}")),
    }
}

#[tauri::command]
pub fn virustotal_has_key() -> Result<bool, String> {
    Ok(stored_key()?.is_some())
}

/// Saves the key, or forgets it with `None`.
#[tauri::command]
pub fn virustotal_set_key(key: Option<String>) -> Result<(), String> {
    let entry = entry()?;
    match key.as_deref().map(str::trim) {
        Some(key) if !key.is_empty() => {
            // VirusTotal keys are 64 hexadecimal characters.
            if key.len() != 64 || !key.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err("That doesn't look like a VirusTotal API key (64 letters and numbers).".into());
            }
            entry.set_password(key).map_err(|e| format!("Couldn't save the VirusTotal key: {e}"))
        }
        _ => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Couldn't remove the VirusTotal key: {e}")),
        },
    }
}

/// What VirusTotal's security vendors say about a website.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SiteReport {
    site: String,
    malicious: u32,
    suspicious: u32,
    /// Vendors that gave a verdict; 0 when VirusTotal has no report on the site yet.
    total: u32,
}

#[derive(Deserialize)]
struct Reply {
    data: Data,
}

#[derive(Deserialize)]
struct Data {
    attributes: Attributes,
}

#[derive(Deserialize)]
struct Attributes {
    #[serde(default)]
    last_analysis_stats: Stats,
}

#[derive(Deserialize, Default)]
struct Stats {
    #[serde(default)]
    harmless: u32,
    #[serde(default)]
    malicious: u32,
    #[serde(default)]
    suspicious: u32,
    #[serde(default)]
    undetected: u32,
}

/// The website a link belongs to ("youtube.com"), or None for addresses without a name.
fn site_of(link: &str) -> Option<String> {
    let url = Url::parse(crate::signin::split_referer(link).0).ok()?;
    let host = url.domain()?.to_ascii_lowercase();
    Some(host.strip_prefix("www.").unwrap_or(&host).to_string())
}

fn report(site: String, body: &str) -> Result<SiteReport, String> {
    let stats = serde_json::from_str::<Reply>(body)
        .map_err(|e| format!("Unexpected answer from VirusTotal: {e}"))?
        .data
        .attributes
        .last_analysis_stats;
    let total = stats.harmless + stats.malicious + stats.suspicious + stats.undetected;
    Ok(SiteReport { site, malicious: stats.malicious, suspicious: stats.suspicious, total })
}

/// The VirusTotal report on the website `link` comes from; None when no key is saved or the
/// link has no website name.
#[tauri::command]
pub async fn check_site(link: String) -> Result<Option<SiteReport>, String> {
    let Some(key) = stored_key()? else {
        return Ok(None);
    };
    let Some(site) = site_of(&link) else {
        return Ok(None);
    };
    let response = reqwest::Client::new()
        .get(format!("https://www.virustotal.com/api/v3/domains/{site}"))
        .header("x-apikey", key)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach VirusTotal: {e}"))?;
    match response.status().as_u16() {
        200 => report(site, &response.text().await.map_err(|e| e.to_string())?).map(Some),
        404 => Ok(Some(SiteReport { site, malicious: 0, suspicious: 0, total: 0 })),
        401 | 403 => Err("VirusTotal didn't accept the API key. Check it under Home → Links.".into()),
        429 => Err("The VirusTotal key has used its free checks for now (about 4 a minute, 500 a day).".into()),
        code => Err(format!("VirusTotal answered with error {code}.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_website_of_a_link() {
        assert_eq!(site_of("https://www.YouTube.com/watch?v=x").as_deref(), Some("youtube.com"));
        assert_eq!(site_of("https://cdn.example/v.m3u8#craftora-referer=https://other.example/p").as_deref(), Some("cdn.example"));
        assert_eq!(site_of("http://127.0.0.1:8765/v.mp4"), None);
        assert_eq!(site_of("not a link"), None);
    }

    #[test]
    fn reads_the_vendor_counts() {
        let body = r#"{"data":{"attributes":{"last_analysis_stats":{"harmless":60,"malicious":3,"suspicious":1,"undetected":30,"timeout":0}}}}"#;
        let got = report("bad.example".into(), body).unwrap();
        assert_eq!(got, SiteReport { site: "bad.example".into(), malicious: 3, suspicious: 1, total: 94 });
    }
}
