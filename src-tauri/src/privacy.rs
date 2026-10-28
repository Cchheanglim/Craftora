//! The proxy Craftora's connections go through when the user sets one: yt-dlp, FFmpeg and FFprobe,
//! Craftora's own web requests, and its window (previews, sign-in, website pictures). Kept in
//! settings.json; the window only reads it when Craftora starts.

use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Duration;

use serde::Serialize;

static PROXY: RwLock<Option<String>> = RwLock::new(None);
/// The proxy Craftora's window started with (it can't change until a restart).
static WINDOW_PROXY: RwLock<Option<String>> = RwLock::new(None);

pub(crate) fn proxy() -> Option<String> {
    PROXY.read().unwrap().clone()
}

pub(crate) fn set(proxy: Option<String>) {
    *PROXY.write().unwrap() = proxy;
}

/// A proxy address as "http://host:port". Only plain HTTP proxies: FFmpeg can't use SOCKS ones and
/// would connect directly instead, giving the real address away.
// shortcut: no username/password (the window can't take one in --proxy-server); add when asked.
pub(crate) fn checked(text: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(text.trim()).map_err(|_| "That isn't a proxy address. It looks like http://127.0.0.1:8080.".to_string())?;
    if url.scheme() != "http" {
        return Err("Only http:// proxies work with every part of Craftora (FFmpeg can't use SOCKS proxies).".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Proxies that need a username and password aren't supported yet.".into());
    }
    let host = url.host_str().filter(|h| !h.is_empty()).ok_or("The address needs the proxy's name or IP address.")?;
    let port = url.port().ok_or("Add the proxy's port at the end, such as :8080.")?;
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("Just the proxy's address and port, such as http://127.0.0.1:8080.".into());
    }
    Ok(format!("http://{host}:{port}"))
}

/// A web client builder that goes through the proxy when there is one.
pub(crate) fn client_builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();
    match proxy().and_then(|p| reqwest::Proxy::all(p).ok()) {
        Some(p) => builder.proxy(p),
        None => builder,
    }
}

/// Called first thing, before any window exists: reads the saved proxy and hands it to WebView2,
/// which only takes it when it starts.
pub fn prepare() {
    let saved = std::env::var_os("APPDATA")
        .map(|dir| PathBuf::from(dir).join("com.cchheanglim.craftora").join("settings.json"))
        .and_then(|file| std::fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|settings| settings["proxy"].as_str().and_then(|p| checked(p).ok()));
    if let Some(proxy) = &saved {
        const ARGS: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
        let args = format!("{} --proxy-server={proxy}", std::env::var(ARGS).unwrap_or_default());
        // SAFETY: runs at the very start of `run`, before Craftora starts any other thread.
        unsafe { std::env::set_var(ARGS, args.trim()) };
    }
    *WINDOW_PROXY.write().unwrap() = saved.clone();
    set(saved);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyState {
    /// What Craftora's connections use now; None for a direct connection.
    proxy: Option<String>,
    /// What its window uses (until a restart).
    window: Option<String>,
}

pub(crate) fn state() -> ProxyState {
    ProxyState { proxy: proxy(), window: WINDOW_PROXY.read().unwrap().clone() }
}

/// The internet address websites see now, asked of Cloudflare (only when the user clicks Check).
#[tauri::command]
pub async fn check_address() -> Result<String, String> {
    let client = client_builder().timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let text = client
        .get("https://www.cloudflare.com/cdn-cgi/trace")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the internet{}: {e}", if proxy().is_some() { " through the proxy" } else { "" }))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    text.lines().find_map(|l| l.strip_prefix("ip=")).map(str::to_string).ok_or_else(|| "Cloudflare didn't say.".into())
}

#[cfg(test)]
mod tests {
    use super::checked;

    #[test]
    fn accepts_only_plain_http_proxies() {
        assert_eq!(checked(" http://127.0.0.1:8080 ").unwrap(), "http://127.0.0.1:8080");
        assert_eq!(checked("http://proxy.example.com:3128/").unwrap(), "http://proxy.example.com:3128");
        assert!(checked("socks5://127.0.0.1:1080").is_err());
        assert!(checked("http://user:pass@127.0.0.1:8080").is_err());
        assert!(checked("http://127.0.0.1").is_err());
        assert!(checked("127.0.0.1:8080").is_err());
        assert!(checked("http://127.0.0.1:8080/path").is_err());
    }
}
