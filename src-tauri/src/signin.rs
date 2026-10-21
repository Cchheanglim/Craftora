//! Signing in to websites, for links that need a login (age-restricted, private, members-only).
//! yt-dlp gets the sign-ins as a cookie file: one the user picked, or by default the ones made
//! in Craftora's own sign-in window, which shares the app's WebView2 cookie store. (Borrowing a
//! browser's logins needed that browser closed, which people won't do.)

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::webview::Cookie;
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const WINDOW: &str = "sign-in";
const FETCH_ITEM: &str = "fetch-page";

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
pub(crate) async fn cookie_args(app: &AppHandle) -> (Vec<String>, Option<TempCookies>) {
    if let Some(file) = crate::store::get_cookie_file(app.clone()) {
        return (vec!["--cookies".into(), file], None);
    }
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
/// browses. Its menu bar's "Fetch this video" sends `fetch-page` with the page being shown, so
/// the main window fetches it with the login.
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
        .title("Craftora · sign in, open the video, then Fetch this video")
        .inner_size(900.0, 760.0)
        .menu(menu)
        .on_menu_event(|window, event| {
            if event.id() != FETCH_ITEM {
                return;
            }
            let app = window.app_handle();
            // The page shown now, even after in-page navigation (YouTube changes videos without loading a page).
            let Some(page) = app.get_webview_window(WINDOW).and_then(|w| w.url().ok()) else {
                return;
            };
            let _ = app.emit("fetch-page", page.to_string());
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
        })
        .build()
        .map_err(|e| format!("Couldn't open the sign-in window: {e}"))?;
    Ok(())
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
}
