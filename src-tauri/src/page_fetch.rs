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
    // The rest of the request (its headers) isn't needed.
    let mut line = String::new();
    while reader.read_line(&mut line)? > 2 {
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
    let (status, kind, body) = match target {
        None => (403, "text/plain".to_string(), b"Not allowed".to_vec()),
        Some(target) => match page_fetch(app, &target) {
            Ok((status, kind, body)) if body.starts_with(b"#EXTM3U") => {
                let base = Url::parse(&target).map_err(std::io::Error::other)?;
                let text = crate::media_cache::relay_playlist(&String::from_utf8_lossy(&body), &base, None, own);
                (status, kind, text.into_bytes())
            }
            Ok(fetched) => fetched,
            Err(message) => (502, "text/plain".to_string(), message.into_bytes()),
        },
    };
    write!(stream, "HTTP/1.1 {status} Relayed\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())?;
    stream.write_all(&body)
}

#[derive(Deserialize)]
struct Fetched {
    status: u16,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    error: String,
}

/// Has the page window fetch `url`: its status, content type and body.
pub(crate) fn page_fetch(app: &AppHandle, url: &str) -> Result<(u16, String, Vec<u8>), String> {
    let window = app
        .get_webview_window(crate::signin::WINDOW)
        .ok_or("Keep Craftora's window with the stream's page open while it records.")?;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let address = serde_json::to_string(url).map_err(|e| e.to_string())?;
    // The fetch runs in the page, so it carries the page's cookies; the answer waits in the page
    // (as base64) until it's collected below, since a script's answer can't wait for a download.
    window
        .eval(format!(
            r#"(() => {{
  const done = (window.__craftoraFetched ||= {{}});
  fetch({address}).then(async (r) => {{
    const bytes = new Uint8Array(await r.arrayBuffer());
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    done[{id}] = {{ status: r.status, kind: r.headers.get("content-type") || "", body: btoa(text) }};
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
        let Ok(fetched) = serde_json::from_str::<Fetched>(&json) else { continue };
        if !fetched.error.is_empty() {
            return Err(format!("The page couldn't load the stream: {}", fetched.error));
        }
        let body = crate::local::base64_decode(&fetched.body).ok_or("The page sent back something unreadable.")?;
        let kind = if fetched.kind.is_empty() { "application/octet-stream".into() } else { fetched.kind };
        return Ok((fetched.status, kind, body));
    }
    Err("The page took too long to load part of the stream.".into())
}
