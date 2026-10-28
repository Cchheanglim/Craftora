//! "Open file": read a video or audio file on this PC with ffprobe, so it can be
//! trimmed and converted offline with FFmpeg alone.

use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::engine::{run_to_end, FFMPEG};
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
    pub fn allow(&self, path: PathBuf) {
        self.0.lock().unwrap().insert(path);
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
    /// e.g. "mov,mp4,m4a,3gp,3g2,mj2" or "avi".
    format_name: Option<String>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
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

async fn run_probe(app: &AppHandle, path: &Path) -> Result<Probe, String> {
    let path_text = path.to_string_lossy();
    let output = run_to_end(
        app,
        FFPROBE,
        &[
            "-v", "error",
            "-probesize", "5M",
            "-analyzeduration", "1M",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &path_text,
        ],
    )
    .await?;
    if !output.status.success() {
        return Err("Craftora can't read this file. It may be damaged or not a video or audio file.".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Unexpected answer from ffprobe: {e}"))
}

impl ProbeStream {
    fn is_video(&self) -> bool {
        // Cover art in music files shows up as a video stream; it isn't video.
        self.codec_type.as_deref() == Some("video") && self.disposition.as_ref().is_none_or(|d| d.attached_pic == 0)
    }
    fn is_audio(&self) -> bool {
        self.codec_type.as_deref() == Some("audio")
    }
}

/// What the export step needs to know about an input file.
pub struct ProbeInfo {
    pub has_video: bool,
    pub has_audio: bool,
}

pub async fn probe(app: &AppHandle, path: &Path) -> Result<ProbeInfo, String> {
    let probe = run_probe(app, path).await?;
    let video = probe.streams.iter().find(|s| s.is_video());
    Ok(ProbeInfo {
        has_video: video.is_some(),
        has_audio: probe.streams.iter().any(|s| s.is_audio()),
    })
}

/// Containers and codecs the WebView2 player opens. Anything else gets a preview copy.
const PLAYABLE_FORMATS: [&str; 8] = ["mp4", "mov", "matroska", "webm", "ogg", "mp3", "wav", "flac"];
const PLAYABLE_VIDEO: [&str; 4] = ["h264", "vp8", "vp9", "av1"];
const PLAYABLE_AUDIO: [&str; 10] =
    ["aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8"];

/// What the preview player needs made before it can play a file.
#[derive(Clone, Copy, PartialEq)]
enum Proxy {
    None,
    /// The picture plays, but the sound (AC-3, DTS, …) doesn't: make an AAC copy of the sound.
    Audio,
    /// The file doesn't play at all (AVI, HEVC, …): make a small H.264 copy.
    Video,
}

impl Proxy {
    fn needed(probe: &Probe) -> Proxy {
        let format = probe.format.format_name.as_deref().unwrap_or("");
        let container_ok = format.split(',').any(|f| PLAYABLE_FORMATS.contains(&f));
        let codec_ok = |s: &ProbeStream, list: &[&str]| s.codec_name.as_deref().is_some_and(|c| list.contains(&c));
        let video = probe.streams.iter().find(|s| s.is_video());
        let audio = probe.streams.iter().find(|s| s.is_audio());
        match (video, audio) {
            (Some(v), _) if !container_ok || !codec_ok(v, &PLAYABLE_VIDEO) => Proxy::Video,
            (_, Some(a)) if !container_ok || !codec_ok(a, &PLAYABLE_AUDIO) => Proxy::Audio,
            _ => Proxy::None,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Proxy::None => "",
            Proxy::Audio => "audio",
            Proxy::Video => "video",
        }
    }
}

/// Where the preview copy of `path` lives. The name changes when the file does.
fn proxy_path(app: &AppHandle, path: &Path, kind: Proxy) -> Result<PathBuf, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Couldn't read the file: {e}"))?;
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    meta.modified().ok().hash(&mut hasher);
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Couldn't find the cache folder: {e}"))?
        .join("previews");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir.join(format!("{:016x}-{}.mp4", hasher.finish(), kind.name())))
}

/// Lets the preview player read `path` through the asset protocol.
pub(crate) fn allow_preview(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|e| format!("Couldn't allow the preview to read the file: {e}"))
}

/// Paths the preview plays for an opened file; empty for a part still to be made.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFiles {
    video: String,
    audio: String,
}

fn preview_files(path: &Path, kind: Proxy, proxy: Option<&Path>, has_video: bool) -> PreviewFiles {
    let text = |p: &Path| p.to_string_lossy().into_owned();
    match (kind, proxy) {
        (Proxy::None, _) => PreviewFiles { video: text(path), audio: String::new() },
        (Proxy::Video, Some(p)) => PreviewFiles { video: text(p), audio: String::new() },
        (Proxy::Video, None) => PreviewFiles::default(),
        // The picture plays from the original (silently) next to the sound copy.
        (Proxy::Audio, p) => PreviewFiles {
            video: if has_video { text(path) } else { String::new() },
            audio: p.map(text).unwrap_or_default(),
        },
    }
}

/// Makes the preview copy for an opened file that needs one (see `open_local`'s
/// `previewProxy`). Takes a few seconds per minute of video; the result is cached.
#[tauri::command]
pub async fn make_preview(app: AppHandle, opened: State<'_, OpenedFiles>, path: String) -> Result<PreviewFiles, String> {
    let path = normalize(Path::new(&path))?;
    if !opened.contains(&path) {
        return Err("Open the file again; Craftora only works on files you've opened.".into());
    }
    let probe = run_probe(&app, &path).await?;
    let kind = Proxy::needed(&probe);
    let has_video = probe.streams.iter().any(|s| s.is_video());
    if kind == Proxy::None {
        return Ok(preview_files(&path, kind, None, has_video));
    }
    let out = proxy_path(&app, &path, kind)?;
    if !out.is_file() {
        let tmp = out.with_extension("part");
        let input = path.to_string_lossy();
        let tmp_text = tmp.to_string_lossy();
        let mut args = vec!["-y", "-hide_banner", "-v", "error", "-i", &input];
        match kind {
            Proxy::Audio => args.extend(["-map", "0:a:0", "-vn", "-sn", "-dn", "-c:a", "aac", "-b:a", "160k", "-ac", "2"]),
            // Small, fast to make, and a keyframe every second so scrubbing stays quick.
            _ => args.extend([
                "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
                "-vf", "scale=-2:'trunc(min(720,ih)/2)*2'",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-pix_fmt", "yuv420p", "-g", "30",
                "-c:a", "aac", "-b:a", "160k", "-ac", "2",
            ]),
        }
        args.extend(["-movflags", "+faststart", "-f", "mp4", &tmp_text]);
        let output = run_to_end(&app, FFMPEG, &args).await?;
        if !output.status.success() {
            let _ = std::fs::remove_file(&tmp);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = stderr.lines().last().unwrap_or("FFmpeg stopped unexpectedly.");
            return Err(format!("Couldn't make a preview copy: {detail}"));
        }
        std::fs::rename(&tmp, &out).map_err(|e| format!("Couldn't save the preview copy: {e}"))?;
    }
    allow_preview(&app, &out)?;
    Ok(preview_files(&path, kind, Some(&out), has_video))
}

/// How long a still image may be shown: effectively unlimited (clips start at 5 seconds).
pub const IMAGE_DURATION: f64 = 24.0 * 3600.0;

/// The picture stream of a still image file (PNG, JPEG, WebP, BMP), if this is one. FFmpeg
/// reads these as a one-frame "video" with no length. Animated GIFs aren't included.
fn still_image<'a>(probe: &'a Probe, path: &Path) -> Option<&'a ProbeStream> {
    let format = probe.format.format_name.as_deref().unwrap_or("");
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let by_format = format
        .split(',')
        .any(|f| f == "image2" || f == "mjpeg" || f == "gif" || f == "apng" || f.ends_with("_pipe"));
    let by_ext = ["png", "jpg", "jpeg", "jfif", "webp", "bmp", "tif", "tiff", "avif", "ico"].contains(&ext.as_str());
    let picture = probe.streams.iter().find(|s| s.codec_type.as_deref() == Some("video"))?;
    ((by_format || by_ext) && !probe.streams.iter().any(|s| s.is_audio())).then_some(picture)
}

/// "30000/1001" → 29.97
fn frame_rate(text: &str) -> Option<f64> {
    let (num, den) = text.split_once('/')?;
    let (num, den): (f64, f64) = (num.parse().ok()?, den.parse().ok()?);
    (den > 0.0 && num > 0.0).then(|| num / den)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickLocal {
    pub path: String,
    pub title: String,
    pub size_mb: f64,
    pub kind: &'static str,
    pub ext: String,
}

/// Authorises a local file for the preview player and returns its basic file info immediately,
/// without waiting for ffprobe to start.
#[tauri::command]
pub fn allow_local(app: AppHandle, opened: State<'_, OpenedFiles>, path: String) -> Result<QuickLocal, String> {
    let raw = PathBuf::from(path);
    if !raw.is_file() {
        return Err("That file doesn't exist or isn't a file.".into());
    }
    let path = normalize(&raw)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("Couldn't read the file: {e}"))?;
    allow_preview(&app, &path)?;
    opened.allow(path.clone());
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let kind = if ["png", "jpg", "jpeg", "jfif", "webp", "bmp", "tif", "tiff", "avif", "ico"].contains(&ext.as_str()) {
        "image"
    } else if ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"].contains(&ext.as_str()) {
        "audio"
    } else {
        "video"
    };
    Ok(QuickLocal {
        path: path.to_string_lossy().into_owned(),
        title: path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".into()),
        size_mb: meta.len() as f64 / 1_000_000.0,
        kind,
        ext,
    })
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
    let probe = run_probe(&app, &path).await?;

    if let Some(image) = still_image(&probe, &path) {
        allow_preview(&app, &path)?;
        opened.0.lock().unwrap().insert(path.clone());
        let size_mb = probe.format.size.as_deref().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0) / 1_000_000.0;
        let label = match (image.width, image.height) {
            (Some(w), Some(h)) => format!("Image · {w}×{h}"),
            _ => "Image".into(),
        };
        return Ok(MediaSource {
            title: path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".into()),
            uploader: "On this PC".into(),
            duration: IMAGE_DURATION,
            local: true,
            preview_url: path_text.clone(),
            preview_has_audio: false,
            preview_audio_url: String::new(),
            preview_hls: false,
            preview_proxy: "",
            image: true,
            thumbnail: String::new(),
            chapters: Vec::new(),
            captions: None,
            streams: vec![Stream { id: "local:image".into(), kind: "video", label, detail: codec_name(image.codec_name.as_deref()), size_mb }],
            live: false,
            download_first: false,
            url: path_text,
        });
    }

    let duration = probe
        .format
        .duration
        .as_deref()
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| *d > 0.0)
        .ok_or("This file has no known length, so it can't be trimmed.")?;
    let total_mb = probe.format.size.as_deref().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0) / 1_000_000.0;

    let video = probe.streams.iter().find(|s| s.is_video());
    let audio = probe.streams.iter().find(|s| s.is_audio());
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
    allow_preview(&app, &path)?;
    opened.0.lock().unwrap().insert(path.clone());

    // Files the player can't open get a preview copy: reuse one made before, or tell the
    // UI to ask for one with `make_preview`.
    let kind = Proxy::needed(&probe);
    let cached = match kind {
        Proxy::None => None,
        _ => proxy_path(&app, &path, kind).ok().filter(|p| p.is_file()),
    };
    if let Some(p) = &cached {
        allow_preview(&app, p)?;
    }
    let files = preview_files(&path, kind, cached.as_deref(), video.is_some());

    Ok(MediaSource {
        title: path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".into()),
        uploader: "On this PC".into(),
        duration,
        local: true,
        // Paths here; the UI turns them into playable asset URLs.
        preview_url: files.video,
        preview_has_audio: audio.is_some(),
        preview_audio_url: files.audio,
        preview_hls: false,
        preview_proxy: if cached.is_some() { "" } else { kind.name() },
        image: false,
        thumbnail: String::new(),
        chapters: Vec::new(),
            captions: None,
        streams,
        live: false,
        download_first: false,
        url: path_text,
    })
}

/// Summarises signed 8-bit mono PCM samples into `bins` loudness bars (0–100).
pub(crate) fn peaks_from_pcm(bytes: &[u8], bins: usize) -> Vec<u8> {
    // 16-bit little-endian samples: quiet speech keeps its shape (8 bits left it a few steps tall).
    let samples: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|&s| i16::from_le_bytes(s).unsigned_abs()).collect();
    if samples.is_empty() || bins == 0 {
        return Vec::new();
    }
    let count = bins.min(samples.len());
    let raw: Vec<u16> = (0..count)
        .map(|i| {
            let a = i * samples.len() / count;
            let b = ((i + 1) * samples.len() / count).max(a + 1);
            samples[a..b].iter().copied().max().unwrap_or(0)
        })
        .collect();
    let peak = u32::from(*raw.iter().max().unwrap_or(&1)).max(1);
    raw.into_iter().map(|v| ((u32::from(v) * 100) / peak).min(100) as u8).collect()
}

/// Reads `silence_start` / `silence_end` lines from FFmpeg's `silencedetect` filter.
pub(crate) fn parse_silences(stderr: &str, offset: f64, max_end: f64) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    let mut start: Option<f64> = None;
    for line in stderr.lines() {
        if let Some(rest) = line.split("silence_start: ").nth(1) {
            start = rest.split_whitespace().next().and_then(|s| s.parse::<f64>().ok()).map(|t| (offset + t).max(offset));
        } else if let Some(rest) = line.split("silence_end: ").nth(1)
            && let Some(s) = start.take()
            && let Some(e) = rest.split_whitespace().next().and_then(|v| v.parse::<f64>().ok()).map(|t| (offset + t).min(max_end))
            && e > s
        {
            out.push((s, e));
        }
    }
    if let Some(s) = start.filter(|s| max_end - *s >= 0.4) {
        out.push((s, max_end));
    }
    out
}

/// Encodes bytes as standard base64 for `data:image/jpeg;base64,…` thumbnails.
pub(crate) fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = *chunk.get(1).unwrap_or(&0) as usize;
        let b2 = *chunk.get(2).unwrap_or(&0) as usize;
        out.push(TABLE[b0 >> 2] as char);
        out.push(TABLE[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 { TABLE[((b1 & 0x0f) << 2) | (b2 >> 6)] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[b2 & 0x3f] as char } else { '=' });
    }
    out
}

/// Decodes standard base64 (the page window's answers in page_fetch.rs); None if it isn't.
pub(crate) fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let digits: Vec<u8> = text.bytes().filter(|&c| c != b'=').collect();
    let mut out = Vec::with_capacity(digits.len() * 3 / 4);
    for chunk in digits.chunks(4) {
        if chunk.len() == 1 {
            return None;
        }
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            n |= u32::from(value(c)?) << (18 - 6 * i);
        }
        out.extend_from_slice(&n.to_be_bytes()[1..chunk.len()]);
    }
    Some(out)
}

/// Extracts a JPEG preview frame from an opened local video or image as a `data:` URL.
#[tauri::command]
pub async fn local_thumbnail(app: AppHandle, opened: State<'_, OpenedFiles>, path: String, image: bool) -> Result<String, String> {
    let path = normalize(Path::new(&path))?;
    if !opened.contains(&path) {
        return Err("Open the file first.".into());
    }
    let input = path.to_string_lossy();
    let scale = if image { "scale='min(960,iw)':-2" } else { "scale='min(480,iw)':-2" };
    let mut output = if !image {
        run_to_end(
            &app,
            FFMPEG,
            &[
                "-hide_banner", "-v", "error", "-ss", "0.5", "-i", &input,
                "-frames:v", "1", "-vf", scale, "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
            ],
        )
        .await?
    } else {
        run_to_end(
            &app,
            FFMPEG,
            &[
                "-hide_banner", "-v", "error", "-i", &input,
                "-frames:v", "1", "-vf", scale, "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
            ],
        )
        .await?
    };
    if !image && (!output.status.success() || output.stdout.is_empty()) {
        output = run_to_end(
            &app,
            FFMPEG,
            &[
                "-hide_banner", "-v", "error", "-i", &input,
                "-frames:v", "1", "-vf", scale, "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
            ],
        )
        .await?;
    }
    if !output.status.success() || output.stdout.is_empty() {
        return Err("Couldn't read a preview frame from this file.".into());
    }
    Ok(format!("data:image/jpeg;base64,{}", base64_encode(&output.stdout)))
}

/// Bars in a sound wave; the editor redoes saved waves of another length (older, wrong ones).
pub(crate) const PEAK_BARS: usize = 300;

/// Reads 300 loudness bars (0–100) across the whole of an opened file's audio for the radio wave.
#[tauri::command]
pub async fn audio_peaks(app: AppHandle, opened: State<'_, OpenedFiles>, path: String) -> Result<Vec<u8>, String> {
    let path = normalize(Path::new(&path))?;
    if !opened.contains(&path) {
        return Err("Open the file first.".into());
    }
    let input = path.to_string_lossy();
    let output = run_to_end(
        &app,
        FFMPEG,
        // How loud, 200 times a second: the sound made positive, then averaged. (Resampling the sound
        // itself to 100 Hz kept only rumble under 50 Hz, so voices drew a flat line.)
        &["-hide_banner", "-v", "error", "-i", &input, "-vn", "-ac", "1", "-af", "aresample=8000,aeval=abs(val(0)),aresample=200", "-f", "s16le", "pipe:1"],
    )
    .await?;
    Ok(peaks_from_pcm(&output.stdout, PEAK_BARS))
}

/// Finds silent stretches `[start, end]` (in media seconds) inside `[start, end]` of an opened file.
#[tauri::command]
pub async fn detect_silences(
    app: AppHandle,
    opened: State<'_, OpenedFiles>,
    path: String,
    start: f64,
    end: f64,
) -> Result<Vec<(f64, f64)>, String> {
    let path = normalize(Path::new(&path))?;
    if !opened.contains(&path) {
        return Err("Open the file first.".into());
    }
    let s = start.max(0.0);
    let e = end.max(s + 0.2);
    let ss = format!("{s:.3}");
    let to = format!("{e:.3}");
    let input = path.to_string_lossy();
    let output = run_to_end(
        &app,
        FFMPEG,
        &[
            "-hide_banner",
            "-nostats",
            "-ss",
            &ss,
            "-to",
            &to,
            "-i",
            &input,
            "-vn",
            "-af",
            "aresample=first_pts=0,silencedetect=n=-35dB:d=0.4",
            "-f",
            "null",
            "-",
        ],
    )
    .await?;
    Ok(parse_silences(&String::from_utf8_lossy(&output.stderr), s, e))
}

#[cfg(test)]
mod tests {
    use super::{base64_decode, base64_encode, parse_silences, peaks_from_pcm};

    #[test]
    fn encodes_bytes_to_base64() {
        assert_eq!(base64_encode(b"Craftora"), "Q3JhZnRvcmE=");
        assert_eq!(base64_encode(&[0xff, 0xd8, 0xff]), "/9j/");
    }

    #[test]
    fn decodes_base64_back() {
        for bytes in [&b""[..], b"C", b"Cr", b"Cra", b"Craftora", &[0xff, 0x00, 0x80, 0x7f]] {
            assert_eq!(base64_decode(&base64_encode(bytes)).as_deref(), Some(bytes));
        }
        assert_eq!(base64_decode("no!"), None);
    }

    #[test]
    fn summarises_pcm_into_normalised_peaks() {
        let pcm: Vec<u8> = [0i16, 1000, 2000, -4000, 8000, 0, 0, -16000].iter().flat_map(|s| s.to_le_bytes()).collect();
        assert_eq!(peaks_from_pcm(&pcm, 2), vec![25, 100]);
    }

    #[test]
    fn parses_ffmpeg_silencedetect_lines() {
        let log = "[silencedetect @ 00] silence_start: 1.25\n[silencedetect @ 00] silence_end: 2.75 | silence_duration: 1.50\n[silencedetect @ 00] silence_start: 4.00\n";
        assert_eq!(parse_silences(log, 10.0, 15.0), vec![(11.25, 12.75), (14.0, 15.0)]);
    }
}
