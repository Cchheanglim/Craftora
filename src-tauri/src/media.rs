//! "Fetch": ask yt-dlp what a link contains and turn it into what the editor needs.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::engine::{last_error, run_to_end, YT_DLP};

/// The subset of `yt-dlp --dump-single-json` that Craftora uses.
#[derive(Deserialize)]
struct Info {
    title: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    duration: Option<f64>,
    is_live: Option<bool>,
    #[serde(default)]
    formats: Vec<Format>,
}

#[derive(Deserialize)]
struct Format {
    format_id: String,
    ext: Option<String>,
    vcodec: Option<String>,
    acodec: Option<String>,
    height: Option<u32>,
    fps: Option<f64>,
    abr: Option<f64>,
    tbr: Option<f64>,
    filesize: Option<f64>,
    filesize_approx: Option<f64>,
    url: Option<String>,
    protocol: Option<String>,
}

impl Format {
    // yt-dlp says "none" for an absent track; a missing field means "unknown", which
    // for direct file links usually means the file has both tracks.
    fn has_video(&self) -> bool {
        self.vcodec.as_deref() != Some("none")
    }
    fn has_audio(&self) -> bool {
        self.acodec.as_deref() != Some("none")
    }
    fn size_mb(&self, duration: f64) -> f64 {
        let bytes = self
            .filesize
            .or(self.filesize_approx)
            .or_else(|| self.tbr.map(|kbps| kbps * 1000.0 / 8.0 * duration))
            .unwrap_or(0.0);
        bytes / 1_000_000.0
    }
    fn plays_in_webview(&self) -> bool {
        let direct = matches!(self.protocol.as_deref(), None | Some("https") | Some("http"));
        direct && matches!(self.ext.as_deref(), Some("mp4") | Some("webm") | Some("m4a")) && self.url.is_some()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    /// A yt-dlp format selector (or `local:video` / `local:audio` for files on disk),
    /// passed back unchanged when a job starts.
    pub(crate) id: String,
    pub(crate) kind: &'static str,
    pub(crate) label: String,
    pub(crate) detail: String,
    pub(crate) size_mb: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSource {
    /// The web link, or the absolute path when `local` is true.
    pub(crate) url: String,
    pub(crate) title: String,
    pub(crate) uploader: String,
    pub(crate) duration: f64,
    /// A file on this PC, handled by FFmpeg alone (no network).
    pub(crate) local: bool,
    /// Directly playable file for the in-app preview; empty when none exists.
    pub(crate) preview_url: String,
    /// False when the only playable preview is a video-only stream (common on YouTube).
    pub(crate) preview_has_audio: bool,
    /// Separate sound stream played in sync with a video-only preview; empty when not needed.
    pub(crate) preview_audio_url: String,
    /// Files on this PC: "audio" or "video" when a preview copy still has to be made
    /// (`make_preview`), empty otherwise.
    pub(crate) preview_proxy: &'static str,
    pub(crate) streams: Vec<Stream>,
}

pub(crate) fn codec_name(codec: Option<&str>) -> String {
    let raw = codec.unwrap_or("");
    let family = raw.split('.').next().unwrap_or(raw);
    match family {
        "avc1" | "avc3" | "h264" => "H.264".into(),
        "hev1" | "hvc1" | "h265" | "hevc" => "HEVC".into(),
        "vp9" | "vp09" => "VP9".into(),
        "av01" => "AV1".into(),
        "mp4a" | "aac" => "AAC".into(),
        "opus" => "Opus".into(),
        "vorbis" => "Vorbis".into(),
        "mp3" => "MP3".into(),
        "" => String::new(),
        other => other.to_uppercase(),
    }
}

fn video_streams(formats: &[Format], duration: f64) -> Vec<Stream> {
    // Best format (highest bitrate) per resolution.
    let mut best: BTreeMap<u32, &Format> = BTreeMap::new();
    for f in formats.iter().filter(|f| f.has_video()) {
        let height = f.height.unwrap_or(0);
        let better = best
            .get(&height)
            .is_none_or(|cur| f.tbr.unwrap_or(0.0) > cur.tbr.unwrap_or(0.0));
        if better {
            best.insert(height, f);
        }
    }

    best.into_values()
        .rev()
        .take(6)
        .map(|f| {
            let progressive = f.has_audio();
            let label = match (f.height, f.fps) {
                (Some(h), Some(fps)) if fps > 0.0 => format!("{h}p · {} fps", fps.round()),
                (Some(h), _) => format!("{h}p"),
                (None, _) => "Original file".into(),
            };
            let video = codec_name(f.vcodec.as_deref());
            let detail = match (video.is_empty(), progressive) {
                (true, _) => f.ext.clone().unwrap_or_default().to_uppercase(),
                (false, true) => format!("{video} + {}", codec_name(f.acodec.as_deref())),
                (false, false) => format!("{video} + best audio"),
            };
            // Video-only formats get the best audio merged in.
            let id = if f.has_audio() {
                f.format_id.clone()
            } else {
                format!("{}+bestaudio/{}", f.format_id, f.format_id)
            };
            let audio_mb = if f.has_audio() { 0.0 } else { duration * 128_000.0 / 8.0 / 1_000_000.0 };
            Stream { id, kind: "video", label, detail, size_mb: f.size_mb(duration) + audio_mb }
        })
        .collect()
}

fn audio_streams(formats: &[Format], duration: f64) -> Vec<Stream> {
    let mut audio: Vec<&Format> = formats.iter().filter(|f| f.has_audio() && !f.has_video()).collect();
    audio.sort_by(|a, b| b.abr.unwrap_or(0.0).total_cmp(&a.abr.unwrap_or(0.0)));

    let mut streams: Vec<Stream> = audio
        .into_iter()
        .take(3)
        .map(|f| Stream {
            id: f.format_id.clone(),
            kind: "audio",
            label: f.abr.map(|k| format!("{} kbps", k.round())).unwrap_or_else(|| "Audio".into()),
            detail: codec_name(f.acodec.as_deref()),
            size_mb: f.size_mb(duration),
        })
        .collect();

    // Sources without a separate audio track: extract it from the video.
    if streams.is_empty() && formats.iter().any(|f| f.has_audio()) {
        streams.push(Stream {
            id: "bestaudio/best".into(),
            kind: "audio",
            label: "From the video".into(),
            detail: "Best available".into(),
            size_mb: duration * 192_000.0 / 8.0 / 1_000_000.0,
        });
    }
    streams
}

/// Picks a direct file the preview player can open: a stream with sound if one exists,
/// otherwise a silent video-only stream (YouTube usually offers only separate streams).
fn preview(formats: &[Format]) -> (String, bool) {
    // Prefer modest resolutions (fast to start, enough to find a cut), then H.264,
    // which every WebView decodes.
    let rank = |f: &&Format| {
        let h = f.height.unwrap_or(480);
        let size = if h <= 720 { 10_000 - h } else { h };
        let h264 = codec_name(f.vcodec.as_deref()) == "H.264";
        (!h264, size)
    };
    let pick = |with_audio: bool| {
        let mut candidates: Vec<&Format> = formats
            .iter()
            .filter(|f| f.has_video() && f.has_audio() == with_audio && f.plays_in_webview())
            .collect();
        candidates.sort_by_key(rank);
        candidates.first().and_then(|f| f.url.clone())
    };
    match pick(true) {
        Some(url) => (url, true),
        None => pick(false).map(|url| (url, false)).unwrap_or_default(),
    }
}

/// The sound stream to play next to a video-only preview: AAC (m4a) first, which every
/// WebView decodes, then the highest bitrate.
fn preview_audio(formats: &[Format]) -> String {
    let mut candidates: Vec<&Format> = formats
        .iter()
        .filter(|f| f.has_audio() && !f.has_video() && f.plays_in_webview())
        .collect();
    candidates.sort_by(|a, b| {
        let aac = |f: &Format| f.ext.as_deref() == Some("m4a");
        aac(b).cmp(&aac(a)).then(b.abr.unwrap_or(0.0).total_cmp(&a.abr.unwrap_or(0.0)))
    });
    candidates.first().and_then(|f| f.url.clone()).unwrap_or_default()
}

/// Runs `yt-dlp --dump-single-json` on a link and maps the result for the editor.
#[tauri::command]
pub async fn fetch_media(app: AppHandle, url: String) -> Result<MediaSource, String> {
    let url = url.trim().to_string();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("That doesn't look like a web link. Paste a link starting with https://".into());
    }

    let output = run_to_end(
        &app,
        YT_DLP,
        &["--dump-single-json", "--no-playlist", "--no-warnings", "--encoding", "utf-8", &url],
    )
    .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(last_error(&stderr).unwrap_or_else(|| "yt-dlp couldn't read this link.".into()));
    }

    let info: Info = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Unexpected answer from yt-dlp: {e}"))?;

    if info.is_live == Some(true) {
        return Err("Live streams can't be trimmed yet. Try again once the stream has ended.".into());
    }
    let duration = info
        .duration
        .filter(|d| *d > 0.0)
        .ok_or("This link has no known length, so it can't be trimmed.")?;

    let mut streams = video_streams(&info.formats, duration);
    streams.extend(audio_streams(&info.formats, duration));
    if streams.is_empty() {
        return Err("No downloadable video or audio was found at this link.".into());
    }

    let (preview_url, preview_has_audio) = preview(&info.formats);
    let preview_audio_url = if preview_has_audio || preview_url.is_empty() { String::new() } else { preview_audio(&info.formats) };
    Ok(MediaSource {
        url,
        title: info.title.unwrap_or_else(|| "Untitled".into()),
        uploader: info.uploader.or(info.channel).unwrap_or_default(),
        duration,
        local: false,
        preview_url,
        preview_has_audio,
        preview_audio_url,
        preview_proxy: "",
        streams,
    })
}
