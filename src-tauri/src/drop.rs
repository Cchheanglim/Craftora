// Win32 IDropTarget registration and CF_HDROP handling adapted from wry (MIT/Apache-2.0).

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

const MAX_GIF_BYTES: usize = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30);
const NOT_GIF_ERROR: &str = "Only GIF images can be dropped from a browser.";
const NOT_GIF_OR_SOUND_ERROR: &str = "Only GIFs and sounds can be dropped from a browser.";
const SOUND_EXTENSIONS: [&str; 6] = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"];

/// Check whether a byte buffer starts with the GIF87a/GIF89a magic prefix (`GIF8`).
pub fn is_gif_magic(bytes: &[u8]) -> bool {
    bytes.starts_with(b"GIF8")
}

/// Rewrite Giphy page, media, or WebP links to the direct `https://i.giphy.com/<ID>.gif` asset.
pub fn rewrite_giphy_url(raw: &str) -> String {
    let trimmed = raw.trim();
    let Some((scheme, rest)) = trimmed
        .split_once("://")
        .filter(|(s, _)| s.eq_ignore_ascii_case("http") || s.eq_ignore_ascii_case("https"))
    else {
        return trimmed.to_string();
    };
    let _ = scheme;
    let (authority, path_and_more) = match rest.find(['/', '?', '#']) {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, ""),
    };
    let host = authority
        .split(':')
        .next()
        .unwrap_or("")
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let path = path_and_more.split(['?', '#']).next().unwrap_or("");

    let id = if host == "giphy.com" || host == "www.giphy.com" {
        // Page link: giphy.com/gifs/<words>-<ID> (ID = text after the last '-').
        path.strip_prefix("/gifs/")
            .and_then(|s| s.split('/').next())
            .filter(|slug| !slug.is_empty())
            .and_then(|slug| slug.rsplit_once('-').map(|(_, id)| id).or(Some(slug)))
    } else if host.starts_with("media") && host.ends_with(".giphy.com") {
        // Media link: media*.giphy.com/media/<ID>/... (or /media/v1.<token>/<ID>/...).
        path.strip_prefix("/media/").and_then(|s| {
            let mut segs = s.split('/').filter(|seg| !seg.is_empty());
            let first = segs.next()?;
            if first.starts_with("v1.") {
                segs.next()
            } else {
                Some(first)
            }
        })
    } else if host == "i.giphy.com" {
        // Direct WebP link: i.giphy.com/<ID>.webp.
        let file = path.trim_start_matches('/');
        if !file.contains('/') {
            file.strip_suffix(".webp")
                .or_else(|| file.strip_suffix(".WEBP"))
        } else {
            None
        }
    } else {
        None
    };

    match id.filter(|s| is_valid_giphy_id(s)) {
        Some(id) => format!("https://i.giphy.com/{id}.gif"),
        None => trimmed.to_string(),
    }
}

fn is_valid_giphy_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Produce a filesystem-safe GIF filename stem (without `.gif`).
pub fn safe_gif_stem(raw_name: &str) -> String {
    let base = raw_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .split(['?', '#'])
        .next()
        .unwrap_or("");
    let stem = Path::new(base)
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(base);

    let mut cleaned = String::with_capacity(stem.len());
    let mut prev_sep = false;
    for ch in stem.chars() {
        let invalid = ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        if invalid {
            if !prev_sep && !cleaned.is_empty() {
                cleaned.push('_');
                prev_sep = true;
            }
        } else {
            cleaned.push(ch);
            prev_sep = false;
        }
    }

    let trimmed = cleaned.trim_matches(|c: char| c == '.' || c == ' ' || c == '_');
    let truncated: String = trimmed.chars().take(80).collect();
    let final_stem = truncated.trim_matches(|c: char| c == '.' || c == ' ' || c == '_');
    if final_stem.is_empty() {
        return "gif".to_string();
    }
    if is_windows_reserved_name(final_stem) {
        format!("gif-{final_stem}")
    } else {
        final_stem.to_string()
    }
}

fn is_windows_reserved_name(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// Create `dir` if needed and atomically save GIF bytes without overwriting existing files.
fn save_gif_bytes(dir: &Path, raw_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if !is_gif_magic(bytes) {
        return Err(NOT_GIF_ERROR.to_string());
    }
    save_unique(dir, raw_name, "gif", bytes)
}

/// Saves `bytes` in `dir` (made if needed) as `<cleaned name>.<ext>`, adding `-2`, `-3`… instead of overwriting.
fn save_unique(dir: &Path, raw_name: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create the folder: {e}"))?;
    let stem = safe_gif_stem(raw_name);

    for attempt in 1u32..10_000 {
        let filename = if attempt == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem}-{attempt}.{ext}")
        };
        let path = dir.join(filename);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(bytes)
                    .map_err(|e| format!("Failed to write the file: {e}"))?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Failed to create the file: {e}")),
        }
    }
    Err("Too many files with the same name.".to_string())
}

/// The file type of a sound file from its first bytes (MP3, AAC, WAV, OGG, FLAC, M4A), or None.
pub fn sound_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"ID3") {
        return Some("mp3");
    }
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] & 0xE0 == 0xE0 {
        // MPEG frame sync: layer bits 00 = AAC (ADTS), else MP3.
        return Some(if bytes[1] & 0x06 == 0 { "aac" } else { "mp3" });
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("wav");
    }
    if bytes.starts_with(b"OggS") {
        return Some("ogg");
    }
    if bytes.starts_with(b"fLaC") {
        return Some("flac");
    }
    if bytes.len() >= 8 && &bytes[4..8] == b"ftyp" {
        return Some("m4a");
    }
    None
}

fn sounds_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("sounds"))
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))
}

/// Sound FX: downloads a link to a sound file or a sound page (50 MB at most) into the app's sounds folder; returns its path.
#[tauri::command]
pub async fn save_sound_from(app: tauri::AppHandle, source: String) -> Result<String, String> {
    let url = source.trim();
    let bytes = download_capped(url, "sound").await?;
    // A sound page (not the file itself): its sound, as when it's dragged in.
    if sound_ext(&bytes).is_none()
        && let Some(sound) = find_sound_in_html(&String::from_utf8_lossy(&bytes), url)
    {
        let bytes = download_capped(&sound, "sound").await?;
        return save_sound_bytes(&app, &sound, &bytes);
    }
    save_sound_bytes(&app, url, &bytes)
}

/// Saves downloaded sound bytes in the sounds folder, named after the link's last part.
fn save_sound_bytes(app: &tauri::AppHandle, url: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = sound_ext(bytes).ok_or("That link isn't a sound file (MP3, WAV, OGG, M4A, AAC or FLAC) or a page with one.")?;
    let raw_name = url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("sound");
    let path = save_unique(&sounds_dir(app)?, raw_name, ext, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

/// What a link dragged in from a browser turned out to be, saved.
pub enum Dropped {
    Gif(String),
    Sound(String),
}

/// A link dragged in from a browser: a GIF (Giphy links too), a sound file, or a web page whose sound is found with
/// `find_sound_in_html` (sound sites' pages, where dragging the title gives the page, not the file).
pub async fn save_dropped_link(app: &tauri::AppHandle, source: &str) -> Result<Dropped, String> {
    let url = rewrite_giphy_url(source);
    let bytes = download_capped(&url, "file").await?;
    if is_gif_magic(&bytes) {
        let raw_name = url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("gif");
        let path = save_gif_bytes(&gifs_dir(app)?, raw_name, &bytes)?;
        return Ok(Dropped::Gif(path.to_string_lossy().into_owned()));
    }
    if sound_ext(&bytes).is_some() {
        return save_sound_bytes(app, &url, &bytes).map(Dropped::Sound);
    }
    let Some(sound) = find_sound_in_html(&String::from_utf8_lossy(&bytes), &url) else {
        return Err(NOT_GIF_OR_SOUND_ERROR.to_string());
    };
    let bytes = download_capped(&sound, "sound").await?;
    save_sound_bytes(app, &sound, &bytes).map(Dropped::Sound)
}

/// The value of attribute `name` in one HTML tag (`<meta property="og:audio" content="…">`).
fn attr_value<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(name) {
        let at = from + i + name.len();
        let rest = lower[at..].trim_start();
        if let Some(after_eq) = rest.strip_prefix('=') {
            let value_start = tag.len() - after_eq.trim_start().len();
            let quote = tag[value_start..].chars().next()?;
            if quote == '"' || quote == '\'' {
                let body = &tag[value_start + 1..];
                return body.find(quote).map(|end| &body[..end]);
            }
        }
        from = at;
    }
    None
}

/// A web page's sound file: its `og:audio`, else the first link in it to a sound file; made absolute against `page`.
pub fn find_sound_in_html(html: &str, page: &str) -> Option<String> {
    let base = reqwest::Url::parse(page).ok()?;
    let lower = html.to_ascii_lowercase();
    let absolute = |found: &str| {
        let url = base.join(found.trim()).ok()?;
        matches!(url.scheme(), "http" | "https").then(|| url.to_string())
    };

    let mut from = 0;
    while let Some(i) = lower[from..].find("og:audio") {
        let at = from + i;
        from = at + 8;
        // `og:audio` itself, not `og:audio:type` or `og:audio:secure_url`.
        if !matches!(lower.as_bytes().get(at + 8), Some(b'"' | b'\'')) {
            continue;
        }
        let start = lower[..at].rfind('<').unwrap_or(0);
        let end = at + lower[at..].find('>').unwrap_or(lower.len() - at);
        if let Some(url) = attr_value(&html[start..end], "content").and_then(absolute) {
            return Some(url);
        }
    }

    let ends = |b: u8| matches!(b, b'"' | b'\'' | b'?' | b'#' | b')' | b'<' | b'&' | b',') || b.is_ascii_whitespace();
    let starts = |b: u8| matches!(b, b'"' | b'\'' | b'(' | b'=' | b'>' | b',') || b.is_ascii_whitespace();
    let bytes = lower.as_bytes();
    let first = SOUND_EXTENSIONS
        .iter()
        .flat_map(|ext| lower.match_indices(ext).map(move |(i, _)| i + ext.len()))
        .filter(|&end| bytes.get(end).is_none_or(|&b| ends(b)))
        .min()?;
    let start = bytes[..first].iter().rposition(|&b| starts(b)).map_or(0, |i| i + 1);
    absolute(&html[start..first])
}

fn gifs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("gifs"))
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))
}

async fn download_gif_bytes(url: &str) -> Result<Vec<u8>, String> {
    let buf = download_capped(url, "GIF").await?;
    if !is_gif_magic(&buf) {
        return Err(NOT_GIF_ERROR.to_string());
    }
    Ok(buf)
}

/// Downloads an http(s) link, refusing anything over 50 MB; `what` names it in errors ("GIF", "sound").
async fn download_capped(url: &str, what: &str) -> Result<Vec<u8>, String> {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("Only http(s) links are supported.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .user_agent("Craftora/0.6")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download the {what}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status {}.", resp.status()));
    }
    if resp.content_length().is_some_and(|len| len > MAX_GIF_BYTES as u64) {
        return Err(format!("The {what} is over the 50 MB limit."));
    }

    let mut buf = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Failed while reading the {what}: {e}"))?
    {
        if buf.len().saturating_add(chunk.len()) > MAX_GIF_BYTES {
            return Err(format!("The {what} is over the 50 MB limit."));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

async fn save_gif_from_url(app: &tauri::AppHandle, source: &str) -> Result<String, String> {
    let rewritten = rewrite_giphy_url(source);
    let bytes = download_gif_bytes(&rewritten).await?;
    let dir = gifs_dir(app)?;
    let raw_name = rewritten
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .rsplit('/')
        .next()
        .unwrap_or("gif");
    let path = save_gif_bytes(&dir, raw_name, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn save_gif_from(app: tauri::AppHandle, source: String) -> Result<String, String> {
    save_gif_from_url(&app, &source).await
}

/// Extract the first `http(s)` (or protocol-relative `//`) `<img src="...">` URL from HTML text.
pub fn extract_img_src_from_html(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut search_from = 0;

    while let Some(rel_idx) = lower[search_from..].find("<img") {
        let tag_start = search_from + rel_idx + 4;
        let next_byte = lower.as_bytes().get(tag_start).copied();
        if !matches!(next_byte, Some(b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'>')) {
            search_from = tag_start;
            continue;
        }

        if let Some((src, tag_end)) = parse_img_tag_src(&html[tag_start..]) {
            if let Some(src) = src {
                let unescaped = decode_html_entities(src.trim());
                if let Some(normalized) = normalize_http_url(&unescaped) {
                    return Some(normalized);
                }
            }
            search_from = tag_start + tag_end;
        } else {
            break;
        }
    }
    None
}

fn parse_img_tag_src(rest: &str) -> Option<(Option<&str>, usize)> {
    let bytes = rest.as_bytes();
    let mut i = 0;
    let mut found_src: Option<&str> = None;

    while i < bytes.len() {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            return None;
        }
        if bytes[i] == b'>' {
            return Some((found_src, i + 1));
        }
        if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'>') {
            return Some((found_src, i + 2));
        }

        let name_start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'=' && bytes[i] != b'>' {
            i += 1;
        }
        let attr_name = &rest[name_start..i];

        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < bytes.len() && bytes[i] == b'=' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i >= bytes.len() {
                return None;
            }
            let val = if bytes[i] == b'"' || bytes[i] == b'\'' {
                let quote = bytes[i];
                i += 1;
                let v_start = i;
                while i < bytes.len() && bytes[i] != quote {
                    i += 1;
                }
                let slice = &rest[v_start..i];
                if i < bytes.len() {
                    i += 1;
                }
                slice
            } else {
                let v_start = i;
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
                    i += 1;
                }
                &rest[v_start..i]
            };

            if found_src.is_none() && attr_name.eq_ignore_ascii_case("src") {
                found_src = Some(val);
            }
        }
    }
    None
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&#x26;", "&")
        .replace("&#X26;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn normalize_http_url(url: &str) -> Option<String> {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Some(url.to_string())
    } else if url.starts_with("//") && url.len() > 2 {
        Some(format!("https:{url}"))
    } else {
        None
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::cell::{RefCell, UnsafeCell};
    use std::ffi::{c_void, OsString};
    use std::os::windows::ffi::OsStringExt;
    use std::ptr;
    use std::sync::OnceLock;
    use tauri::Emitter;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{DRAGDROP_E_INVALIDHWND, E_UNEXPECTED, HGLOBAL, HWND, LPARAM, POINTL};
    use windows::Win32::System::Com::{
        IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL, TYMED_ISTREAM,
    };
    use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Ole::{
        IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop,
        CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
    };
    use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
    use windows::Win32::UI::Shell::{DragQueryFileW, FILEDESCRIPTORW, FILEGROUPDESCRIPTORW, HDROP};
    use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;
    use windows_core::{implement, w, PCWSTR};

    thread_local! {
        static CONTROLLERS: RefCell<Vec<DragDropController>> = const { RefCell::new(Vec::new()) };
    }

    #[derive(Clone, serde::Serialize)]
    #[serde(tag = "kind", rename_all = "lowercase")]
    enum DropPayload {
        Enter,
        Over,
        Leave,
        Drop { paths: Vec<String> },
        /// Sounds dragged in from a browser, saved: they go to Sound FX.
        Sound { paths: Vec<String> },
        Error { message: String },
    }

    enum BrowserDropData {
        File {
            name: String,
            bytes: Vec<u8>,
            fallback_url: Option<String>,
        },
        Url(String),
        Error(String),
    }

    struct ClipboardFormats {
        fgdw: u16,
        file_contents: u16,
        url_w: u16,
        html: u16,
    }

    fn formats() -> &'static ClipboardFormats {
        static FORMATS: OnceLock<ClipboardFormats> = OnceLock::new();
        FORMATS.get_or_init(|| {
            fn reg(name: PCWSTR) -> u16 {
                unsafe { RegisterClipboardFormatW(name) as u16 }
            }
            ClipboardFormats {
                fgdw: reg(w!("FileGroupDescriptorW")),
                file_contents: reg(w!("FileContents")),
                url_w: reg(w!("UniformResourceLocatorW")),
                html: reg(w!("HTML Format")),
            }
        })
    }

    #[derive(Default)]
    struct DragDropController {
        drop_targets: Vec<IDropTarget>,
    }

    impl DragDropController {
        fn new(hwnd: HWND, window: tauri::WebviewWindow) -> Self {
            let mut controller = DragDropController::default();
            let mut callback = |child_hwnd| controller.inject_in_hwnd(child_hwnd, window.clone());
            let mut trait_obj: &mut dyn FnMut(HWND) -> bool = &mut callback;
            let lparam = LPARAM((&mut trait_obj as *mut &mut dyn FnMut(HWND) -> bool) as isize);
            unsafe extern "system" fn enumerate_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
                let closure = &mut *(lparam.0 as *mut &mut dyn FnMut(HWND) -> bool);
                closure(hwnd).into()
            }
            let _ = unsafe { EnumChildWindows(Some(hwnd), Some(enumerate_callback), lparam) };
            controller
        }

        fn inject_in_hwnd(&mut self, hwnd: HWND, window: tauri::WebviewWindow) -> bool {
            let drag_drop_target: IDropTarget = DragDropTarget::new(window).into();
            if unsafe { RevokeDragDrop(hwnd) } != Err(DRAGDROP_E_INVALIDHWND.into())
                && unsafe { RegisterDragDrop(hwnd, &drag_drop_target) }.is_ok()
            {
                self.drop_targets.push(drag_drop_target);
            }
            true
        }
    }

    #[implement(IDropTarget)]
    struct DragDropTarget {
        window: tauri::WebviewWindow,
        cursor_effect: UnsafeCell<DROPEFFECT>,
        enter_is_valid: UnsafeCell<bool>,
    }

    impl DragDropTarget {
        fn new(window: tauri::WebviewWindow) -> Self {
            Self {
                window,
                cursor_effect: DROPEFFECT_NONE.into(),
                enter_is_valid: false.into(),
            }
        }

        fn emit(&self, payload: DropPayload) {
            let _ = self.window.emit("craftora-drop", payload);
        }
    }

    impl IDropTarget_Impl for DragDropTarget_Impl {
        fn DragEnter(
            &self,
            pdataobj: windows_core::Ref<'_, IDataObject>,
            _grfkeystate: MODIFIERKEYS_FLAGS,
            _pt: &POINTL,
            pdweffect: *mut DROPEFFECT,
        ) -> windows_core::Result<()> {
            let accepted = pdataobj
                .as_ref()
                .map(|obj| unsafe { has_cf_hdrop(obj) || has_browser_image(obj) })
                .unwrap_or(false);

            let effect = if accepted { DROPEFFECT_COPY } else { DROPEFFECT_NONE };
            unsafe {
                *self.cursor_effect.get() = effect;
                *self.enter_is_valid.get() = accepted;
                if !pdweffect.is_null() {
                    *pdweffect = effect;
                }
            }
            if accepted {
                self.emit(DropPayload::Enter);
            }
            Ok(())
        }

        fn DragOver(
            &self,
            _grfkeystate: MODIFIERKEYS_FLAGS,
            _pt: &POINTL,
            pdweffect: *mut DROPEFFECT,
        ) -> windows_core::Result<()> {
            unsafe {
                if !pdweffect.is_null() {
                    *pdweffect = *self.cursor_effect.get();
                }
                if *self.enter_is_valid.get() {
                    self.emit(DropPayload::Over);
                }
            }
            Ok(())
        }

        fn DragLeave(&self) -> windows_core::Result<()> {
            let was_valid = unsafe {
                let v = *self.enter_is_valid.get();
                *self.enter_is_valid.get() = false;
                *self.cursor_effect.get() = DROPEFFECT_NONE;
                v
            };
            if was_valid {
                self.emit(DropPayload::Leave);
            }
            Ok(())
        }

        fn Drop(
            &self,
            pdataobj: windows_core::Ref<'_, IDataObject>,
            _grfkeystate: MODIFIERKEYS_FLAGS,
            _pt: &POINTL,
            pdweffect: *mut DROPEFFECT,
        ) -> windows_core::Result<()> {
            unsafe {
                *self.enter_is_valid.get() = false;
                *self.cursor_effect.get() = DROPEFFECT_NONE;
            }
            let Some(data_obj) = pdataobj.as_ref() else {
                if !pdweffect.is_null() {
                    unsafe { *pdweffect = DROPEFFECT_NONE };
                }
                return Err(E_UNEXPECTED.into());
            };

            let mut paths = Vec::new();
            if unsafe { collect_hdrop_paths(data_obj, &mut paths) } {
                if !pdweffect.is_null() {
                    unsafe { *pdweffect = DROPEFFECT_COPY };
                }
                self.emit(DropPayload::Drop { paths });
                return Ok(());
            }

            if let Some(browser_data) = unsafe { extract_browser_drop(data_obj) } {
                if !pdweffect.is_null() {
                    unsafe { *pdweffect = DROPEFFECT_COPY };
                }
                let window = self.window.clone();
                tauri::async_runtime::spawn(async move {
                    handle_browser_drop(window, browser_data).await;
                });
                return Ok(());
            }

            if !pdweffect.is_null() {
                unsafe { *pdweffect = DROPEFFECT_NONE };
            }
            Ok(())
        }
    }

    async fn handle_browser_drop(window: tauri::WebviewWindow, data: BrowserDropData) {
        let app = window.app_handle().clone();
        let result: Result<Dropped, String> = match data {
            BrowserDropData::Error(msg) => Err(msg),
            BrowserDropData::File {
                name,
                bytes,
                fallback_url,
            } => {
                if is_gif_magic(&bytes) {
                    gifs_dir(&app)
                        .and_then(|dir| save_gif_bytes(&dir, &name, &bytes))
                        .map(|path| Dropped::Gif(path.to_string_lossy().into_owned()))
                } else if let Some(ext) = sound_ext(&bytes) {
                    sounds_dir(&app)
                        .and_then(|dir| save_unique(&dir, &name, ext, &bytes))
                        .map(|path| Dropped::Sound(path.to_string_lossy().into_owned()))
                } else if let Some(url) = fallback_url {
                    // Browser cached preview was non-GIF (e.g. Giphy WebP) or the page behind a link: fetch the link.
                    save_dropped_link(&app, &url).await
                } else {
                    Err(NOT_GIF_OR_SOUND_ERROR.to_string())
                }
            }
            BrowserDropData::Url(url) => save_dropped_link(&app, &url).await,
        };

        let payload = match result {
            Ok(Dropped::Gif(path)) => DropPayload::Drop { paths: vec![path] },
            Ok(Dropped::Sound(path)) => DropPayload::Sound { paths: vec![path] },
            Err(message) => DropPayload::Error { message },
        };
        let _ = window.emit("craftora-drop", payload);
    }

    fn format_etc(cf: u16, lindex: i32, tymed: u32) -> FORMATETC {
        FORMATETC {
            cfFormat: cf,
            ptd: ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex,
            tymed,
        }
    }

    unsafe fn has_cf_hdrop(data_obj: &IDataObject) -> bool {
        let fmt = format_etc(CF_HDROP.0, -1, TYMED_HGLOBAL.0 as u32);
        data_obj.QueryGetData(&fmt).is_ok()
    }

    unsafe fn has_browser_image(data_obj: &IDataObject) -> bool {
        let f = formats();
        let has_file = f.fgdw != 0
            && f.file_contents != 0
            && data_obj
                .QueryGetData(&format_etc(f.fgdw, -1, TYMED_HGLOBAL.0 as u32))
                .is_ok()
            && (data_obj
                .QueryGetData(&format_etc(
                    f.file_contents,
                    0,
                    (TYMED_ISTREAM.0 | TYMED_HGLOBAL.0) as u32,
                ))
                .is_ok()
                || data_obj
                    .QueryGetData(&format_etc(
                        f.file_contents,
                        -1,
                        (TYMED_ISTREAM.0 | TYMED_HGLOBAL.0) as u32,
                    ))
                    .is_ok());
        if has_file {
            return true;
        }
        if f.url_w != 0
            && data_obj
                .QueryGetData(&format_etc(f.url_w, -1, TYMED_HGLOBAL.0 as u32))
                .is_ok()
        {
            return true;
        }
        read_html_img_src(data_obj).is_some()
    }

    unsafe fn collect_hdrop_paths(data_obj: &IDataObject, out: &mut Vec<String>) -> bool {
        let fmt = format_etc(CF_HDROP.0, -1, TYMED_HGLOBAL.0 as u32);
        let Ok(mut medium) = data_obj.GetData(&fmt) else {
            return false;
        };
        let hdrop = HDROP(medium.u.hGlobal.0 as _);
        let item_count = DragQueryFileW(hdrop, 0xFFFF_FFFF, None);
        for i in 0..item_count {
            let char_count = DragQueryFileW(hdrop, i, None) as usize;
            let mut buf = vec![0u16; char_count + 1];
            DragQueryFileW(hdrop, i, Some(&mut buf));
            let path: PathBuf = OsString::from_wide(&buf[..char_count]).into();
            out.push(path.to_string_lossy().into_owned());
        }
        ReleaseStgMedium(&mut medium);
        true
    }

    unsafe fn extract_browser_drop(data_obj: &IDataObject) -> Option<BrowserDropData> {
        let url = read_html_img_src(data_obj).or_else(|| read_url_w(data_obj));

        if let Some(name) = read_first_descriptor_name(data_obj) {
            match read_first_file_contents(data_obj) {
                Ok(Some(bytes)) => {
                    return Some(BrowserDropData::File {
                        name,
                        bytes,
                        fallback_url: url,
                    });
                }
                Ok(None) => {}
                Err(err) => return Some(BrowserDropData::Error(err)),
            }
        }

        url.map(BrowserDropData::Url)
    }

    unsafe fn read_hglobal_bytes(hglobal: HGLOBAL) -> Result<Vec<u8>, String> {
        let size = GlobalSize(hglobal);
        if size == 0 {
            return Ok(Vec::new());
        }
        if size > MAX_GIF_BYTES {
            return Err("GIF exceeds the 50 MB size limit.".to_string());
        }
        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            return Err("Failed to lock clipboard memory.".to_string());
        }
        let bytes = std::slice::from_raw_parts(ptr as *const u8, size).to_vec();
        let _ = GlobalUnlock(hglobal);
        Ok(bytes)
    }

    unsafe fn read_first_descriptor_name(data_obj: &IDataObject) -> Option<String> {
        let cf = formats().fgdw;
        if cf == 0 {
            return None;
        }
        let Ok(mut medium) = data_obj.GetData(&format_etc(cf, -1, TYMED_HGLOBAL.0 as u32)) else {
            return None;
        };
        let hglobal = medium.u.hGlobal;
        let size = GlobalSize(hglobal);
        let name = if size >= std::mem::size_of::<FILEGROUPDESCRIPTORW>() {
            let ptr = GlobalLock(hglobal) as *const FILEGROUPDESCRIPTORW;
            if !ptr.is_null() {
                // The descriptor is a packed struct: copy fields out instead of taking references into it.
                let items = std::ptr::addr_of!((*ptr).cItems).read_unaligned();
                let out = if items > 0 {
                    let first = std::ptr::addr_of!((*ptr).fgd).cast::<FILEDESCRIPTORW>().read_unaligned();
                    let raw = first.cFileName;
                    let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
                    Some(String::from_utf16_lossy(&raw[..len]))
                } else {
                    None
                };
                let _ = GlobalUnlock(hglobal);
                out
            } else {
                None
            }
        } else {
            None
        };
        ReleaseStgMedium(&mut medium);
        name
    }

    unsafe fn read_first_file_contents(data_obj: &IDataObject) -> Result<Option<Vec<u8>>, String> {
        let cf = formats().file_contents;
        if cf == 0 {
            return Ok(None);
        }
        let tymed = (TYMED_ISTREAM.0 | TYMED_HGLOBAL.0) as u32;
        let Ok(mut medium) = data_obj.GetData(&format_etc(cf, 0, tymed)) else {
            return Ok(None);
        };

        let result = if medium.tymed == TYMED_HGLOBAL.0 as u32 {
            read_hglobal_bytes(medium.u.hGlobal).map(Some)
        } else if medium.tymed == TYMED_ISTREAM.0 as u32 {
            if let Some(stream) = medium.u.pstm.as_ref() {
                let mut out = Vec::new();
                let mut chunk = vec![0u8; 64 * 1024];
                loop {
                    let mut read = 0u32;
                    let hr = stream.Read(
                        chunk.as_mut_ptr() as *mut c_void,
                        chunk.len() as u32,
                        Some(&mut read),
                    );
                    if hr.is_err() {
                        ReleaseStgMedium(&mut medium);
                        return Err("Failed to read dropped file stream.".to_string());
                    }
                    if read == 0 {
                        break;
                    }
                    if out.len().saturating_add(read as usize) > MAX_GIF_BYTES {
                        ReleaseStgMedium(&mut medium);
                        return Err("GIF exceeds the 50 MB size limit.".to_string());
                    }
                    out.extend_from_slice(&chunk[..read as usize]);
                }
                Ok(Some(out))
            } else {
                Ok(None)
            }
        } else {
            Ok(None)
        };

        ReleaseStgMedium(&mut medium);
        result
    }

    unsafe fn read_url_w(data_obj: &IDataObject) -> Option<String> {
        let cf = formats().url_w;
        if cf == 0 {
            return None;
        }
        let Ok(mut medium) = data_obj.GetData(&format_etc(cf, -1, TYMED_HGLOBAL.0 as u32)) else {
            return None;
        };
        let bytes = read_hglobal_bytes(medium.u.hGlobal).ok();
        ReleaseStgMedium(&mut medium);
        let bytes = bytes?;
        let words: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let len = words.iter().position(|&c| c == 0).unwrap_or(words.len());
        let text = String::from_utf16_lossy(&words[..len]).trim().to_string();
        normalize_http_url(&text)
    }

    unsafe fn read_html_img_src(data_obj: &IDataObject) -> Option<String> {
        let cf = formats().html;
        if cf == 0 {
            return None;
        }
        let Ok(mut medium) = data_obj.GetData(&format_etc(cf, -1, TYMED_HGLOBAL.0 as u32)) else {
            return None;
        };
        let bytes = read_hglobal_bytes(medium.u.hGlobal).ok();
        ReleaseStgMedium(&mut medium);
        let bytes = bytes?;
        let len = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        let html = String::from_utf8_lossy(&bytes[..len]);
        extract_img_src_from_html(&html)
    }

    pub fn register(window: &tauri::WebviewWindow) {
        let win = window.clone();
        let _ = window.with_webview(move |webview| {
            // SAFETY: `with_webview` runs on the WebView2 UI thread (STA).
            let mut hwnd = HWND::default();
            if unsafe { webview.controller().ParentWindow(&mut hwnd) }.is_err() {
                return;
            }
            let controller = DragDropController::new(hwnd, win);
            CONTROLLERS.with(|list| list.borrow_mut().push(controller));
        });
    }
}

#[cfg(windows)]
pub use win::register;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sound_page_gives_its_sound_file() {
        let page = "https://sounds.example/en/instant/faaah-63455/";
        // og:audio wins over the other sounds on the page, and og:audio:type is skipped.
        let html = r#"<meta property="og:audio:type" content="audio/mpeg"/><a href="/media/sounds/other.mp3">x</a>
            <meta content='https://cdn.example/faaah.mp3' property="og:audio">"#;
        assert_eq!(find_sound_in_html(html, page).as_deref(), Some("https://cdn.example/faaah.mp3"));
        // Without og:audio: the first sound link, made absolute.
        let html = r#"<button onclick="play('/media/sounds/faaah.mp3', 'x')"></button><a href="b.wav?dl=1">"#;
        assert_eq!(find_sound_in_html(html, page).as_deref(), Some("https://sounds.example/media/sounds/faaah.mp3"));
        let html = r#"<a href="clip.WAV">"#;
        assert_eq!(find_sound_in_html(html, page).as_deref(), Some("https://sounds.example/en/instant/faaah-63455/clip.WAV"));
        // No sound, a sound-looking word, or a non-web link: nothing.
        assert_eq!(find_sound_in_html("<p>nothing here</p>", page), None);
        assert_eq!(find_sound_in_html("<p>file.mp3x</p>", page), None);
        assert_eq!(find_sound_in_html(r#"<a href="javascript:a.mp3">"#, page), None);
    }

    #[test]
    fn sound_files_are_told_apart_by_their_first_bytes() {
        assert_eq!(sound_ext(b"ID3\x04\x00"), Some("mp3"));
        assert_eq!(sound_ext(&[0xFF, 0xFB, 0x90, 0x00]), Some("mp3"));
        assert_eq!(sound_ext(&[0xFF, 0xF1, 0x50, 0x80]), Some("aac"));
        assert_eq!(sound_ext(b"RIFF\x24\x00\x00\x00WAVEfmt "), Some("wav"));
        assert_eq!(sound_ext(b"OggS\x00\x02"), Some("ogg"));
        assert_eq!(sound_ext(b"fLaC\x00"), Some("flac"));
        assert_eq!(sound_ext(b"\x00\x00\x00\x20ftypM4A "), Some("m4a"));
        assert_eq!(sound_ext(b"GIF89a"), None);
        assert_eq!(sound_ext(b"<html>"), None);
        assert_eq!(sound_ext(b""), None);
    }

    #[test]
    fn giphy_page_link_rewrites_to_direct_gif() {
        assert_eq!(
            rewrite_giphy_url(
                "https://giphy.com/gifs/anime-kilianimes-cyberpunk-edgerunners-2-bWYLkVeIKxNIhah4yM"
            ),
            "https://i.giphy.com/bWYLkVeIKxNIhah4yM.gif"
        );
    }

    #[test]
    fn giphy_media_and_webp_links_rewrite_and_others_unchanged() {
        assert_eq!(
            rewrite_giphy_url("https://media2.giphy.com/media/bWYLkVeIKxNIhah4yM/200w.webp?cid=123"),
            "https://i.giphy.com/bWYLkVeIKxNIhah4yM.gif"
        );
        assert_eq!(
            rewrite_giphy_url(
                "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExabc/bWYLkVeIKxNIhah4yM/giphy.gif"
            ),
            "https://i.giphy.com/bWYLkVeIKxNIhah4yM.gif"
        );
        assert_eq!(
            rewrite_giphy_url("https://i.giphy.com/bWYLkVeIKxNIhah4yM.webp"),
            "https://i.giphy.com/bWYLkVeIKxNIhah4yM.gif"
        );
        assert_eq!(
            rewrite_giphy_url("https://example.com/cats/dance.gif"),
            "https://example.com/cats/dance.gif"
        );
    }

    #[test]
    fn safe_file_name_sanitizes_and_avoids_overwrite() {
        assert_eq!(safe_gif_stem("cool:cat*?.gif"), "cool_cat");
        assert_eq!(safe_gif_stem("../../evil/dance.webp"), "dance");
        assert_eq!(safe_gif_stem("CON.gif"), "gif-CON");
        assert_eq!(safe_gif_stem("..."), "gif");

        let dir = std::env::temp_dir().join(format!("craftora_drop_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let p1 = save_gif_bytes(&dir, "cool:cat*?.gif", b"GIF89a1").unwrap();
        let p2 = save_gif_bytes(&dir, "cool:cat*?.gif", b"GIF89a2").unwrap();
        let p3 = save_gif_bytes(&dir, "cool:cat*?.gif", b"GIF89a3").unwrap();

        assert_eq!(p1.file_name().unwrap().to_string_lossy(), "cool_cat.gif");
        assert_eq!(p2.file_name().unwrap().to_string_lossy(), "cool_cat-2.gif");
        assert_eq!(p3.file_name().unwrap().to_string_lossy(), "cool_cat-3.gif");
        assert_eq!(std::fs::read(&p1).unwrap(), b"GIF89a1");
        assert_eq!(std::fs::read(&p2).unwrap(), b"GIF89a2");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn gif_magic_check_accepts_only_gif8() {
        assert!(is_gif_magic(b"GIF89a\x01\x00"));
        assert!(is_gif_magic(b"GIF87a\x01\x00"));
        assert!(!is_gif_magic(b"\x89PNG\r\n\x1a\n"));
        assert!(!is_gif_magic(b"RIFF\x00\x00\x00\x00WEBP"));
        assert!(!is_gif_magic(b"GIF"));
        assert!(!is_gif_magic(b""));
    }

    #[test]
    fn html_img_src_extraction_handles_entities_and_quotes() {
        let html = r#"Version:0.9
<!--StartFragment--><a href="https://example.com/post"><img alt="a > b" src='https://cdn.example.com/a.gif?w=400&amp;h=300'></a><!--EndFragment-->"#;
        assert_eq!(
            extract_img_src_from_html(html).as_deref(),
            Some("https://cdn.example.com/a.gif?w=400&h=300")
        );
        assert_eq!(extract_img_src_from_html("<p>plain text</p>"), None);
    }
}
