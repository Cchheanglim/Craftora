//! Captions made from the sound, for videos that come without any: whisper.cpp (bundled) listens
//! to the audio with a speech model downloaded once (~148 MB). Everything runs on this PC.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;

use crate::captions::{parse_vtt, seconds, Caption};
use crate::engine::{last_error, run_to_end, sidecar_dir, FFMPEG, WHISPER, YT_DLP};
use crate::local::{normalize, OpenedFiles};

/// whisper.cpp's multilingual "base" model: quick on a laptop processor, and it finds the language.
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
// shortcut: checks the size, not the SHA-256 (60ed5bc3…2efe); add a hash check if a sha2 crate comes in.
const MODEL_BYTES: u64 = 147_951_465;

#[derive(Serialize, Clone)]
struct Progress<'a> {
    id: &'a str,
    /// "model" (downloading it, first time only), "sound" (getting a link's audio) or "listening".
    stage: &'static str,
    percent: f64,
}

fn report(app: &AppHandle, id: &str, stage: &'static str, percent: f64) {
    let _ = app.emit("speech-progress", Progress { id, stage, percent });
}

#[derive(Serialize, Clone)]
struct Line<'a> {
    id: &'a str,
    line: Caption,
}

/// A line whisper prints as soon as it has it: "[00:00:04.640 --> 00:00:09.920]  It records…".
fn printed_line(text: &str) -> Option<Caption> {
    let (times, said) = text.strip_prefix('[')?.split_once(']')?;
    let (from, to) = times.split_once("-->")?;
    let text = said.trim().to_string();
    (!text.is_empty()).then_some(Caption { start: seconds(from)?, end: seconds(to)?, text })
}

/// The speech model on disk, downloading it the first time.
async fn model(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("speech");
    let path = dir.join("ggml-base.bin");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() == MODEL_BYTES) {
        return Ok(path);
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make a folder for the speech model: {e}"))?;
    // No overall time limit (the shared client has one): 148 MB can take minutes.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("Couldn't download the speech model: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't download the speech model: its server answered {}.", response.status()));
    }
    let part = dir.join("ggml-base.bin.part");
    let mut file = std::fs::File::create(&part).map_err(|e| format!("Couldn't save the speech model: {e}"))?;
    let (mut done, mut shown) = (0u64, -1.0);
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("The speech model stopped downloading: {e}"))? {
        file.write_all(&chunk).map_err(|e| format!("Couldn't save the speech model: {e}"))?;
        done += chunk.len() as u64;
        let percent = (done as f64 / MODEL_BYTES as f64 * 100.0).floor();
        if percent != shown {
            shown = percent;
            report(app, id, "model", percent);
        }
    }
    drop(file);
    if done != MODEL_BYTES {
        let _ = std::fs::remove_file(&part);
        return Err("The speech model didn't download completely. Try again.".into());
    }
    std::fs::rename(&part, &path).map_err(|e| format!("Couldn't save the speech model: {e}"))?;
    Ok(path)
}

/// Makes captions from what's said in a video: `source` is a file opened in Craftora (`local`) or
/// a fetched link. `id` names its progress events (`speech-progress`).
#[tauri::command]
pub async fn make_captions(
    app: AppHandle,
    opened: State<'_, OpenedFiles>,
    id: String,
    source: String,
    local: bool,
) -> Result<Vec<Caption>, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Not a media id.".into());
    }
    let file = if local {
        let path = normalize(Path::new(&source))?;
        if !opened.contains(&path) {
            return Err("Open the file first.".into());
        }
        Some(path)
    } else if source.starts_with("https://") || source.starts_with("http://") {
        None
    } else {
        return Err("Not a web link.".into());
    };
    let model = model(&app, &id).await?;
    let work = app.path().app_cache_dir().map_err(|e| e.to_string())?.join(format!("speech-{id}"));
    std::fs::create_dir_all(&work).map_err(|e| format!("Couldn't make a working folder: {e}"))?;
    let started = std::time::Instant::now();
    let made = listen(&app, &id, file, &source, &model, &work).await;
    crate::diag::note(format!("captions from the sound: {} in {:.0}s", if made.is_ok() { "made" } else { "failed" }, started.elapsed().as_secs_f64()));
    let _ = std::fs::remove_dir_all(&work);
    made
}

async fn listen(app: &AppHandle, id: &str, file: Option<PathBuf>, link: &str, model: &Path, work: &Path) -> Result<Vec<Caption>, String> {
    let input = match file {
        Some(path) => path,
        None => {
            report(app, id, "sound", 0.0);
            link_sound(app, link, work).await?
        }
    };
    // whisper reads 16 kHz mono WAV.
    let wav = work.join("sound.wav");
    let (input, wav_text) = (input.to_string_lossy().into_owned(), wav.to_string_lossy().into_owned());
    let converted = run_to_end(
        app,
        FFMPEG,
        &["-hide_banner", "-v", "error", "-y", "-i", &input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", &wav_text],
    )
    .await?;
    if !converted.status.success() || !wav.is_file() {
        return Err("Craftora couldn't read this video's sound.".into());
    }

    report(app, id, "listening", 0.0);
    // Half the processor: fetching, the preview and exports stay quick while captions are made.
    let threads = std::thread::available_parallelism().map_or(2, |n| (n.get() / 2).clamp(1, 8)).to_string();
    let (model, out) = (model.to_string_lossy().into_owned(), work.join("captions").to_string_lossy().into_owned());
    let args = ["-m", &model, "-f", &wav_text, "-l", "auto", "-t", &threads, "-ovtt", "-of", &out, "-pp"];
    let (mut rx, _child) = crate::engine::command(app, WHISPER)?
        .args(args)
        .spawn()
        .map_err(|e| format!("Couldn't start whisper: {e}"))?;
    let (mut last_line, mut code) = (String::new(), None);
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                for line in String::from_utf8_lossy(&bytes).lines().map(str::trim).filter(|l| !l.is_empty()) {
                    // "whisper_print_progress_callback: progress =  45%"
                    // Each line goes to the editor right away: a long video's captions fill in as they're made.
                    if let Some(caption) = printed_line(line) {
                        let _ = app.emit("speech-line", Line { id, line: caption });
                        continue;
                    }
                    match line.split("progress =").nth(1).and_then(|p| p.trim().trim_end_matches('%').trim().parse::<f64>().ok()) {
                        Some(percent) => report(app, id, "listening", percent),
                        None => line.clone_into(&mut last_line),
                    }
                }
            }
            CommandEvent::Terminated(end) => code = end.code,
            _ => {}
        }
    }
    if code != Some(0) {
        return Err(format!("Making captions failed: {last_line}"));
    }
    let vtt = std::fs::read_to_string(work.join("captions.vtt")).map_err(|_| "whisper finished but made no captions.".to_string())?;
    Ok(parse_vtt(&vtt))
}

/// Downloads just the sound of a fetched link (with its sign-in, Referer and bot-check settings).
async fn link_sound(app: &AppHandle, link: &str, work: &Path) -> Result<PathBuf, String> {
    let (link_args, _cookies) = crate::signin::link_args(app, link).await;
    let template = work.join("sound.%(ext)s").to_string_lossy().into_owned();
    let engines = sidecar_dir()?.to_string_lossy().into_owned();
    let mut args: Vec<String> = ["--no-playlist", "--no-warnings", "--encoding", "utf-8", "--ffmpeg-location", &engines, "-f", "bestaudio/best", "-o", &template]
        .map(String::from)
        .to_vec();
    args.extend(link_args);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_to_end(app, YT_DLP, &args).await?;
    if !output.status.success() {
        return Err(last_error(&String::from_utf8_lossy(&output.stderr)).unwrap_or_else(|| "Couldn't get the video's sound.".into()));
    }
    std::fs::read_dir(work)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|p| p.file_stem().is_some_and(|s| s == "sound") && p.extension().is_some_and(|e| e != "part" && e != "wav"))
        .ok_or_else(|| "yt-dlp finished but the sound file wasn't found.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_lines_as_whisper_prints_them() {
        let line = printed_line("[00:01:04.640 --> 00:01:09.920]   It records sharp video, even at night.").unwrap();
        assert_eq!((line.start, line.end, line.text.as_str()), (64.64, 69.92, "It records sharp video, even at night."));
        assert!(printed_line("whisper_print_progress_callback: progress =  45%").is_none());
        assert!(printed_line("[00:00:01.000 --> 00:00:02.000]   ").is_none());
    }
}
