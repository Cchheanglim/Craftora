//! "Is this link safe?": asks VirusTotal what security vendors say about the website a link
//! comes from. Only the website's name is looked up, never the video's link.
//!
//! The key is the user's own free VirusTotal key (Settings → Links), kept in Windows Credential
//! Manager like the AI keys. A copy built with `CRAFTORA_VT_KEY` (the owner's `.env`) falls back
//! to that one when no key is saved.

use std::collections::BTreeMap;
use std::time::Duration;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::Url;

const BUILT_IN: Option<&str> = option_env!("CRAFTORA_VT_KEY");

fn entry() -> Result<Entry, String> {
    Entry::new("Craftora", "virustotal").map_err(|e| format!("Couldn't reach Windows Credential Manager: {e}"))
}

fn own_key() -> Option<String> {
    entry().ok()?.get_password().ok()
}

fn key() -> Option<String> {
    own_key().or_else(|| BUILT_IN.map(str::trim).filter(|k| !k.is_empty()).map(String::from))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteChecks {
    /// A key is there (the user's or a built-in one): links can be checked.
    available: bool,
    /// The user saved their own key (Settings shows Remove).
    own_key: bool,
}

#[tauri::command]
pub fn site_check_available() -> SiteChecks {
    SiteChecks { available: key().is_some(), own_key: own_key().is_some() }
}

/// Saves the user's VirusTotal key once VirusTotal accepts it, or forgets it with `None`.
#[tauri::command]
pub async fn set_site_check_key(key: Option<String>) -> Result<(), String> {
    let Some(pasted) = key.filter(|k| !k.trim().is_empty()) else {
        return match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Couldn't remove the VirusTotal key: {e}")),
        };
    };
    let key = clean_key(&pasted)?;
    match lookup("virustotal.com", &key).await?.status().as_u16() {
        401 | 403 => Err("VirusTotal didn't accept that key. Copy it again from virustotal.com (your name → API key).".into()),
        _ => entry()?.set_password(&key).map_err(|e| format!("Couldn't save the VirusTotal key: {e}")),
    }
}

/// The key in what was pasted, without the spaces, quotes or a name in front that copying brings
/// along. VirusTotal keys are 64 letters and digits (hex), so nothing else gets through.
fn clean_key(pasted: &str) -> Result<String, String> {
    let kept: String = pasted.chars().filter(|c| !c.is_whitespace() && !matches!(c, '"' | '\'' | '`' | '\u{200B}'..='\u{200D}' | '\u{2060}' | '\u{FEFF}')).collect();
    let key = kept.rsplit([':', '=']).next().unwrap_or_default();
    if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(key.to_string())
    } else {
        Err("That isn't a VirusTotal API key: it's 64 letters and digits. Copy the whole key from virustotal.com (your name → API key).".into())
    }
}

/// What VirusTotal knows about a website.
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SiteReport {
    site: String,
    malicious: u32,
    suspicious: u32,
    /// Vendors that gave a verdict; 0 when VirusTotal has no report on the site yet.
    total: u32,
    /// The vendors that flag the site, and what they call it ("phishing", "malware"…).
    flagged_by: Vec<Flag>,
    /// What kind of site it is, per the vendors that sort sites ("video sharing"…).
    categories: Vec<String>,
    /// VirusTotal's community score: below 0 means people found it harmful.
    reputation: i64,
    votes_safe: u32,
    votes_dangerous: u32,
    /// When it was last scanned, in seconds since 1970.
    scanned_at: Option<i64>,
    /// The full report on VirusTotal's website.
    report_url: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Flag {
    vendor: String,
    verdict: String,
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
    #[serde(default)]
    last_analysis_results: BTreeMap<String, VendorResult>,
    #[serde(default)]
    categories: BTreeMap<String, String>,
    #[serde(default)]
    reputation: i64,
    #[serde(default)]
    total_votes: Votes,
    last_analysis_date: Option<i64>,
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

#[derive(Deserialize)]
struct VendorResult {
    #[serde(default)]
    category: String,
    result: Option<String>,
}

#[derive(Deserialize, Default)]
struct Votes {
    #[serde(default)]
    harmless: u32,
    #[serde(default)]
    malicious: u32,
}

/// The website a link belongs to ("youtube.com"), or None for addresses without a name.
fn site_of(link: &str) -> Option<String> {
    let url = Url::parse(crate::signin::split_referer(link).0).ok()?;
    let host = url.domain()?.to_ascii_lowercase();
    Some(host.strip_prefix("www.").unwrap_or(&host).to_string())
}

fn report(site: String, body: &str) -> Result<SiteReport, String> {
    let a = serde_json::from_str::<Reply>(body).map_err(|e| format!("Unexpected answer from VirusTotal: {e}"))?.data.attributes;
    let stats = a.last_analysis_stats;
    let flagged_by = a
        .last_analysis_results
        .into_iter()
        .filter(|(_, r)| r.category == "malicious" || r.category == "suspicious")
        .map(|(vendor, r)| Flag { vendor, verdict: r.result.filter(|v| !v.is_empty()).unwrap_or(r.category) })
        .collect();
    let mut categories: Vec<String> = a.categories.into_values().map(|c| c.to_lowercase()).collect();
    categories.sort();
    categories.dedup();
    Ok(SiteReport {
        report_url: report_url(&site),
        site,
        malicious: stats.malicious,
        suspicious: stats.suspicious,
        total: stats.harmless + stats.malicious + stats.suspicious + stats.undetected,
        flagged_by,
        categories,
        reputation: a.reputation,
        votes_safe: a.total_votes.harmless,
        votes_dangerous: a.total_votes.malicious,
        scanned_at: a.last_analysis_date,
    })
}

fn report_url(site: &str) -> String {
    format!("https://www.virustotal.com/gui/domain/{site}")
}

/// The VirusTotal report on the website `link` comes from.
#[tauri::command]
pub async fn check_site(link: String) -> Result<SiteReport, String> {
    let key = key().ok_or("Add your free VirusTotal API key in Settings → Links to check links.")?;
    let site = site_of(link.trim()).ok_or("That doesn't look like a link to a website. Paste one starting with https://")?;
    let response = lookup(&site, &key).await?;
    match response.status().as_u16() {
        200 => report(site, &response.text().await.map_err(|e| e.to_string())?),
        404 => Ok(SiteReport { report_url: report_url(&site), site, ..Default::default() }),
        401 | 403 => Err("VirusTotal didn't accept the key. Add it again in Settings → Links.".into()),
        429 => Err("Too many checks for now: VirusTotal's free key allows about 4 a minute and 500 a day. Try again in a minute.".into()),
        code => Err(format!("The website check isn't working right now (VirusTotal error {code}).")),
    }
}

/// Asks VirusTotal about `site` with `key`.
async fn lookup(site: &str, key: &str) -> Result<reqwest::Response, String> {
    crate::media_cache::client()
        .get(format!("https://www.virustotal.com/api/v3/domains/{site}"))
        .header("x-apikey", key)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach VirusTotal: {e}"))
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
    fn reads_the_report() {
        let body = r#"{"data":{"attributes":{
            "last_analysis_stats":{"harmless":60,"malicious":2,"suspicious":1,"undetected":30,"timeout":0},
            "last_analysis_results":{
                "Fortinet":{"category":"malicious","result":"phishing"},
                "Kaspersky":{"category":"suspicious","result":""},
                "Sophos":{"category":"harmless","result":"clean"},
                "Webroot":{"category":"malicious","result":"malware"}},
            "categories":{"Forcepoint ThreatSeeker":"Video Sharing","alphaMountain.ai":"video sharing","BitDefender":"entertainment"},
            "reputation":-12,
            "total_votes":{"harmless":4,"malicious":9},
            "last_analysis_date":1761100000}}}"#;
        let got = report("bad.example".into(), body).unwrap();
        assert_eq!(got.total, 93);
        assert_eq!(
            got.flagged_by,
            vec![
                Flag { vendor: "Fortinet".into(), verdict: "phishing".into() },
                Flag { vendor: "Kaspersky".into(), verdict: "suspicious".into() },
                Flag { vendor: "Webroot".into(), verdict: "malware".into() },
            ]
        );
        assert_eq!(got.categories, vec!["entertainment".to_string(), "video sharing".to_string()]);
        assert_eq!((got.reputation, got.votes_safe, got.votes_dangerous, got.scanned_at), (-12, 4, 9, Some(1761100000)));
        assert_eq!(got.report_url, "https://www.virustotal.com/gui/domain/bad.example");
    }

    #[test]
    fn keeps_only_a_real_key_from_what_was_pasted() {
        let key = "0123456789abcdef".repeat(4);
        assert_eq!(clean_key(&key).unwrap(), key);
        assert_eq!(clean_key(&format!(" \"x-apikey: {key}\"\n")).unwrap(), key);
        assert!(clean_key(&key[..63]).is_err());
        assert!(clean_key(&format!("{}z", &key[..63])).is_err());
        assert!(clean_key(&format!("{key}\r\nX-Other: 1")).is_err());
    }
}
