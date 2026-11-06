//! Captions made from the sound, for videos that come without any: whisper.cpp (bundled) listens
//! to the audio with a speech model downloaded once (~148 MB). Everything runs on this PC.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;

use crate::captions::Caption;
use crate::engine::{ffmpeg_dir, last_error, run_to_end, FFMPEG, WHISPER, YT_DLP};
use crate::local::{normalize, OpenedFiles};

/// whisper.cpp's multilingual "base" model: quick on a laptop processor, and it finds the language.
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
// shortcut: checks the size, not the SHA-256 (60ed5bc3…2efe); add a hash check if a sha2 crate comes in.
const MODEL_BYTES: u64 = 147_951_465;

#[derive(Serialize, Clone)]
struct Progress<'a> {
    id: &'a str,
    /// "model" (downloading it, first time only), "sound" (getting and reading the audio) or "listening".
    stage: &'static str,
    percent: f64,
}

fn report(app: &AppHandle, id: &str, stage: &'static str, percent: f64) {
    let _ = app.emit("speech-progress", Progress { id, stage, percent });
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
    let client = crate::privacy::client_builder()
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
    gpu: bool,
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
    let made = listen(&app, &id, file, &source, &model, &work, gpu).await;
    crate::diag::note(format!("captions from the sound: {} in {:.0}s", if made.is_ok() { "made" } else { "failed" }, started.elapsed().as_secs_f64()));
    let _ = std::fs::remove_dir_all(&work);
    made
}

async fn listen(app: &AppHandle, id: &str, file: Option<PathBuf>, link: &str, model: &Path, work: &Path, gpu: bool) -> Result<Vec<Caption>, String> {
    // Reading a long file's sound takes a while too, so it's said for files as well as links.
    report(app, id, "sound", 0.0);
    let input = match file {
        Some(path) => path,
        None => link_sound(app, link, work).await?,
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

    // Where it's quiet, to fit each line to its words (`fit_to_speech`). Quick, even for hours of sound.
    let silences = run_to_end(app, FFMPEG, &["-hide_banner", "-nostats", "-i", &wav_text, "-af", "silencedetect=n=-35dB:d=0.4", "-f", "null", "-"])
        .await
        .map(|o| crate::local::parse_silences(&String::from_utf8_lossy(&o.stderr), 0.0, f64::MAX))
        .unwrap_or_default();

    report(app, id, "listening", 0.0);
    // Half the processor: fetching, the preview and exports stay quick while captions are made.
    let threads = std::thread::available_parallelism().map_or(2, |n| (n.get() / 2).clamp(1, 8)).to_string();
    let (model, out) = (model.to_string_lossy().into_owned(), work.join("captions").to_string_lossy().into_owned());
    // `-dtw` times each word (`from_whisper_json`; it needs flash attention off), measured 0.1–0.25 s from the
    // speech even under music. `-mc 0`: no earlier text carried into the next 30 s, which made whisper repeat a
    // line over what came after. Together ~10% slower than before.
    let mut args = vec!["-m", &model, "-f", &wav_text, "-l", "auto", "-t", &threads, "-mc", "0", "-nfa", "-dtw", "base", "-ojf", "-of", &out, "-pp"];
    // Settings → Preferences → Make captions with: Processor. Otherwise whisper takes the graphics card when it finds one.
    if !gpu {
        args.push("-ng");
    }
    let (mut rx, child) = crate::engine::command(app, WHISPER)?
        .args(args)
        .spawn()
        .map_err(|e| format!("Couldn't start whisper: {e}"))?;
    let _tied = crate::engine::tie(child.pid());
    let (mut last_line, mut code) = (String::new(), None);
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                // Lines whisper prints as it goes ("[00:00:04.640 --> …] It records…") aren't shown any more:
                // with `-dtw` it prints only some, repeated and out of order (3 of 56 in 7 minutes).
                for line in String::from_utf8_lossy(&bytes).lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('[')) {
                    // "whisper_print_progress_callback: progress =  45%"
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
    let json = std::fs::read_to_string(work.join("captions.json")).map_err(|_| "whisper finished but made no captions.".to_string())?;
    let mut captions = from_whisper_json(&json)?;
    for caption in &mut captions {
        fit_to_speech(caption, &silences);
    }
    Ok(captions)
}

#[derive(Deserialize)]
struct WhisperJson {
    transcription: Vec<WhisperSegment>,
}

#[derive(Deserialize)]
struct WhisperSegment {
    /// Milliseconds.
    offsets: WhisperOffsets,
    text: String,
    tokens: Vec<WhisperToken>,
}

#[derive(Deserialize)]
struct WhisperOffsets {
    from: i64,
    to: i64,
}

#[derive(Deserialize)]
struct WhisperToken {
    text: String,
    /// Hundredths of a second; -1 when it has none.
    t_dtw: i64,
}

/// whisper's full JSON (`-ojf` with `-dtw`) as caption lines, each timed by when its words are said. Its own
/// line times start where the last line ended: seconds before the words, under music most of all.
fn from_whisper_json(json: &str) -> Result<Vec<Caption>, String> {
    // Measured: a line's first word is timed 0.1–0.25 s late, its last one about when the line ends.
    const LEAD: f64 = 0.2;
    const TAIL: f64 = 0.4;
    let parsed: WhisperJson = serde_json::from_str(json).map_err(|_| "whisper's captions couldn't be read.".to_string())?;
    let mut lines = Vec::new();
    for segment in parsed.transcription {
        let text = without_sound_tags(&segment.text);
        if !text.chars().any(char::is_alphanumeric) {
            continue;
        }
        // Words only: punctuation is timed seconds late, special tokens ([_BEG_]) and sound tags not at all.
        let mut tagged = false;
        let times: Vec<f64> = segment
            .tokens
            .iter()
            .filter(|t| !t.text.starts_with("[_"))
            .filter_map(|t| {
                let inside = tagged || t.text.contains(['[', '(']);
                tagged = inside && !t.text.contains([']', ')']);
                (!inside && t.t_dtw >= 0 && t.text.chars().any(char::is_alphanumeric)).then_some(t.t_dtw as f64 / 100.0)
            })
            .collect();
        let (start, end) = match (times.first(), times.last()) {
            (Some(first), Some(last)) => ((first - LEAD).max(0.0), last + TAIL),
            _ => (segment.offsets.from as f64 / 1000.0, segment.offsets.to as f64 / 1000.0),
        };
        lines.push(Caption { start, end: end.max(start + 0.3), text });
    }
    lines.sort_by(|a, b| a.start.total_cmp(&b.start));
    for i in 1..lines.len() {
        let next = lines[i].start;
        lines[i - 1].end = lines[i - 1].end.min(next);
    }
    lines.retain(|c| c.end - c.start >= 0.05);
    Ok(lines)
}

/// Text without whisper's sound tags ("[Music]", "(laughs)", "♪"): the small model calls cries and groans music.
fn without_sound_tags(text: &str) -> String {
    let mut kept = String::new();
    let mut close = None;
    for c in text.chars() {
        match close {
            Some(end) if c == end => close = None,
            Some(_) => {}
            None if c == '[' => close = Some(']'),
            None if c == '(' => close = Some(')'),
            None if !matches!(c, '♪' | '♫' | '♬' | '♩') => kept.push(c),
            None => {}
        }
    }
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Trims a line to the sound inside it. whisper starts a line where the last one ended and ends it
/// where the next one begins, so lines showed seconds before their words and stayed through the
/// silence after (measured: speech at 3.1–6.1 s was captioned 0–11 s). Under music nothing is quiet,
/// and the line keeps its words' times (`from_whisper_json`).
fn fit_to_speech(caption: &mut Caption, silences: &[(f64, f64)]) {
    // Sound shorter than this at a line's edge is the neighbouring line's word, not this one's.
    const SHORTEST: f64 = 0.3;
    // Stays up a moment after the last word, as subtitles do.
    const LINGER: f64 = 0.3;
    let mut sounds = Vec::new();
    let mut at = caption.start;
    for &(quiet_from, quiet_to) in silences.iter().filter(|(a, b)| *b > caption.start && *a < caption.end) {
        if quiet_from > at {
            sounds.push((at, quiet_from));
        }
        at = at.max(quiet_to);
    }
    if caption.end > at {
        sounds.push((at, caption.end));
    }
    sounds.retain(|(a, b)| b - a >= SHORTEST);
    if let (Some(first), Some(last)) = (sounds.first(), sounds.last()) {
        caption.end = (last.1 + LINGER).min(caption.end);
        caption.start = first.0;
    }
}

/// Downloads just the sound of a fetched link (with its sign-in, Referer and bot-check settings).
async fn link_sound(app: &AppHandle, link: &str, work: &Path) -> Result<PathBuf, String> {
    let (link_args, _cookies) = crate::signin::link_args(app, link).await;
    let template = work.join("sound.%(ext)s").to_string_lossy().into_owned();
    let engines = ffmpeg_dir(app)?.to_string_lossy().into_owned();
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
    fn lines_fit_their_words() {
        // Measured on Windows speech with pauses: whisper said 0–11, 11–20 and 20–22.04 s.
        let silences = [(0.0, 3.13), (3.81, 4.24), (6.14, 11.05), (12.12, 12.6), (13.92, 19.84), (21.89, f64::MAX)];
        let fitted: Vec<(f64, f64)> = [(0.0, 11.0), (11.0, 20.0), (20.0, 22.04)]
            .into_iter()
            .map(|(start, end)| {
                let mut c = Caption { start, end, text: "x".into() };
                fit_to_speech(&mut c, &silences);
                ((c.start * 100.0).round() / 100.0, (c.end * 100.0).round() / 100.0)
            })
            .collect();
        assert_eq!(fitted, [(3.13, 6.44), (11.05, 14.22), (20.0, 22.04)]);
        // All quiet (or music only): whisper's times stay.
        let mut c = Caption { start: 1.0, end: 2.0, text: "x".into() };
        fit_to_speech(&mut c, &[(0.0, 5.0)]);
        assert_eq!((c.start, c.end), (1.0, 2.0));
    }

    #[test]
    fn times_lines_by_their_words() {
        // Real output under music (trimmed): whisper said 14.56–22.76 and 22.76–32.18 s; the words were at 17.8–20.3 and 22.7–25.1.
        let tok = |text: &str, t_dtw: i64| format!(r#"{{"text":{text:?},"t_dtw":{t_dtw}}}"#);
        let seg = |from: i64, to: i64, text: &str, tokens: &[String]| format!(r#"{{"offsets":{{"from":{from},"to":{to}}},"text":{text:?},"tokens":[{}]}}"#, tokens.join(","));
        let json = format!(
            r#"{{"transcription":[{},{},{},{},{}]}}"#,
            seg(14560, 22760, " No, no, no.", &[tok(" No", 1796), tok(",", 1974), tok(" no", 2022), tok(" no", 2132), tok(".", 2138), tok("[_TT_1138]", -1)]),
            seg(22760, 32180, " He served short to the forehand and won the point.", &[tok("[_BEG_]", -1), tok(" He", 2284), tok(" point", 2510), tok(".", 2924)]),
            seg(32180, 33000, " [Music]", &[tok(" [", 3300), tok("Music", 3310), tok("]", 3320)]),
            seg(33000, 36000, " (laughs) Okay.", &[tok(" (", 3310), tok("laugh", 3320), tok(")", 3330), tok(" Okay", 3400)]),
            seg(36000, 37500, " Again", &[tok(" Again", -1)]),
        );
        let lines: Vec<(f64, f64, String)> = from_whisper_json(&json)
            .unwrap()
            .into_iter()
            .map(|c| ((c.start * 100.0).round() / 100.0, (c.end * 100.0).round() / 100.0, c.text))
            .collect();
        assert_eq!(
            lines,
            [
                (17.76, 21.72, "No, no, no.".to_string()),
                (22.64, 25.5, "He served short to the forehand and won the point.".to_string()),
                // The tag's words don't time the line; one without word times keeps whisper's own.
                (33.8, 34.4, "Okay.".to_string()),
                (36.0, 37.5, "Again".to_string()),
            ]
        );
        assert!(from_whisper_json("not json").is_err());
        assert_eq!(without_sound_tags(" ♪ la la ♪  [Music] (sighs)  bye "), "la la bye");
    }
}
