//! Signing in to websites, for links that need a login (age-restricted, private, members-only).
//! Logins are made in Craftora's own sign-in window, which shares the app's WebView2 cookie
//! store, and reach yt-dlp as a temporary cookie file. (Borrowing a browser's logins needed that
//! browser closed, and a user-picked cookie file confused people; both were removed.)

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::webview::Cookie;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub(crate) const WINDOW: &str = "sign-in";
const FETCH_ITEM: &str = "fetch-page";

/// A video file found by playing a page in the sign-in window carries that page after this mark,
/// because servers that check where requests come from (the Referer) refuse it otherwise. The
/// mark rides along in the link through projects, exports and downloads; yt-dlp never sees it.
pub(crate) const REFERER_MARK: &str = "#craftora-referer=";

/// Runs in every page and every embedded frame of the sign-in window from the moment it opens
/// (on Windows every frame gets it), so no stream is missed. It notes each stream playlist and
/// video file loaded (playlists whose address doesn't say so by their type or first line,
/// `#EXTM3U`), and each video that starts playing and how: a file, the site's own stream player,
/// or a direct live connection (WebRTC), which has no address to fetch. The browser's own list keeps only the first 250 things a page loads (a shop's pictures can fill
/// it) and never shows what a player in an embedded frame does, so frames pass all this to the page.
const WATCH_MEDIA: &str = r#"(() => {
  if (window.__craftoraMedia) return;
  const seen = (window.__craftoraMedia = []);
  const playing = (window.__craftoraPlaying = []);
  const tell = (data) => { if (window.top !== window) try { window.top.postMessage(data, "*"); } catch {} };
  const MEDIA_URL = /\.(m3u8|mpd|mp4|webm|m4v|mov)(\?|$)/i;
  const PLAYLIST_TYPE = /mpegurl|dash\+xml/i;
  const isPlaylist = (type, start) => PLAYLIST_TYPE.test(type) || /^\s*(#EXTM3U|(<\?xml[^>]*>\s*)?<MPD)/.test(start);
  const keep = (u, sure) => {
    if (typeof u !== "string" || !/^https?:/.test(u) || !(sure || MEDIA_URL.test(u)) || seen.includes(u) || seen.length >= 100) return;
    seen.push(u);
    tell({ craftoraMedia: u });
  };
  const note = (what) => {
    if (playing.includes(what) || playing.length >= 10) return;
    playing.push(what);
    tell({ craftoraPlaying: what });
  };
  window.addEventListener("message", (e) => {
    keep(e.data?.craftoraMedia, true);
    if (typeof e.data?.craftoraPlaying === "string") note(e.data.craftoraPlaying);
  });
  document.addEventListener("playing", (e) => {
    const v = e.target;
    const how = v.srcObject ? "webrtc" : /^blob:/.test(v.currentSrc) ? "player" : "file";
    note(how + (window.top === window ? "" : " in a frame from " + location.hostname));
  }, true);
  const fetch0 = window.fetch;
  if (fetch0) window.fetch = function (...args) {
    const answer = fetch0.apply(this, args);
    answer.then((r) => {
      const type = r.headers.get("content-type") || "";
      if (PLAYLIST_TYPE.test(type)) keep(r.url, true);
      else if (!MEDIA_URL.test(r.url) && /^(text\/plain|application\/octet-stream|)(;|$)/i.test(type))
        r.clone().text().then((t) => isPlaylist(type, t.slice(0, 80)) && keep(r.url, true), () => {});
    }, () => {});
    return answer;
  };
  const send0 = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const start = this.responseType === "" || this.responseType === "text" ? this.responseText.slice(0, 80) : "";
        if (isPlaylist(this.getResponseHeader("content-type") || "", start)) keep(this.responseURL, true);
      } catch {}
    });
    return send0.apply(this, args);
  };
  try { performance.setResourceTimingBufferSize(100000); } catch {}
  try { new PerformanceObserver((list) => list.getEntries().forEach((e) => keep(e.name))).observe({ type: "resource", buffered: true }); } catch {}
})()"#;

/// Run in the sign-in window by "Fetch this video": what the page plays, best guesses first.
/// Video elements' files, then streaming manifests and video files the page (or a frame in it)
/// loaded, then embedded players (their pages are often ones yt-dlp knows). `playing` says how
/// videos were seen playing, for the message when nothing can be fetched.
const FIND_MEDIA: &str = r#"(() => {
  const media = [];
  const add = (u) => { if (u && /^https?:/.test(u) && !media.includes(u)) media.push(u); };
  document.querySelectorAll("video, audio, video source, audio source").forEach((e) => add(e.currentSrc || e.src));
  const watched = window.__craftoraMedia || [];
  const loaded = [...watched, ...performance.getEntriesByType("resource").map((e) => e.name)];
  loaded.filter((u) => /\.(m3u8|mpd)(\?|$)/i.test(u) || (watched.includes(u) && !/\.(mp4|webm|m4v|mov)(\?|$)/i.test(u))).forEach(add);
  loaded.filter((u) => /\.(mp4|webm|m4v|mov)(\?|$)/i.test(u)).forEach(add);
  document.querySelectorAll("iframe[src]").forEach((e) => add(e.src));
  const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content;
  const image = meta("og:image") || meta("twitter:image") || document.querySelector("video[poster]")?.poster || "";
  const playing = [...(window.__craftoraPlaying || [])];
  if ([...document.querySelectorAll("video")].some((v) => v.srcObject)) playing.push("webrtc");
  return { title: document.title, image: /^https?:/.test(image) ? image : "", media: media.slice(0, 5), playing, agent: navigator.userAgent };
})()"#;

/// What "Fetch this video" sends to the main window.
#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FoundPage {
    #[serde(default)]
    page: String,
    #[serde(default)]
    title: String,
    /// The page's own preview picture (og:image, or the player's poster).
    #[serde(default)]
    image: String,
    #[serde(default)]
    media: Vec<String>,
    /// How videos were seen playing: "file", "player" (the site's stream player) or "webrtc" (no
    /// address), each maybe followed by " in a frame from <host>".
    #[serde(default)]
    playing: Vec<String>,
    /// The window's browser name, kept for posing as it (`BROWSER_AGENT`); not sent on.
    #[serde(default, skip_serializing)]
    agent: String,
}

/// yt-dlp arguments that reach a link: the user's logins, the page it was found on (when it was
/// found in the sign-in window), then the link itself. Keep the file until yt-dlp ends.
pub(crate) async fn link_args(app: &AppHandle, link: &str) -> (Vec<String>, Option<TempCookies>) {
    let (mut args, file) = cookie_args(app).await;
    let (url, referer) = split_referer(link);
    if let Some(page) = referer {
        args.extend(["--referer".into(), page.into()]);
    }
    if bot_checked(url) {
        // Look like the browser that passed the site's check: its kind of connection, and its
        // name, which the check's cookie (in the cookie file) belongs to.
        args.extend(["--impersonate".into(), "chrome".into()]);
        let agent = BROWSER_AGENT.lock().unwrap().clone();
        if !agent.is_empty() {
            args.extend(["--user-agent".into(), agent]);
        }
    }
    args.extend(["--".into(), url.into()]);
    (args, file)
}

/// Sites whose bot check (Cloudflare's) turned yt-dlp away; yt-dlp then poses as a browser there.
static CHALLENGED: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());
/// The sign-in window's browser name (User-Agent), seen by "Fetch this video".
static BROWSER_AGENT: Mutex<String> = Mutex::new(String::new());

fn host_of(link: &str) -> Option<String> {
    Url::parse(split_referer(link).0).ok()?.host_str().map(str::to_string)
}

/// Remembers that `link`'s site turned yt-dlp away with a bot check. True the first time, so the
/// caller tries again as a browser.
pub(crate) fn note_bot_check(link: &str) -> bool {
    host_of(link).is_some_and(|host| CHALLENGED.lock().unwrap().insert(host))
}

/// Whether `link`'s site checks for bots: then only yt-dlp (posing as a browser) gets through.
pub(crate) fn bot_checked(link: &str) -> bool {
    host_of(link).is_some_and(|host| CHALLENGED.lock().unwrap().contains(&host))
}

pub(crate) fn split_referer(link: &str) -> (&str, Option<&str>) {
    match link.split_once(REFERER_MARK) {
        Some((url, page)) => (url, Some(page)),
        None => (link, None),
    }
}

/// A cookie file that only exists while yt-dlp runs: it holds logins, so it doesn't linger.
pub(crate) struct TempCookies(PathBuf);

impl Drop for TempCookies {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn is_local(domain: &str) -> bool {
    let domain = domain.trim_start_matches('.');
    domain == "localhost" || domain.ends_with(".localhost")
}

/// Website cookies in the app's cookie store (left by the sign-in window), not the app's own.
async fn web_cookies(app: &AppHandle) -> Vec<Cookie<'static>> {
    let Some(main) = app.get_webview_window("main") else {
        return Vec::new();
    };
    // Reading cookies waits on the UI thread, so it must happen off it (see `Webview::cookies`).
    tauri::async_runtime::spawn_blocking(move || main.cookies().unwrap_or_default())
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|c| c.domain().is_some_and(|d| !is_local(d)))
        .collect()
}

/// The Netscape cookie file format that yt-dlp reads.
fn netscape(cookies: &[Cookie]) -> String {
    let mut text = String::from("# Netscape HTTP Cookie File\n");
    for c in cookies {
        // The cookie library drops the leading dot, so every cookie is written as covering the
        // site's subdomains; a host-only one also reaching subdomains is harmless for yt-dlp.
        let domain = c.domain().unwrap_or_default().trim_start_matches('.');
        let secure = if c.secure() == Some(true) { "TRUE" } else { "FALSE" };
        // 0 marks a session cookie.
        let expires = c.expires_datetime().map_or(0, |t| t.unix_timestamp());
        let path = c.path().unwrap_or("/");
        text += &format!(".{domain}\tTRUE\t{path}\t{secure}\t{expires}\t{}\t{}\n", c.name(), c.value());
    }
    text
}

/// yt-dlp arguments for the user's sign-ins, plus the temporary file to keep until yt-dlp ends.
async fn cookie_args(app: &AppHandle) -> (Vec<String>, Option<TempCookies>) {
    let cookies = web_cookies(app).await;
    let Ok(dir) = app.path().app_cache_dir() else {
        return (Vec::new(), None);
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let path = dir.join(format!("sign-ins-{}.txt", NEXT.fetch_add(1, Ordering::Relaxed)));
    if cookies.is_empty() || std::fs::create_dir_all(&dir).is_err() || std::fs::write(&path, netscape(&cookies)).is_err() {
        return (Vec::new(), None);
    }
    (vec!["--cookies".into(), path.to_string_lossy().into_owned()], Some(TempCookies(path)))
}

/// Opens a website (or a video's own page) in a Craftora window, where the user logs in and
/// browses. Its menu bar's "Fetch this video" sends `fetch-page` with the page being shown and
/// the media it plays, so the main window fetches it with the login.
#[tauri::command]
pub async fn open_sign_in(app: AppHandle, site: String) -> Result<(), String> {
    let site = site.trim();
    let link = if site.starts_with("https://") || site.starts_with("http://") { site.to_string() } else { format!("https://{site}") };
    let url: Url = link.parse().map_err(|_| "That doesn't look like a website address.".to_string())?;
    if let Some(window) = app.get_webview_window(WINDOW) {
        window.navigate(url).map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let fetch = MenuItem::with_id(&app, FETCH_ITEM, "Fetch this video", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&fetch]).map_err(|e| e.to_string())?;
    WebviewWindowBuilder::new(&app, WINDOW, WebviewUrl::External(url))
        .title("Craftora · log in if needed, play the video, then click Fetch this video")
        .inner_size(900.0, 760.0)
        .initialization_script_for_all_frames(WATCH_MEDIA)
        .menu(menu)
        .on_menu_event(|window, event| {
            if event.id() != FETCH_ITEM {
                return;
            }
            let app = window.app_handle().clone();
            let Some(browser) = app.get_webview_window(WINDOW) else {
                return;
            };
            // The page shown now, even after in-page navigation (YouTube changes videos without loading a page).
            let page = browser.url().map(|u| u.to_string()).unwrap_or_default();
            let _ = browser.eval_with_callback(FIND_MEDIA, move |json| {
                let mut found: FoundPage = serde_json::from_str(&json).unwrap_or_default();
                if !found.agent.is_empty() {
                    *BROWSER_AGENT.lock().unwrap() = std::mem::take(&mut found.agent);
                }
                found.media = found.media.iter().map(|m| format!("{m}{REFERER_MARK}{page}")).collect();
                found.page = page.clone();
                let _ = app.emit("fetch-page", found);
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.set_focus();
                }
            });
        })
        .build()
        .map_err(|e| format!("Couldn't open the sign-in window: {e}"))?;
    Ok(())
}

/// Shows a short message on top of the page in the sign-in window, such as "Sent to Craftora".
#[tauri::command]
pub async fn tell_sign_in(app: AppHandle, message: String) -> Result<(), String> {
    let Some(window) = app.get_webview_window(WINDOW) else {
        return Ok(());
    };
    let text = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    let js = format!(
        r#"(() => {{
  document.getElementById("craftora-note")?.remove();
  const note = document.createElement("div");
  note.id = "craftora-note";
  note.textContent = {text};
  note.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;background:#18181a;color:#f5f5f7;border:1px solid #fa2d48;border-radius:6px;font:600 14px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5)";
  document.documentElement.appendChild(note);
  setTimeout(() => note.remove(), 12000);
}})()"#
    );
    window.eval(js).map_err(|e| e.to_string())
}

/// Forgets every website login made in Craftora's sign-in window.
#[tauri::command]
pub async fn sign_out_everywhere(app: AppHandle) -> Result<(), String> {
    let cookies = web_cookies(&app).await;
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };
    tauri::async_runtime::spawn_blocking(move || {
        for cookie in cookies {
            let _ = main.delete_cookie(cookie);
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_netscape_lines() {
        let cookie = Cookie::build(("SID", "abc")).domain(".youtube.com").path("/").secure(true).build();
        let host_only = Cookie::build(("PREF", "x")).domain("www.youtube.com").build();
        assert_eq!(
            netscape(&[cookie, host_only]),
            "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n.www.youtube.com\tTRUE\t/\tFALSE\t0\tPREF\tx\n"
        );
        assert!(is_local("cmedia.localhost") && is_local("localhost") && !is_local(".youtube.com"));
    }

    #[test]
    fn splits_the_page_off_found_media() {
        let link = format!("https://cdn.example/v/index.m3u8?t=1{REFERER_MARK}https://site.example/watch?id=9#top");
        assert_eq!(split_referer(&link), ("https://cdn.example/v/index.m3u8?t=1", Some("https://site.example/watch?id=9#top")));
        assert_eq!(split_referer("https://youtu.be/x"), ("https://youtu.be/x", None));
    }
}
