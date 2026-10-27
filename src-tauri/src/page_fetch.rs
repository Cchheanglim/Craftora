//! Lets FFmpeg record a stream from a site whose bot check (Cloudflare's) only lets browsers in:
//! FFmpeg reads it from a small web server on this PC, which has Craftora's page window (the
//! sign-in window, which passed the check) fetch each address, with its cookies and its
//! browser's connection. Stream playlists come back with every address pointing here again.
//! The server listens on 127.0.0.1 only, under a secret path, so other programs can't use it to
//! reach sites as the user.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager, Url};

/// `http://127.0.0.1:<port>/<secret>/get` once the server runs.
static SERVER: Mutex<Option<String>> = Mutex::new(None);

/// The address FFmpeg should read `url` from.
pub(crate) fn relayed(app: &AppHandle, url: &str) -> Result<String, String> {
    let base = {
        let mut server = SERVER.lock().unwrap();
        match server.as_ref() {
            Some(base) => base.clone(),
            None => server.insert(start(app)?).clone(),
        }
    };
    Url::parse_with_params(&base, &[("u", url)]).map(|u| u.to_string()).map_err(|e| e.to_string())
}

fn start(app: &AppHandle) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Couldn't start the stream relay: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let secret = format!("{:016x}{:016x}", RandomState::new().build_hasher().finish(), RandomState::new().build_hasher().finish());
    let base = format!("http://127.0.0.1:{port}/{secret}/get");
    let (app, own) = (app.clone(), base.clone());
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (app, own) = (app.clone(), own.clone());
            std::thread::spawn(move || {
                let _ = answer(&app, stream, &own);
            });
        }
    });
    Ok(base)
}

fn answer(app: &AppHandle, mut stream: TcpStream, own: &str) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request = String::new();
    reader.read_line(&mut request)?;
    // Of the headers, only Range matters: one piece of a file (playlists that point into one big file).
    let (mut line, mut range) = (String::new(), None);
    while reader.read_line(&mut line)? > 2 {
        if let Some((name, value)) = line.split_once(':')
            && name.eq_ignore_ascii_case("range")
        {
            range = Some(value.trim().to_string());
        }
        line.clear();
    }
    let path = own.trim_start_matches("http://").split_once('/').map_or("", |(_, p)| p);
    let target = request
        .split_whitespace()
        .nth(1)
        .and_then(|asked| asked.strip_prefix('/')?.strip_prefix(path)?.strip_prefix('?').map(str::to_string))
        .and_then(|query| Url::parse(&format!("http://relay/?{query}")).ok())
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "u").map(|(_, v)| v.into_owned()))
        .filter(|t| t.starts_with("https://") || t.starts_with("http://"));
    let refused = |status, message: &[u8]| Fetched { status, kind: "text/plain".into(), range: None, body: message.to_vec() };
    let answer = match target {
        None => refused(403, b"Not allowed"),
        Some(target) => match page_fetch(app, &target, range.as_deref()) {
            Ok(mut fetched) if fetched.body.starts_with(b"#EXTM3U") => {
                let base = Url::parse(&target).map_err(std::io::Error::other)?;
                fetched.body = crate::media_cache::relay_playlist(&String::from_utf8_lossy(&fetched.body), &base, None, own).into_bytes();
                fetched
            }
            Ok(fetched) => fetched,
            Err(message) => refused(502, message.as_bytes()),
        },
    };
    let piece = answer.range.as_deref().map_or(String::new(), |r| format!("Content-Range: {r}\r\n"));
    write!(
        stream,
        "HTTP/1.1 {} Relayed\r\nContent-Type: {}\r\n{piece}Content-Length: {}\r\nConnection: close\r\n\r\n",
        answer.status,
        answer.kind,
        answer.body.len()
    )?;
    stream.write_all(&answer.body)
}

/// What the page window got back.
pub(crate) struct Fetched {
    pub(crate) status: u16,
    pub(crate) kind: String,
    /// `Content-Range` of a piece (status 206).
    pub(crate) range: Option<String>,
    pub(crate) body: Vec<u8>,
}

#[derive(Deserialize)]
struct PageAnswer {
    status: u16,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    range: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    error: String,
}

/// Opens the page window again (minimized) on the page it last fetched from, after it was closed,
/// and waits for the page to load and get past the site's bot check.
fn reopen(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());
    let _turn = ONE_AT_A_TIME.lock().unwrap();
    if let Some(window) = app.get_webview_window(crate::signin::WINDOW) {
        return Ok(window);
    }
    let page = crate::signin::last_page().ok_or("Open the video's page in Craftora again and click Fetch this video.")?;
    tauri::async_runtime::block_on(crate::signin::open_sign_in(app.clone(), page))?;
    let window = app.get_webview_window(crate::signin::WINDOW).ok_or("Couldn't open the video's page again.")?;
    let _ = window.minimize();
    // Cloudflare's check page is titled "Just a moment..." until it lets the browser through.
    let ready = r#"document.readyState === "complete" && !/just a moment/i.test(document.title)"#;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(300));
        let (tx, rx) = mpsc::channel();
        window
            .eval_with_callback(ready, move |json| {
                let _ = tx.send(json);
            })
            .map_err(|e| e.to_string())?;
        if rx.recv_timeout(Duration::from_secs(10)).is_ok_and(|json| json == "true") {
            return Ok(window);
        }
    }
    Err("The video's page took too long to open again.".into())
}

/// Has the page window fetch `url`, or with `range` ("bytes=a-b") just that piece of it.
pub(crate) fn page_fetch(app: &AppHandle, url: &str, range: Option<&str>) -> Result<Fetched, String> {
    let window = match app.get_webview_window(crate::signin::WINDOW) {
        Some(window) => window,
        None => reopen(app)?,
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let address = serde_json::to_string(url).map_err(|e| e.to_string())?;
    let piece = match range.filter(|r| r.starts_with("bytes=")) {
        Some(r) => format!(", {{ headers: {{ Range: {} }} }}", serde_json::to_string(r).map_err(|e| e.to_string())?),
        None => String::new(),
    };
    // The fetch runs in the page, so it carries the page's cookies; the answer waits in the page
    // (as base64) until it's collected below, since a script's answer can't wait for a download.
    window
        .eval(format!(
            r#"(() => {{
  const done = (window.__craftoraFetched ||= {{}});
  fetch({address}{piece}).then(async (r) => {{
    const bytes = new Uint8Array(await r.arrayBuffer());
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    done[{id}] = {{ status: r.status, kind: r.headers.get("content-type") || "", range: r.headers.get("content-range") || "", body: btoa(text) }};
  }}, (e) => (done[{id}] = {{ status: 502, error: String(e) }}));
}})()"#
        ))
        .map_err(|e| e.to_string())?;
    let collect = format!("(() => {{ const r = window.__craftoraFetched?.[{id}]; if (r) delete window.__craftoraFetched[{id}]; return r ?? null; }})()");
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
        let (tx, rx) = mpsc::channel();
        window
            .eval_with_callback(collect.clone(), move |json| {
                let _ = tx.send(json);
            })
            .map_err(|e| e.to_string())?;
        let json = rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "The page window stopped answering.".to_string())?;
        let Ok(answer) = serde_json::from_str::<PageAnswer>(&json) else { continue };
        if !answer.error.is_empty() {
            return Err(format!("The page couldn't load the stream: {}", answer.error));
        }
        let body = crate::local::base64_decode(&answer.body).ok_or("The page sent back something unreadable.")?;
        let kind = if answer.kind.is_empty() { "application/octet-stream".into() } else { answer.kind };
        // A site that doesn't let pages read Content-Range: rebuild it from the piece asked for.
        let range = match (answer.status, answer.range.is_empty()) {
            (206, false) => Some(answer.range),
            (206, true) => range.and_then(|r| piece_range(r, body.len())),
            _ => None,
        };
        return Ok(Fetched { status: answer.status, kind, range, body });
    }
    Err("The page took too long to load part of the stream.".into())
}

/// "bytes=100-" and a 50-byte answer → "bytes 100-149/*".
fn piece_range(asked: &str, len: usize) -> Option<String> {
    let start: usize = asked.strip_prefix("bytes=")?.split('-').next()?.trim().parse().ok()?;
    (len > 0).then(|| format!("bytes {start}-{}/*", start + len - 1))
}

#[cfg(test)]
mod tests {
    use super::piece_range;

    #[test]
    fn rebuilds_a_piece_range() {
        assert_eq!(piece_range("bytes=100-149", 50).as_deref(), Some("bytes 100-149/*"));
        assert_eq!(piece_range("bytes=0-", 10).as_deref(), Some("bytes 0-9/*"));
        assert_eq!(piece_range("bytes=5-", 0), None);
    }
}
