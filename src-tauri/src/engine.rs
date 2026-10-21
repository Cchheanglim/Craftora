//! The bundled yt-dlp and FFmpeg sidecars: where they live and how to run them.

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::{process::Output, ShellExt};

pub const YT_DLP: &str = "yt-dlp";
pub const FFMPEG: &str = "ffmpeg";

/// Folder holding the sidecars. Tauri copies them next to the app executable,
/// both in `tauri dev` (target/debug) and in installed builds.
pub fn sidecar_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    exe.parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Could not locate the app folder".to_string())
}

/// Runs a sidecar to completion and collects its output.
pub async fn run_to_end(app: &AppHandle, name: &str, args: &[&str]) -> Result<Output, String> {
    app.shell()
        .sidecar(name)
        .map_err(|e| format!("{name} is not bundled: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Could not start {name}: {e}"))
}

/// The last `ERROR:` line yt-dlp printed, without the prefix, as a user-facing message.
pub fn last_error(stderr: &str) -> Option<String> {
    stderr
        .lines()
        .rev()
        .find_map(|l| l.trim().strip_prefix("ERROR:").map(|m| m.trim().to_string()))
}

/// Updates the bundled yt-dlp to its newest release (sites change often, and old versions stop
/// working on them). Returns yt-dlp's own one-line answer, e.g. "Updated yt-dlp to stable@…".
#[tauri::command]
pub async fn update_yt_dlp(app: AppHandle) -> Result<String, String> {
    let output = run_to_end(&app, YT_DLP, &["-U"]).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(last_error(&stderr).unwrap_or_else(|| "yt-dlp couldn't update itself.".into()));
    }
    Ok(stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("yt-dlp is up to date.").trim().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    yt_dlp: Option<String>,
    ffmpeg: Option<String>,
}

/// Versions of the bundled engines, or `None` for an engine that is missing or broken.
#[tauri::command]
pub async fn engine_status(app: AppHandle) -> EngineStatus {
    let yt_dlp = run_to_end(&app, YT_DLP, &["--version"])
        .await
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    // First line looks like "ffmpeg version n9.0-12-gabc123-20261013 Copyright ...".
    let ffmpeg = run_to_end(&app, FFMPEG, &["-version"])
        .await
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            let version = text.lines().next()?.split_whitespace().nth(2)?;
            Some(version.split('-').next().unwrap_or(version).trim_start_matches('n').to_string())
        });

    EngineStatus { yt_dlp, ffmpeg }
}
