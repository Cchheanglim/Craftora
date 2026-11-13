//! Remove background: an AI model that finds a photo's subject (ISNet "general use", Apache-2.0, as the rembg project
//! publishes it), downloaded once (170 MB) and run in the editor (lib/cutout.ts). The cut-out comes back here as a PNG
//! with see-through pixels, saved in the app's data folder and opened like any picture.

use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager};

const URL: &str = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx";
const FILE: &str = "isnet-general-use.onnx";
const BYTES: u64 = 178_648_008;
/// Its SHA-256 (rembg lists md5 fc16ebd8b0c10d971d3513d564d01e29 for the same file; both checked on 2026-11-12).
const SHA256: &str = "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a";
/// GitHub answers with a redirect to its file host; nothing else is followed.
const HOSTS: [&str; 2] = ["github.com", "release-assets.githubusercontent.com"];
/// Bigger than any photo's PNG Craftora makes (8192 × 8192 with see-through pixels).
const MAX_PNG: usize = 300_000_000;

#[derive(Serialize, Clone)]
struct Progress {
    percent: f64,
}

/// The model's bytes, downloading it the first time (with `cutout-progress` events).
#[tauri::command]
pub async fn cutout_model(app: AppHandle) -> Result<Response, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    let path = dir.join(FILE);
    if !std::fs::metadata(&path).is_ok_and(|m| m.len() == BYTES) {
        download(&app, &dir, &path).await?;
    }
    std::fs::read(&path).map(Response::new).map_err(|e| format!("Couldn't read the AI model: {e}"))
}

/// A photo opened in Craftora (only those), for the editor to cut out: its pixels can't be read through the preview's address.
#[tauri::command]
pub fn cutout_source(app: AppHandle, path: String) -> Result<Response, String> {
    let path = PathBuf::from(path);
    if !app.asset_protocol_scope().is_allowed(&path) || std::fs::metadata(&path).map_or(true, |m| m.len() > MAX_PNG as u64) {
        return Err("Only a picture opened in Craftora can be cut out.".into());
    }
    std::fs::read(&path).map(Response::new).map_err(|e| format!("Couldn't read the picture: {e}"))
}

async fn download(app: &AppHandle, dir: &std::path::Path, path: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't make a folder for the AI model: {e}"))?;
    // No overall time limit: 170 MB can take minutes on a slow connection.
    let client = crate::privacy::client_builder()
        .connect_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && attempt.url().scheme() == "https" && attempt.url().host_str().is_some_and(|h| HOSTS.contains(&h)) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(URL).send().await.map_err(|e| format!("Couldn't download the AI model: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't download the AI model: its server answered {}.", response.status()));
    }
    let part = dir.join(format!("{FILE}.part"));
    let mut file = std::fs::File::create(&part).map_err(|e| format!("Couldn't save the AI model: {e}"))?;
    let (mut done, mut shown, mut hash) = (0u64, -1.0, Sha256::new());
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("The AI model stopped downloading: {e}"))? {
        done += chunk.len() as u64;
        if done > BYTES {
            break;
        }
        file.write_all(&chunk).map_err(|e| format!("Couldn't save the AI model: {e}"))?;
        hash.update(&chunk);
        let percent = (done as f64 / BYTES as f64 * 100.0).floor();
        if percent != shown {
            shown = percent;
            let _ = app.emit("cutout-progress", Progress { percent });
        }
    }
    drop(file);
    if !genuine(done, &format!("{:x}", hash.finalize())) {
        let _ = std::fs::remove_file(&part);
        return Err("The AI model didn't download properly. Try again.".into());
    }
    std::fs::rename(&part, path).map_err(|e| format!("Couldn't save the AI model: {e}"))
}

/// The whole file, and the very one checked.
fn genuine(bytes: u64, sha256: &str) -> bool {
    bytes == BYTES && sha256 == SHA256
}

/// Saves a cut-out the editor made (the request's body: a PNG) and returns its path, for `open_local`.
#[tauri::command]
pub fn save_cutout(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(png) = request.body() else {
        return Err("The cut-out didn't arrive.".into());
    };
    if png.len() > MAX_PNG || !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("The cut-out isn't a picture Craftora made.".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("cutouts");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make a folder for cut-outs: {e}"))?;
    // Named by its content: the same cut-out twice is one file.
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    png.hash(&mut hasher);
    let path: PathBuf = dir.join(format!("cutout-{:016x}.png", hasher.finish()));
    std::fs::write(&path, png).map_err(|e| format!("Couldn't save the cut-out: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{genuine, BYTES, SHA256};

    #[test]
    fn only_the_checked_model_is_kept() {
        assert!(genuine(BYTES, SHA256));
        assert!(!genuine(BYTES - 1, SHA256));
        assert!(!genuine(BYTES, "0000"));
    }
}
