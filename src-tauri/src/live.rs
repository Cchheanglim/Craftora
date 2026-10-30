//! Recording a live stream while it plays, so it can be edited before it ends. FFmpeg saves it
//! as numbered parts plus a growing playlist (an HLS "event" playlist) in a folder in
//! Videos\Craftora\Downloads. The preview plays that playlist with hls.js through
//! `http://cmedia.localhost/rec/<id>/…` (media_cache.rs); exports read it like a file on this PC.
//! When the recording stops, or the stream ends, the parts become one MP4 and the folder goes.
//! The folder isn't a `.craftora-` working folder, so a crash never throws a recording away.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Deserialize;
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::engine::FFMPEG;
use crate::jobs::{deliver, downloads_dir, is_web_link, progress_event, run_ffmpeg, run_streaming, safe_stem, spawn_job, work_root, Jobs};

const PLAYLIST: &str = "index.m3u8";

/// Recordings in progress: job id → the folder FFmpeg writes into.
#[derive(Default)]
pub struct Recordings(Mutex<HashMap<String, PathBuf>>);

#[derive(Deserialize)]
pub struct LiveRecording {
    id: String,
    url: String,
    title: String,
}

/// Starts recording a live link as job `id`; returns the growing playlist's path. The job ends
/// (`job-event` "done", with the MP4) when `stop_recording` is called or the stream ends.
#[tauri::command]
pub async fn record_live(app: AppHandle, recordings: State<'_, Recordings>, spec: LiveRecording) -> Result<String, String> {
    if !is_web_link(&spec.url) {
        return Err("Only web links can be recorded.".into());
    }
    let mut inputs = crate::media::live_inputs(&app, &spec.url).await?;
    // Behind a bot check FFmpeg can't get in, so it reads the stream through the page window.
    let through_page = crate::signin::bot_checked(&spec.url);
    if through_page {
        for (url, headers) in &mut inputs {
            *url = crate::page_fetch::relayed(&app, url)?;
            headers.clear();
        }
    }
    let dir = downloads_dir(&app)?;
    let stem = safe_stem(&spec.title);
    let short_id: String = safe_stem(&spec.id).chars().take(8).collect();
    // FFmpeg records in Craftora's own folder (`work_root`); the finished MP4 goes into Downloads.
    let folder = work_root(&app)?.join(format!("{stem} (live recording {short_id})"));
    std::fs::create_dir_all(&folder).map_err(|e| format!("Couldn't create the recording folder: {e}"))?;
    recordings.0.lock().unwrap().insert(spec.id.clone(), folder.clone());

    let args = record_args(&inputs, through_page);
    let (task_app, id) = (app.clone(), spec.id.clone());
    let task_folder = folder.clone();
    let started = spawn_job(app.clone(), spec.id.clone(), async move {
        let _ = task_app.emit("job-event", progress_event(&id, "recording", None));
        // shortcut: no reconnect after a network drop; the parts saved so far are kept as the video.
        let recorded = run_streaming(&task_app, &id, FFMPEG, args, Some(&task_folder), |_| None).await;
        let result = finish(&task_app, &id, &task_folder, &dir, &stem, recorded).await;
        task_app.state::<Recordings>().0.lock().unwrap().remove(&id);
        result
    });
    if let Err(e) = started {
        recordings.0.lock().unwrap().remove(&spec.id);
        return Err(e);
    }
    Ok(folder.join(PLAYLIST).to_string_lossy().into_owned())
}

/// Ends a recording and keeps it (the queue's Stop). False when it isn't running.
#[tauri::command]
pub fn stop_recording(jobs: State<'_, Jobs>, id: String) -> bool {
    jobs.stop(&id)
}

fn record_args(inputs: &[(String, BTreeMap<String, String>)], through_page: bool) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-nostats", "-loglevel", "error"].map(String::from).to_vec();
    for (url, headers) in inputs {
        if through_page {
            // Relayed parts' addresses end in the relay's query, not ".ts".
            args.extend(["-allowed_extensions", "ALL", "-allowed_segment_extensions", "ALL", "-extension_picky", "0"].map(String::from));
        }
        // FFmpeg wants "Name: value\r\n" lines; a value with a line break would add a header.
        let lines: String = headers
            .iter()
            .filter(|(k, v)| !(k.contains(['\r', '\n']) || v.contains(['\r', '\n'])))
            .map(|(k, v)| format!("{k}: {v}\r\n"))
            .collect();
        if !lines.is_empty() {
            args.extend(["-headers".into(), lines]);
        }
        args.extend(["-i".into(), url.clone()]);
    }
    let audio_input = inputs.len() - 1;
    args.extend(["-map".into(), "0:v:0?".into(), "-map".into(), format!("{audio_input}:a:0?")]);
    // 4-second parts; the playlist keeps every part ("event"), and a part only appears in it
    // once it's complete (temp_file), so the preview and exports never read half a part.
    for arg in [
        "-c", "copy", "-f", "hls", "-hls_time", "4", "-hls_list_size", "0", "-hls_playlist_type", "event",
        "-hls_flags", "temp_file", "-hls_segment_filename", "part%05d.ts", PLAYLIST,
    ] {
        args.push(arg.into());
    }
    args
}

/// Turns the saved parts into one MP4 in the Downloads folder.
async fn finish(app: &AppHandle, id: &str, folder: &Path, dir: &Path, stem: &str, recorded: Result<(), String>) -> Result<PathBuf, String> {
    let seconds = std::fs::read_to_string(folder.join(PLAYLIST)).map(|t| playlist_seconds(&t)).unwrap_or(0.0);
    if app.state::<Jobs>().is_cancelled(id) || seconds <= 0.0 {
        let _ = std::fs::remove_dir_all(folder);
        return Err(recorded.err().unwrap_or_else(|| "The stream ended before anything was recorded.".into()));
    }
    let args = ["-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:1", "-y", "-i", PLAYLIST, "-c", "copy", "-movflags", "+faststart", "whole.mp4"]
        .map(String::from)
        .to_vec();
    let kept = || format!("The recording is kept in {}.", folder.display());
    run_ffmpeg(app, id, args, seconds, "processing", Some(folder)).await.map_err(|e| format!("Couldn't finish the recording: {e} {}", kept()))?;
    let saved = deliver(&folder.join("whole.mp4"), dir, stem, "mp4").map_err(|e| format!("{e} {}", kept()))?;
    let _ = std::fs::remove_dir_all(folder);
    Ok(saved)
}

/// Seconds of video a playlist lists: the sum of its `#EXTINF:<seconds>,` lines.
fn playlist_seconds(text: &str) -> f64 {
    text.lines()
        .filter_map(|l| l.strip_prefix("#EXTINF:")?.split(',').next()?.trim().parse::<f64>().ok())
        .sum()
}

/// Answers `http://cmedia.localhost/rec/<id>/<file>` with the playlist or one of its parts.
pub(crate) fn serve(app: &AppHandle, rest: &str) -> Response<Vec<u8>> {
    let path = rest.split_once('/').and_then(|(id, file)| {
        // Only the plain names FFmpeg writes, so nothing outside the folder can be asked for.
        let plain = !file.starts_with('.') && file.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_');
        let folder = app.state::<Recordings>().0.lock().unwrap().get(id).cloned()?;
        plain.then(|| folder.join(file))
    });
    let Some((path, body)) = path.and_then(|p| std::fs::read(&p).ok().map(|b| (p, b))) else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Vec::new())
            .unwrap_or_default();
    };
    let kind = if path.extension().is_some_and(|e| e == "m3u8") { "application/vnd.apple.mpegurl" } else { "video/mp2t" };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_TYPE, kind)
        // The playlist grows: always read it fresh.
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{playlist_seconds, record_args};
    use std::collections::BTreeMap;

    #[test]
    fn adds_up_playlist_parts() {
        let text = "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:4.000000,\npart00000.ts\n#EXTINF:3.5,\npart00001.ts\n";
        assert_eq!(playlist_seconds(text), 7.5);
        assert_eq!(playlist_seconds("#EXTM3U\n"), 0.0);
    }

    #[test]
    fn records_picture_and_sound_from_separate_inputs() {
        let headers = BTreeMap::from([("Referer".to_string(), "https://shop.example/".to_string()), ("Bad".to_string(), "a\r\nX: y".to_string())]);
        let args = record_args(&[("https://v.example/v.m3u8".into(), headers), ("https://v.example/a.m3u8".into(), BTreeMap::new())], false);
        let joined = args.join(" ");
        assert!(joined.contains("-headers Referer: https://shop.example/\r\n -i https://v.example/v.m3u8 -i https://v.example/a.m3u8"));
        assert!(!joined.contains("X: y"));
        assert!(joined.contains("-map 0:v:0? -map 1:a:0?"));
    }
}
