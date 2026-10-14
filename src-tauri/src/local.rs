//! "Open file": read a video or audio file on this PC with ffprobe, so it can be
//! trimmed and converted offline with FFmpeg alone.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

use crate::engine::run_to_end;
use crate::media::{codec_name, MediaSource, Stream};

pub const FFPROBE: &str = "ffprobe";

/// Files the user opened through the picker or by dropping them on the window.
/// Jobs may only read these, so the UI can't point FFmpeg at arbitrary paths.
#[derive(Default)]
pub struct OpenedFiles(Mutex<HashSet<PathBuf>>);

impl OpenedFiles {
    pub fn contains(&self, path: &Path) -> bool {
        self.0.lock().unwrap().contains(path)
    }
}

#[derive(Deserialize)]
struct Probe {
    format: ProbeFormat,
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    size: Option<String>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    bit_rate: Option<String>,
    disposition: Option<Disposition>,
}

#[derive(Deserialize)]
struct Disposition {
    #[serde(default)]
    attached_pic: u8,
}

/// Absolute path without Windows' `\\?\` verbatim prefix (which breaks preview URLs).
/// Used both when opening a file and when checking a job, so the two always match.
pub fn normalize(path: &Path) -> Result<PathBuf, String> {
    let full = path.canonicalize().map_err(|e| format!("Couldn't open the file: {e}"))?;
    let text = full.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => Ok(PathBuf::from(rest)),
        _ => Ok(full),
    }
}

/// "30000/1001" → 29.97
fn frame_rate(text: &str) -> Option<f64> {
    let (num, den) = text.split_once('/')?;
    let (num, den): (f64, f64) = (num.parse().ok()?, den.parse().ok()?);
    (den > 0.0 && num > 0.0).then(|| num / den)
}

/// Reads a local file with ffprobe and describes it for the editor.
#[tauri::command]
pub async fn open_local(app: AppHandle, opened: State<'_, OpenedFiles>, path: String) -> Result<MediaSource, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("That file doesn't exist or isn't a file.".into());
    }
    let path = normalize(&path)?;
    let path_text = path.to_string_lossy().into_owned();

    let output = run_to_end(
        &app,
        FFPROBE,
        &["-v", "error", "-print_format", "json", "-show_format", "-show_streams", &path_text],
    )
    .await?;
    if !output.status.success() {
        return Err("Craftora can't read this file. It may be damaged or not a video or audio file.".into());
    }
    let probe: Probe =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("Unexpected answer from ffprobe: {e}"))?;

    let duration = probe
        .format
        .duration
        .as_deref()
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| *d > 0.0)
        .ok_or("This file has no known length, so it can't be trimmed.")?;
    let total_mb = probe.format.size.as_deref().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0) / 1_000_000.0;

    // Cover art in music files shows up as a video stream; it isn't video.
    let video = probe.streams.iter().find(|s| {
        s.codec_type.as_deref() == Some("video") && s.disposition.as_ref().is_none_or(|d| d.attached_pic == 0)
    });
    let audio = probe.streams.iter().find(|s| s.codec_type.as_deref() == Some("audio"));
    if video.is_none() && audio.is_none() {
        return Err("No video or audio was found in this file.".into());
    }

    let audio_codec = audio.map(|a| codec_name(a.codec_name.as_deref())).unwrap_or_default();
    let audio_kbps = audio
        .and_then(|a| a.bit_rate.as_deref())
        .and_then(|b| b.parse::<f64>().ok())
        .map(|b| b / 1000.0);

    let mut streams = Vec::new();
    if let Some(v) = video {
        let label = match (v.height, v.avg_frame_rate.as_deref().and_then(frame_rate)) {
            (Some(h), Some(fps)) => format!("{h}p · {} fps", fps.round()),
            (Some(h), None) => format!("{h}p"),
            _ => "Original video".into(),
        };
        let video_codec = codec_name(v.codec_name.as_deref());
        let detail = if audio.is_some() { format!("{video_codec} + {audio_codec}") } else { format!("{video_codec} · no sound") };
        streams.push(Stream { id: "local:video".into(), kind: "video", label, detail, size_mb: total_mb });
    }
    if audio.is_some() {
        let size_mb = audio_kbps.map(|k| k * 1000.0 / 8.0 * duration / 1_000_000.0).unwrap_or(total_mb);
        let detail = match audio_kbps {
            Some(k) => format!("{audio_codec} · {} kbps", k.round()),
            None => audio_codec,
        };
        streams.push(Stream { id: "local:audio".into(), kind: "audio", label: "Original audio".into(), detail, size_mb });
    }

    // Let the preview player read this one file through the asset protocol.
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| format!("Couldn't allow the preview to read the file: {e}"))?;
    opened.0.lock().unwrap().insert(path.clone());

    Ok(MediaSource {
        title: path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".into()),
        uploader: "On this PC".into(),
        duration,
        local: true,
        // The UI turns the path into a playable asset URL.
        preview_url: String::new(),
        preview_has_audio: audio.is_some(),
        streams,
        url: path_text,
    })
}
