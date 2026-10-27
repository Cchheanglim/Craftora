//! A short log of what fetching and previewing links did ("Copy report"), so a user can share why a
//! site fails without saying which site it is: every web address is reduced to "site 1", "site 2"…
//! and the kind of file it points at.

use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;
use std::time::Instant;

use tauri::Url;

struct Log {
    lines: VecDeque<String>,
    /// Host → its number in reports.
    sites: BTreeMap<String, usize>,
    started: Option<Instant>,
}

static LOG: Mutex<Log> = Mutex::new(Log { lines: VecDeque::new(), sites: BTreeMap::new(), started: None });
const MAX_LINES: usize = 200;

/// Adds a step to the report (web addresses are hidden here).
pub(crate) fn note(text: impl AsRef<str>) {
    let mut log = LOG.lock().unwrap();
    let started = *log.started.get_or_insert_with(Instant::now);
    let line = format!("{:>7.1}s  {}", started.elapsed().as_secs_f64(), hide_addresses(text.as_ref(), &mut log.sites));
    if log.lines.len() == MAX_LINES {
        log.lines.pop_front();
    }
    log.lines.push_back(line);
}

/// A step the editor saw (the preview player's errors).
#[tauri::command]
pub fn note_diagnostic(text: String) {
    note(text.chars().take(500).collect::<String>());
}

/// The report, for "Copy report".
#[tauri::command]
pub fn diagnostics() -> String {
    let log = LOG.lock().unwrap();
    let mut out = format!("Craftora {} report (web addresses hidden)\n", env!("CARGO_PKG_VERSION"));
    for line in &log.lines {
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn hide_addresses(text: &str, sites: &mut BTreeMap<String, usize>) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find("http://").into_iter().chain(rest.find("https://")).min() {
        out.push_str(&rest[..at]);
        let end = rest[at..].find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | ')')).map_or(rest.len(), |n| at + n);
        out.push_str(&describe(&rest[at..end], sites));
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// "https://cdn.shop.example/v/123/index.m3u8?token=…" → "[site 2 …/index.m3u8 ?…]" (file names
/// are kept only when they're the usual kinds of media names).
fn describe(address: &str, sites: &mut BTreeMap<String, usize>) -> String {
    let Ok(url) = Url::parse(address) else { return "[address]".into() };
    let next = sites.len() + 1;
    let site = *sites.entry(url.host_str().unwrap_or("").to_string()).or_insert(next);
    let name = url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("");
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).filter(|e| e.len() <= 5);
    let file = match ext.as_deref() {
        Some(e @ ("m3u8" | "mpd" | "mp4" | "m4s" | "ts" | "webm" | "mov" | "m4a" | "aac" | "mp3" | "html" | "php" | "js")) => format!(" …/*.{e}"),
        Some(_) => " …/(other file)".into(),
        None if name.is_empty() => String::new(),
        None => " …/(no file type)".into(),
    };
    let query = if url.query().is_some() { " ?…" } else { "" };
    format!("[site {site}{file}{query}]")
}

#[cfg(test)]
mod tests {
    use super::hide_addresses;
    use std::collections::BTreeMap;

    #[test]
    fn hides_every_address() {
        let mut sites = BTreeMap::new();
        let text = "Got 403 at https://shop.example/watch?id=9 for https://cdn.example/v/index.m3u8?t=x and https://shop.example/a.mp4.";
        let hidden = hide_addresses(text, &mut sites);
        assert_eq!(hidden, "Got 403 at [site 1 …/(no file type) ?…] for [site 2 …/*.m3u8 ?…] and [site 1 …/(other file)]");
        assert!(!hidden.contains("example"));
    }
}
