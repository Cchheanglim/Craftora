//! The text font library: free fonts from Google's collection (OFL or Apache licensed), downloaded the first time one is
//! picked and kept in the app's data folder. The preview loads their bytes (`font_file`); the export draws with the same
//! file (project.rs `font_path`).

use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

/// The only place fonts come from; the editor names a file in it (model.ts `TEXT_FONTS`).
const SOURCE: &str = "https://raw.githubusercontent.com/google/fonts/main/";
/// Bigger than any font in the library: anything larger isn't one.
const MAX_BYTES: usize = 5_000_000;

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// Remembers the fonts folder, at start-up.
pub(crate) fn init(app: &AppHandle) {
    if let Ok(data) = app.path().app_data_dir() {
        let _ = DIR.set(data.join("fonts"));
    }
}

/// A library font's file on this PC, if it's there (`id` checked).
pub(crate) fn installed(id: &str) -> Option<PathBuf> {
    let file = DIR.get()?.join(format!("{id}.ttf"));
    (valid_id(id) && file.is_file()).then_some(file)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// `ofl/<family>/<File>.ttf` (or `apache/…`): nothing but letters, digits, `-` and `_` in the names.
fn valid_path(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    let named = |s: &str, extra: &[char]| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(&c));
    parts.len() == 3
        && ["ofl", "apache"].contains(&parts[0])
        && named(parts[1], &[])
        && parts[2].strip_suffix(".ttf").is_some_and(|stem| named(stem, &['-', '_']))
}

/// TrueType or OpenType.
fn is_font(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0, 1, 0, 0]) || bytes.starts_with(b"true") || bytes.starts_with(b"OTTO")
}

/// A library font's bytes, downloading it the first time (through the proxy, like every connection).
#[tauri::command]
pub async fn font_file(id: String, path: String) -> Result<Response, String> {
    if !valid_id(&id) || !valid_path(&path) {
        return Err("That isn't a font from Craftora's library.".into());
    }
    let dir = DIR.get().ok_or("Craftora can't find its data folder.")?;
    let file = dir.join(format!("{id}.ttf"));
    if let Ok(bytes) = std::fs::read(&file)
        && is_font(&bytes)
    {
        return Ok(Response::new(bytes));
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't make a folder for fonts: {e}"))?;
    let client = crate::privacy::client_builder().build().map_err(|e| e.to_string())?;
    let response = client.get(format!("{SOURCE}{path}")).send().await.map_err(|e| format!("Couldn't download the font: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't download the font: its server answered {}.", response.status()));
    }
    if response.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Err("That font is too big.".into());
    }
    let bytes = response.bytes().await.map_err(|e| format!("The font stopped downloading: {e}"))?;
    if bytes.len() > MAX_BYTES || !is_font(&bytes) {
        return Err("The font didn't download properly. Try again.".into());
    }
    let part = dir.join(format!("{id}.part"));
    std::fs::write(&part, &bytes).map_err(|e| format!("Couldn't save the font: {e}"))?;
    std::fs::rename(&part, &file).map_err(|e| format!("Couldn't save the font: {e}"))?;
    Ok(Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::{is_font, valid_id, valid_path};

    #[test]
    fn only_library_fonts_are_fetched() {
        assert!(valid_path("ofl/bebasneue/BebasNeue-Regular.ttf"));
        assert!(valid_path("apache/permanentmarker/PermanentMarker-Regular.ttf"));
        for bad in ["ofl/../x.ttf", "ofl/a/b.exe", "https://evil/a.ttf", "ofl/a/b/c.ttf", "other/a/b.ttf", "ofl/a/.ttf", "ofl/a b/c.ttf"] {
            assert!(!valid_path(bad), "{bad}");
        }
        assert!(valid_id("bebas-neue") && !valid_id("../x") && !valid_id("A") && !valid_id(""));
        assert!(is_font(&[0, 1, 0, 0, 9]) && is_font(b"OTTO..") && !is_font(b"<html>"));
    }
}
