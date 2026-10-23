//! "Is this link safe?": asks VirusTotal what security vendors say about the website a link
//! comes from. Only the website's name is looked up, never the video's link.
//!
//! The VirusTotal key is the project's own, added at build time from the `CRAFTORA_VT_KEY`
//! environment variable (a GitHub secret in the release build), so it's never in the source.
//! shortcut: a key built into the app can be extracted from it, and its free allowance (about
//! 4 checks a minute, 500 a day) is shared by every user; move it behind a small server if
//! either becomes a problem.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Url;

const KEY: Option<&str> = option_env!("CRAFTORA_VT_KEY");

fn key() -> Option<&'static str> {
    KEY.filter(|k| !k.trim().is_empty())
}

/// Whether this copy of Craftora was built with a VirusTotal key.
#[tauri::command]
pub fn site_check_available() -> bool {
    key().is_some()
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

/// The VirusTotal report on the website `link` comes from.
#[tauri::command]
pub async fn check_site(link: String) -> Result<SiteReport, String> {
    let key = key().ok_or("Website checks aren't set up in this copy of Craftora.")?;
    let site = site_of(link.trim()).ok_or("That doesn't look like a link to a website. Paste one starting with https://")?;
    let response = reqwest::Client::new()
        .get(format!("https://www.virustotal.com/api/v3/domains/{site}"))
        .header("x-apikey", key)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach VirusTotal: {e}"))?;
    match response.status().as_u16() {
        200 => report(site, &response.text().await.map_err(|e| e.to_string())?),
        404 => Ok(SiteReport { site, malicious: 0, suspicious: 0, total: 0 }),
        429 => Err("Lots of people are checking links right now. Try again in a minute.".into()),
        code => Err(format!("The website check isn't working right now (VirusTotal error {code}).")),
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
