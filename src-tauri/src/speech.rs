//! Captions made from the sound, for videos that come without any: whisper.cpp (bundled) listens
//! to the audio with a speech model downloaded once (148 MB, or 190 MB on a graphics card). A song's timed lyrics
//! come from lrclib.net when found; listening runs on this PC.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;

use crate::captions::Caption;
use crate::engine::{ffmpeg_dir, last_error, run_to_end, FFMPEG, WHISPER, YT_DLP};
use crate::local::{normalize, OpenedFiles};

/// A whisper.cpp speech model (multilingual: it finds the language), downloaded once.
struct SpeechModel {
    file: &'static str,
    // shortcut: checks the size, not the SHA-256 (base 60ed5bc3…2efe, small ae85e4a9…11bb); add a hash check if a sha2 crate comes in.
    bytes: u64,
    /// Its `-dtw` preset.
    dtw: &'static str,
}

/// Quick on a laptop processor.
const BASE: SpeechModel = SpeechModel { file: "ggml-base.bin", bytes: 147_951_465, dtw: "base" };
/// On a graphics card (measured on a 12-minute film, RTX 3050): 33% words wrong instead of 36%, fewer lines
/// before their words, and a 1h30 film in ~4.5 min instead of ~7.5. On the processor alone it takes twice as long.
const SMALL: SpeechModel = SpeechModel { file: "ggml-small-q5_1.bin", bytes: 190_085_487, dtw: "small" };

#[derive(Serialize, Clone)]
struct Lines<'a> {
    id: &'a str,
    lines: &'a [Caption],
}

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
async fn model(app: &AppHandle, id: &str, model: &SpeechModel) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("speech");
    let path = dir.join(model.file);
    if std::fs::metadata(&path).is_ok_and(|m| m.len() == model.bytes) {
        return Ok(path);
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make a folder for the speech model: {e}"))?;
    // No overall time limit (the shared client has one): 150–190 MB can take minutes.
    let client = crate::privacy::client_builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", model.file))
        .send()
        .await
        .map_err(|e| format!("Couldn't download the speech model: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't download the speech model: its server answered {}.", response.status()));
    }
    let part = dir.join(format!("{}.part", model.file));
    let mut file = std::fs::File::create(&part).map_err(|e| format!("Couldn't save the speech model: {e}"))?;
    let (mut done, mut shown) = (0u64, -1.0);
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("The speech model stopped downloading: {e}"))? {
        file.write_all(&chunk).map_err(|e| format!("Couldn't save the speech model: {e}"))?;
        done += chunk.len() as u64;
        let percent = (done as f64 / model.bytes as f64 * 100.0).floor();
        if percent != shown {
            shown = percent;
            report(app, id, "model", percent);
        }
    }
    drop(file);
    if done != model.bytes {
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
    lyrics: bool,
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
    // Settings → Preferences → Make captions with: the processor gets exactly what it had before.
    let card = if gpu { graphics_card(&app).await } else { None };
    let chosen = if card.is_some() { &SMALL } else { &BASE };
    let model = model(&app, &id, chosen).await?;
    let work = app.path().app_cache_dir().map_err(|e| e.to_string())?.join(format!("speech-{id}"));
    std::fs::create_dir_all(&work).map_err(|e| format!("Couldn't make a working folder: {e}"))?;
    let started = std::time::Instant::now();
    let made = listen(&app, &id, file, &source, (&model, chosen.dtw), &work, card, lyrics).await;
    crate::diag::note(format!("captions from the sound: {} in {:.0}s", if made.is_ok() { "made" } else { "failed" }, started.elapsed().as_secs_f64()));
    let _ = std::fs::remove_dir_all(&work);
    made
}

async fn listen(app: &AppHandle, id: &str, file: Option<PathBuf>, link: &str, (model, dtw): (&Path, &str), work: &Path, card: Option<u32>, lyrics: bool) -> Result<Vec<Caption>, String> {
    // Reading a long file's sound takes a while too, so it's said for files as well as links.
    report(app, id, "sound", 0.0);
    let (input, title) = match file {
        Some(path) => {
            let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned());
            (path, stem)
        }
        None => (link_sound(app, link, work).await?, std::fs::read_to_string(work.join("title.txt")).ok()),
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
    // whisper reads 16 kHz, 16-bit mono: 32,000 bytes a second after the 44-byte header.
    let length = std::fs::metadata(&wav).map_or(0.0, |m| m.len().saturating_sub(44) as f64 / 32_000.0);
    if lyrics
        && (30.0..=900.0).contains(&length)
        && let Some(title) = title.as_deref().map(str::trim).filter(|t| !t.is_empty())
        && let Some(lines) = song_lyrics(title, length).await.filter(|l| !l.is_empty())
    {
        crate::diag::note("captions: song lyrics found");
        report(app, id, "listening", 100.0);
        return Ok(lines);
    }
    let mut captions: Vec<Caption> = Vec::new();
    let all = pieces(length, &silences);
    for (n, &(from, to)) in all.iter().enumerate() {
        let out = work.join(format!("captions-{n}"));
        whisper_piece(app, id, (model, dtw), &wav_text, &out, card, (from, to, length)).await?;
        let json = std::fs::read_to_string(out.with_extension("json")).map_err(|_| "whisper finished but made no captions.".to_string())?;
        let mut lines = from_whisper_json(&json)?;
        for line in &mut lines {
            fit_to_speech(line, &silences);
        }
        // Each piece's lines go to the editor as soon as it's done: a long video's captions fill in as they're made.
        if n + 1 < all.len() {
            let _ = app.emit("speech-lines", Lines { id, lines: &lines });
        }
        captions.extend(lines);
    }
    // A line at the end of one piece mustn't overlap the first of the next.
    for i in 1..captions.len() {
        let next = captions[i].start;
        captions[i - 1].end = captions[i - 1].end.min(next).max(captions[i - 1].start);
    }
    Ok(captions)
}

/// Where a long sound is cut into pieces of about 5 minutes, so their captions show while the rest is made: in the
/// middle of the quiet stretch nearest each cut (within 30 s), so no word is cut in two.
fn pieces(length: f64, silences: &[(f64, f64)]) -> Vec<(f64, f64)> {
    const PIECE: f64 = 300.0;
    let mut cuts = vec![0.0];
    while let Some(&last) = cuts.last()
        && length - last > PIECE * 1.5
    {
        let target = last + PIECE;
        let quiet = silences.iter().map(|(a, b)| (a + b) / 2.0).filter(|m| (m - target).abs() <= 30.0);
        cuts.push(quiet.min_by(|a, b| (a - target).abs().total_cmp(&(b - target).abs())).unwrap_or(target));
    }
    cuts.push(length.max(0.0));
    cuts.windows(2).map(|w| (w[0], w[1])).collect()
}

/// Runs whisper on `from`–`to` seconds of the sound, writing `out`.json; progress is reported for the whole sound.
async fn whisper_piece(app: &AppHandle, id: &str, (model, dtw): (&Path, &str), wav: &str, out: &Path, card: Option<u32>, (from, to, length): (f64, f64, f64)) -> Result<(), String> {
    // Half the processor: fetching, the preview and exports stay quick while captions are made.
    let threads = std::thread::available_parallelism().map_or(2, |n| (n.get() / 2).clamp(1, 8)).to_string();
    let (model, out) = (model.to_string_lossy().into_owned(), out.to_string_lossy().into_owned());
    let (offset, duration) = (((from * 1000.0) as u64).to_string(), (((to - from) * 1000.0).ceil() as u64).to_string());
    // `-dtw` times each word (`from_whisper_json`; it needs flash attention off), measured 0.1–0.25 s from the
    // speech even under music.
    let device = card.map(|n| n.to_string());
    let mut args = vec!["-m", &model, "-f", wav, "-l", "auto", "-t", &threads, "-ot", &offset, "-d", &duration, "-nfa", "-dtw", dtw, "-ojf", "-of", &out, "-pp"];
    match &device {
        // `-mc 0` (no earlier text carried into the next 30 s): on the graphics card whisper otherwise looped and wrote
        // 3 lines for a 12-minute film. On the processor it isn't needed and it lost lines (23 of 76 against 19).
        Some(n) => args.extend(["-dev", n, "-mc", "0"]),
        None => args.push("-ng"),
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
                // The lines whisper prints as it goes ("[00:00:04.640 --> …] It records…") aren't used: with `-dtw` it
                // prints only some, repeated and out of order. Each piece's JSON is read when it's done instead.
                for line in String::from_utf8_lossy(&bytes).lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('[')) {
                    // "whisper_print_progress_callback: progress =  45%"
                    match line.split("progress =").nth(1).and_then(|p| p.trim().trim_end_matches('%').trim().parse::<f64>().ok()) {
                        Some(percent) => report(app, id, "listening", ((from + (to - from) * percent / 100.0) / length.max(1.0) * 100.0).min(100.0)),
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
    Ok(())
}

#[derive(Deserialize)]
struct WhisperJson {
    transcription: Vec<WhisperSegment>,
}

#[derive(Deserialize)]
struct WhisperSegment {
    /// Milliseconds.
    offsets: WhisperOffsets,
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

/// whisper's full JSON (`-ojf` with `-dtw`) as caption lines, each timed by when its own words are said. A whisper
/// segment can hold several sentences (measured: up to 25 s); shown whole, the editor cut it by letter count and its
/// later sentences showed seconds early. So a line ends at a sentence's end, a pause, or 80 letters.
fn from_whisper_json(json: &str) -> Result<Vec<Caption>, String> {
    // Measured: a word is timed 0.1–0.25 s after it starts; a drawn-out one ("Soooo") about halfway through.
    const LEAD: f64 = 0.2;
    // After the last word's time: the rest of it, and a moment more (unless the next line starts).
    const TAIL: f64 = 0.7;
    // A new line when a word comes this long after the last one, or this long after a comma.
    const PAUSE: f64 = 1.0;
    const COMMA_PAUSE: f64 = 0.5;
    // As much as the editor shows at once (model.ts CAPTION_CHARS).
    const MOST: usize = 80;
    let parsed: WhisperJson = serde_json::from_str(json).map_err(|_| "whisper's captions couldn't be read.".to_string())?;
    let mut lines = Vec::new();
    for segment in parsed.transcription {
        // Its words and punctuation, without special tokens ([_BEG_]) and sound tags. Only words are timed:
        // punctuation is timed seconds late.
        let mut tagged = false;
        let mut groups: Vec<Vec<(&str, Option<f64>)>> = Vec::new();
        let mut last_at: Option<f64> = None;
        for token in segment.tokens.iter().filter(|t| !t.text.starts_with("[_")) {
            let inside = tagged || token.text.contains(['[', '(']);
            tagged = inside && !token.text.contains([']', ')']);
            if inside {
                continue;
            }
            let at = (token.t_dtw >= 0 && token.text.chars().any(char::is_alphanumeric)).then_some(token.t_dtw as f64 / 100.0);
            let new_line = match (groups.last(), at) {
                (None, _) => true,
                (Some(line), Some(at)) if starts_word(&token.text) => {
                    let so_far: String = line.iter().map(|p| p.0).collect();
                    let so_far = so_far.trim();
                    let gap = last_at.map_or(0.0, |last| at - last);
                    so_far.ends_with(['.', '?', '!', '…', '。', '？', '！', '។'])
                        || gap > PAUSE
                        || (so_far.ends_with([',', '，', '、']) && gap >= COMMA_PAUSE)
                        || so_far.chars().count() + token.text.chars().count() > MOST
                }
                _ => false,
            };
            if new_line {
                groups.push(Vec::new());
            }
            groups.last_mut().expect("a line was just started").push((&token.text, at));
            last_at = at.or(last_at);
        }
        for (i, line) in groups.iter().enumerate() {
            let text = without_sound_tags(&line.iter().map(|p| p.0).collect::<String>());
            if !text.chars().any(char::is_alphanumeric) {
                continue;
            }
            let times: Vec<f64> = line.iter().filter_map(|p| p.1).collect();
            let next = groups.get(i + 1).and_then(|g| g.iter().find_map(|p| p.1));
            let (start, end) = match (times.first(), times.last()) {
                (Some(first), Some(last)) => ((first - LEAD).max(0.0), next.map_or(last + TAIL, |n| (last + TAIL).min(n - LEAD))),
                _ => (segment.offsets.from as f64 / 1000.0, segment.offsets.to as f64 / 1000.0),
            };
            lines.push(Caption { start, end: end.max(start + 0.3), text });
        }
    }
    lines.sort_by(|a, b| a.start.total_cmp(&b.start));
    for i in 1..lines.len() {
        let next = lines[i].start;
        lines[i - 1].end = lines[i - 1].end.min(next);
    }
    lines.retain(|c| c.end - c.start >= 0.05);
    Ok(lines)
}

/// Whether a caption line may start at this piece of whisper's text: a new word (after a space), or any letter of a
/// script written without spaces (Thai, Myanmar, Khmer, Japanese, Chinese), never the middle of a word ("So" + "ooo").
fn starts_word(text: &str) -> bool {
    let unspaced = |c: char| matches!(c, '\u{0E00}'..='\u{0EFF}' | '\u{1000}'..='\u{109F}' | '\u{1780}'..='\u{17FF}' | '\u{3040}'..='\u{30FF}' | '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}');
    (text.starts_with(char::is_whitespace) && text.chars().any(char::is_alphanumeric)) || text.chars().next().is_some_and(unspaced)
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

/// The graphics card whisper should use: the first with memory of its own (`uma: 0`); graphics built into the
/// processor share its memory and weren't measured. Asked once: whisper lists the cards, then stops on a dummy model.
async fn graphics_card(app: &AppHandle) -> Option<u32> {
    static FOUND: Mutex<Option<Option<u32>>> = Mutex::new(None);
    if let Some(found) = *FOUND.lock().unwrap() {
        return found;
    }
    let dir = app.path().app_cache_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    let dummy = dir.join("graphics-card-check.bin");
    std::fs::write(&dummy, b"x").ok()?;
    let dummy = dummy.to_string_lossy().into_owned();
    let output = run_to_end(app, WHISPER, &["-m", &dummy, "-f", &dummy]).await.ok()?;
    let found = card_in(&String::from_utf8_lossy(&output.stderr));
    crate::diag::note(format!("captions: graphics card {found:?}"));
    *FOUND.lock().unwrap() = Some(found);
    found
}

/// The card's number in whisper's list: "ggml_vulkan: 0 = NVIDIA GeForce RTX 3050 Laptop GPU (NVIDIA) | uma: 0 | …".
fn card_in(log: &str) -> Option<u32> {
    log.lines().find_map(|line| {
        let (number, rest) = line.trim().strip_prefix("ggml_vulkan: ")?.split_once(" = ")?;
        if rest.contains("| uma: 0 |") { number.trim().parse().ok() } else { None }
    })
}

/// Downloads just the sound of a fetched link (with its sign-in, Referer and bot-check settings).
async fn link_sound(app: &AppHandle, link: &str, work: &Path) -> Result<PathBuf, String> {
    let (link_args, _cookies) = crate::signin::link_args(app, link).await;
    let template = work.join("sound.%(ext)s").to_string_lossy().into_owned();
    let title = work.join("title.txt").to_string_lossy().into_owned();
    let engines = ffmpeg_dir(app)?.to_string_lossy().into_owned();
    let mut args: Vec<String> = [
        "--no-playlist",
        "--no-warnings",
        "--encoding",
        "utf-8",
        "--ffmpeg-location",
        &engines,
        "-f",
        "bestaudio/best",
        "--print-to-file",
        "%(title)s",
        &title,
        "-o",
        &template,
    ]
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

#[derive(Deserialize)]
struct LrcHit {
    #[serde(rename = "trackName")]
    track: Option<String>,
    #[serde(rename = "artistName")]
    artist: Option<String>,
    duration: Option<f64>,
    instrumental: Option<bool>,
    #[serde(rename = "syncedLyrics")]
    synced: Option<String>,
}

/// Timed lyrics for a song from lrclib.net, when a hit matches both its name and its length (within 2 s).
async fn song_lyrics(title: &str, length: f64) -> Option<Vec<Caption>> {
    let mut kept = String::new();
    let mut close = None;
    for c in title.chars() {
        match close {
            Some(end) if c == end => close = None,
            Some(_) => {}
            None if c == '(' => close = Some(')'),
            None if c == '[' => close = Some(']'),
            None if c == '【' => close = Some('】'),
            None => kept.push(c),
        }
    }
    let cleaned = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    let query = if cleaned.is_empty() { title } else { &cleaned };
    let hits: Vec<LrcHit> = crate::privacy::client_builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?
        .get("https://lrclib.net/api/search")
        .query(&[("q", query)])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let synced = hits.into_iter().find_map(|hit| {
        if hit.instrumental.unwrap_or(false) || !hit.duration.is_some_and(|d| (d - length).abs() <= 2.0) || !same_song(query, &hit) {
            return None;
        }
        hit.synced.filter(|s| !s.trim().is_empty())
    })?;
    Some(parse_lrc(&synced, length))
}

fn plain(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// A vlog called "my trip home" mustn't match a song called "Home": unless the query is the song's name alone,
/// it needs the singer's name too.
fn same_song(query: &str, hit: &LrcHit) -> bool {
    let q = plain(query);
    let t = hit.track.as_deref().map(plain).unwrap_or_default();
    let a = hit.artist.as_deref().map(plain).unwrap_or_default();
    !t.is_empty() && (q == t || (!a.is_empty() && q.contains(&t) && q.contains(&a)))
}

// shortcut: lines end at the next line (LRC has no end times; the `lyricsfile` field has word times, not read); a video whose intro differs from the released song by up to 2 s gets lyrics that much early/late.
fn parse_lrc(lrc: &str, length: f64) -> Vec<Caption> {
    let mut entries: Vec<(f64, &str)> = Vec::new();
    for line in lrc.lines() {
        let mut rest = line.trim();
        let mut times = Vec::new();
        while let Some((tag, after)) = rest.strip_prefix('[').and_then(|s| s.split_once(']'))
            && let Some(t) = lrc_time(tag)
        {
            times.push(t);
            rest = after;
        }
        let text = rest.trim();
        for t in times {
            entries.push((t, text));
        }
    }
    entries.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut lines = Vec::new();
    for (i, &(start, text)) in entries.iter().enumerate() {
        if text.is_empty() {
            continue;
        }
        let next = entries.get(i + 1).map_or(length, |e| e.0);
        let end = next.min(start + 10.0).min(length);
        if end - start >= 0.3 {
            lines.push(Caption { start, end, text: text.to_string() });
        }
    }
    lines
}

fn lrc_time(tag: &str) -> Option<f64> {
    let (mins, secs) = tag.split_once(':')?;
    let mins: u32 = mins.parse().ok()?;
    if !secs.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        return None;
    }
    let secs: f64 = secs.parse().ok()?;
    Some(f64::from(mins) * 60.0 + secs)
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
    fn cuts_long_sound_in_quiet_places() {
        // 16:40 of sound, quiet at 4:58–5:02 and 9:40–9:44: cut in the middle of each; the last piece runs to the end.
        let cut = pieces(1000.0, &[(100.0, 101.0), (298.0, 302.0), (580.0, 584.0), (900.0, f64::MAX)]);
        assert_eq!(cut, [(0.0, 300.0), (300.0, 582.0), (582.0, 1000.0)]);
        // No quiet stretch near a cut: cut there anyway. Short sound: one piece.
        assert_eq!(pieces(700.0, &[]), [(0.0, 300.0), (300.0, 700.0)]);
        assert_eq!(pieces(400.0, &[]), [(0.0, 400.0)]);
    }

    #[test]
    fn finds_a_graphics_card_of_its_own() {
        let log = "ggml_vulkan: Found 2 Vulkan devices:\nggml_vulkan: 0 = Intel(R) UHD Graphics (Intel Corporation) | uma: 1 | fp16: 1\nggml_vulkan: 1 = NVIDIA GeForce RTX 3050 Laptop GPU (NVIDIA) | uma: 0 | fp16: 1\n";
        assert_eq!(card_in(log), Some(1));
        assert_eq!(card_in("ggml_vulkan: 0 = Intel(R) UHD Graphics (Intel Corporation) | uma: 1 | fp16: 1"), None);
        assert_eq!(card_in("whisper_init_with_params_no_state: failed to load model"), None);
    }

    #[test]
    fn times_lines_by_their_words() {
        let tok = |text: &str, t_dtw: i64| format!(r#"{{"text":{text:?},"t_dtw":{t_dtw}}}"#);
        let seg = |from: i64, to: i64, text: &str, tokens: &[String]| format!(r#"{{"offsets":{{"from":{from},"to":{to}}},"text":{text:?},"tokens":[{}]}}"#, tokens.join(","));
        // Real output under music: one segment for "I'll come with you, but only this once." and "Did you hear that noise
        // just now?" (said at 30.75–34.55 and 34.90–36.53 s). Shown whole, the second sentence came seconds early.
        let glued = [(" I", 3212), ("'ll", 3220), (" come", 3242), (" with", 3260), (" you", 3286), (",", 3332), (" but", 3350), (" only", 3380), (" this", 3406), (" once", 3436), (",", 3482), (" did", 3500), (" you", 3522), (" hear", 3540), (" that", 3558), (" noise", 3586), (" just", 3618), (" now", 3648), ("?", 3720), ("[_TT_617]", -1)];
        let json = format!(
            r#"{{"transcription":[{},{},{},{},{},{}]}}"#,
            seg(11440, 17320, " Sooo.", &[tok(" So", 1362), tok("ooo", 1380), tok(".", 1512)]),
            seg(30700, 37820, " I'll come with you, but only this once, did you hear that noise just now?", &glued.map(|(t, d)| tok(t, d))),
            seg(37820, 38500, " [Music]", &[tok(" [", 3800), tok("Music", 3810), tok("]", 3820)]),
            seg(38500, 40800, " (laughs) Okay.", &[tok(" (", 3910), tok("laugh", 3920), tok(")", 3930), tok(" Okay", 4000), tok(".", 4040)]),
            seg(41000, 42500, " Again", &[tok(" Again", -1)]),
            seg(42500, 47000, "你好，我们走吧。他来了", &[tok("你好", 4300), tok("，", 4340), tok("我们", 4400), tok("走", 4420), tok("吧", 4440), tok("。", 4460), tok("他", 4600), tok("来了", 4620)]),
        );
        let lines: Vec<(f64, f64, String)> = from_whisper_json(&json)
            .unwrap()
            .into_iter()
            .map(|c| ((c.start * 100.0).round() / 100.0, (c.end * 100.0).round() / 100.0, c.text))
            .collect();
        let expected = [
            // A drawn-out word stays one word, and is still being said after its time.
            (13.42, 14.5, "Soooo."),
            // Cut at the pauses after its commas, each part from its own first word.
            (31.92, 33.3, "I'll come with you,"),
            (33.3, 34.8, "but only this once,"),
            (34.8, 37.18, "did you hear that noise just now?"),
            // The tag's words don't time the line; one without word times keeps whisper's own.
            (39.8, 40.7, "Okay."),
            (41.0, 42.5, "Again"),
            // No spaces: cut between characters, at a pause after a comma and at a sentence's end, timed by its last one.
            (42.8, 43.7, "你好，"),
            (43.8, 45.1, "我们走吧。"),
            (45.8, 46.9, "他来了"),
        ];
        assert_eq!(lines, expected.map(|(a, b, t)| (a, b, t.to_string())));
        assert!(from_whisper_json("not json").is_err());
        assert_eq!(without_sound_tags(" ♪ la la ♪  [Music] (sighs)  bye "), "la la bye");
    }

    #[test]
    fn reads_timed_song_lyrics() {
        let lrc = "\
[ar:Joji]
[00:15.20] (Ooh)
[00:18.50]
[00:22.125]She'd take the world off my shoulders
[00:40.00][01:10.00]Cause sometimes I look in her eyes
[00:43.00]
";
        let lines: Vec<(f64, f64, String)> = parse_lrc(lrc, 120.0).into_iter().map(|c| (c.start, c.end, c.text)).collect();
        assert_eq!(
            lines,
            [
                (15.2, 18.5, "(Ooh)".into()),
                // Over 10 s before the 00:40 line: capped at 10 s.
                (22.125, 32.125, "She'd take the world off my shoulders".into()),
                // Two time tags: same line at 00:40 (ended by the empty 00:43 line) and at 01:10 (capped at 10 s).
                (40.0, 43.0, "Cause sometimes I look in her eyes".into()),
                (70.0, 80.0, "Cause sometimes I look in her eyes".into()),
            ]
        );
        let hit = |track: &str, artist: &str| LrcHit {
            track: Some(track.into()),
            artist: Some(artist.into()),
            duration: Some(234.0),
            instrumental: Some(false),
            synced: None,
        };
        assert!(same_song("Joji - Glimpse of Us", &hit("Glimpse of Us", "Joji")));
        assert!(!same_song("my trip home", &hit("Home", "X")));
        assert!(same_song("Glimpse of Us", &hit("Glimpse of Us", "Joji")));
    }
}
