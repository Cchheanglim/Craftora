//! "Fetch": ask yt-dlp what a link contains and turn it into what the editor needs.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::engine::{last_error, run_to_end, YT_DLP};

/// The subset of `yt-dlp --dump-single-json` that Craftora uses.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub title: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Deserialize)]
struct RawChapter {
    title: Option<String>,
    #[serde(alias = "start_time")]
    start: Option<f64>,
    #[serde(alias = "end_time")]
    end: Option<f64>,
}

#[derive(Deserialize)]
struct Info {
    title: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    duration: Option<f64>,
    is_live: Option<bool>,
    thumbnail: Option<String>,
    #[serde(default)]
    chapters: Option<Vec<RawChapter>>,
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
    /// HLS formats: the master playlist that lists every quality and the sound.
    manifest_url: Option<String>,
    /// Headers the site's video servers want, such as the page as `Referer`.
    #[serde(default)]
    http_headers: BTreeMap<String, String>,
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
    fn is_hls(&self) -> bool {
        self.protocol.as_deref().is_some_and(|p| p.starts_with("m3u8"))
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
    /// `preview_url` is a stream playlist (HLS): played by the WebView itself, or with hls.js through
    /// the relay in media_cache.rs when its server wants the page it came from.
    pub(crate) preview_hls: bool,
    /// Files on this PC: "audio" or "video" when a preview copy still has to be made
    /// (`make_preview`), empty otherwise.
    pub(crate) preview_proxy: &'static str,
    /// A still picture (PNG, JPEG…) rather than a video; it can be shown for any length.
    pub(crate) image: bool,
    /// Links: the site's picture for the video; empty when there is none.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub(crate) thumbnail: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) chapters: Vec<Chapter>,
    pub(crate) streams: Vec<Stream>,
    /// A stream that is live now: no length yet; the editor records it (live.rs).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(crate) live: bool,
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

/// Reads `mediaPresentationDuration="PT1H2M3.5S"` from a DASH (.mpd) manifest.
pub(crate) fn parse_mpd_duration(xml: &str) -> Option<f64> {
    let after = xml.split("mediaPresentationDuration=\"").nth(1)?;
    let iso = after.split('"').next()?.strip_prefix("PT")?;
    let mut total = 0.0;
    let mut num = String::new();
    for ch in iso.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            num.push(ch);
        } else {
            let v: f64 = num.parse().ok()?;
            num.clear();
            total += match ch {
                'H' => v * 3600.0,
                'M' => v * 60.0,
                'S' => v,
                _ => return None,
            };
        }
    }
    (total > 0.0).then_some(total)
}

/// A file's length in seconds, read by FFprobe from its header (or from a DASH manifest).
async fn probe_length(app: &AppHandle, file: &str, page: Option<&str>) -> Option<f64> {
    // No line breaks from a page address: they would let it add headers of its own.
    let headers = page.map(|p| format!("Referer: {}\r\n", p.replace(['\r', '\n'], "")));
    let mut args = vec!["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"];
    if let Some(headers) = &headers {
        args.extend(["-headers", headers]);
    }
    args.push(file);
    if let Some(d) = run_to_end(app, crate::local::FFPROBE, &args)
        .await
        .ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .filter(|d: &f64| *d > 0.0)
    {
        return Some(d);
    }
    if !file.to_ascii_lowercase().contains(".mpd") {
        return None;
    }
    let mut req = crate::media_cache::client().get(file);
    if let Some(page) = page {
        req = req.header(reqwest::header::REFERER, page);
    }
    let xml = req.send().await.ok()?.text().await.ok()?;
    parse_mpd_duration(&xml)
}

/// A stream playlist (HLS) for sites that only offer those: the master playlist when there is
/// one, so the player picks the quality and finds the sound, otherwise the smallest video.
fn hls_preview(formats: &[Format]) -> Option<String> {
    let mut hls: Vec<&Format> = formats.iter().filter(|f| f.is_hls() && f.has_video()).collect();
    hls.sort_by_key(|f| f.height.unwrap_or(480));
    let first = hls.first()?;
    first.manifest_url.clone().or_else(|| first.url.clone())
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

/// Pictures bigger than this aren't thumbnails.
const MAX_THUMBNAIL_BYTES: u64 = 8 * 1024 * 1024;

/// A video's picture, fetched once with the page it belongs to as Referer: some sites refuse
/// their pictures to other pages ("hotlink protection"). The UI keeps a small copy, so the site
/// isn't asked again each time the picture shows.
#[tauri::command]
pub async fn fetch_thumbnail(url: String, link: String) -> Result<tauri::ipc::Response, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Not a web picture.".into());
    }
    let (page, found_on) = crate::signin::split_referer(&link);
    let response = crate::media_cache::client()
        .get(&url)
        .header(reqwest::header::REFERER, found_on.unwrap_or(page))
        .send()
        .await
        .map_err(|e| format!("Couldn't load the picture: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("The picture's server answered {}.", response.status()));
    }
    if response.content_length().is_some_and(|n| n > MAX_THUMBNAIL_BYTES) {
        return Err("The picture is too big.".into());
    }
    let bytes = response.bytes().await.map_err(|e| format!("The picture stopped loading: {e}"))?;
    if bytes.len() as u64 > MAX_THUMBNAIL_BYTES {
        return Err("The picture is too big.".into());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

/// Runs `yt-dlp --dump-single-json` on a link and maps the result for the editor.
#[tauri::command]
pub async fn fetch_media(app: AppHandle, url: String) -> Result<MediaSource, String> {
    let url = url.trim().to_string();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("That doesn't look like a web link. Paste a link starting with https://".into());
    }

    let mut args: Vec<String> = ["--dump-single-json", "--no-playlist", "--no-warnings", "--encoding", "utf-8"].map(String::from).to_vec();
    let (link, _cookie_file) = crate::signin::link_args(&app, &url).await;
    args.extend(link);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_to_end(&app, YT_DLP, &args).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(last_error(&stderr).unwrap_or_else(|| "yt-dlp couldn't read this link.".into()));
    }

    let info: Info = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Unexpected answer from yt-dlp: {e}"))?;

    if info.is_live == Some(true) {
        // Nothing to preview or trim until `record_live` has saved the first part.
        return Ok(MediaSource {
            url,
            title: info.title.unwrap_or_else(|| "Live stream".into()),
            uploader: info.uploader.or(info.channel).unwrap_or_default(),
            duration: 0.0,
            local: false,
            preview_url: String::new(),
            preview_has_audio: true,
            preview_audio_url: String::new(),
            preview_hls: false,
            preview_proxy: "",
            image: false,
            thumbnail: info.thumbnail.unwrap_or_default(),
            chapters: Vec::new(),
            streams: vec![Stream { id: "live".into(), kind: "video", label: "Live".into(), detail: "Recording".into(), size_mb: 0.0 }],
            live: true,
        });
    }
    // The page the site's servers want: the one a found video came from, or the Referer yt-dlp says
    // they need. The length probe, the preview cache and the HLS relay send it (media_cache.rs).
    let site_page = info.formats.iter().find_map(|f| f.http_headers.get("Referer").cloned());
    let page = crate::signin::split_referer(&url).1.map(str::to_string).or(site_page);
    let duration = match info.duration.filter(|d| *d > 0.0) {
        Some(d) => d,
        // Plain video-file and DASH (.mpd) links: yt-dlp doesn't open the file, so it reports no length.
        None => match info.formats.iter().find_map(|f| f.url.as_deref().or(f.manifest_url.as_deref())) {
            Some(file) => probe_length(&app, file, page.as_deref()).await,
            None => None,
        }
        .ok_or("This link has no known length, so it can't be trimmed.")?,
    };

    let mut streams = video_streams(&info.formats, duration);
    streams.extend(audio_streams(&info.formats, duration));
    if streams.is_empty() {
        return Err("No downloadable video or audio was found at this link.".into());
    }

    let (preview_url, preview_has_audio, preview_hls) = match preview(&info.formats) {
        (url, audio) if !url.is_empty() => (url, audio, false),
        // Only stream playlists, which the WebView plays itself; the master one carries the sound.
        _ => hls_preview(&info.formats).map_or((String::new(), false, false), |url| (url, true, true)),
    };
    let preview_audio_url = if preview_has_audio || preview_url.is_empty() { String::new() } else { preview_audio(&info.formats) };
    let with_page = |preview: String| match &page {
        Some(page) if !preview.is_empty() => format!("{preview}{}{page}", crate::signin::REFERER_MARK),
        _ => preview,
    };
    let (preview_url, preview_audio_url) = (with_page(preview_url), with_page(preview_audio_url));
    Ok(MediaSource {
        url,
        title: info.title.unwrap_or_else(|| "Untitled".into()),
        uploader: info.uploader.or(info.channel).unwrap_or_default(),
        duration,
        local: false,
        preview_url,
        preview_has_audio,
        preview_audio_url,
        preview_hls,
        preview_proxy: "",
        image: false,
        thumbnail: info.thumbnail.unwrap_or_default(),
        chapters: info
            .chapters
            .unwrap_or_default()
            .into_iter()
            .filter_map(|c| {
                let (start, end) = (c.start?, c.end?);
                (end > start && start >= 0.0).then(|| Chapter {
                    title: c.title.unwrap_or_else(|| "Chapter".into()),
                    start,
                    end,
                })
            })
            .collect(),
        streams,
        live: false,
    })
}

/// What to record from a live link: FFmpeg inputs (the best stream with picture and sound, or
/// picture and sound as two inputs), each with the headers its server wants.
pub(crate) async fn live_inputs(app: &AppHandle, url: &str) -> Result<Vec<(String, BTreeMap<String, String>)>, String> {
    let mut args: Vec<String> = ["--dump-single-json", "--no-playlist", "--no-warnings", "--encoding", "utf-8"].map(String::from).to_vec();
    let (link, _cookie_file) = crate::signin::link_args(app, url).await;
    args.extend(link);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_to_end(app, YT_DLP, &args).await?;
    if !output.status.success() {
        return Err(last_error(&String::from_utf8_lossy(&output.stderr)).unwrap_or_else(|| "yt-dlp couldn't read this link.".into()));
    }
    let info: Info = serde_json::from_slice(&output.stdout).map_err(|e| format!("Unexpected answer from yt-dlp: {e}"))?;
    if info.is_live != Some(true) {
        return Err("This stream isn't live any more. Fetch the link again to edit the saved video.".into());
    }
    pick_live(&info.formats).ok_or_else(|| "No stream to record was found at this link.".into())
}

fn pick_live(formats: &[Format]) -> Option<Vec<(String, BTreeMap<String, String>)>> {
    let input = |f: &Format| Some((f.url.clone()?, f.http_headers.clone()));
    let quality = |f: &&Format| (f.height.unwrap_or(0), f.tbr.unwrap_or(0.0) as u64);
    let usable = || formats.iter().filter(|f| f.url.is_some() && f.protocol.as_deref() != Some("mhtml"));
    if let Some(both) = usable().filter(|f| f.has_video() && f.has_audio()).max_by_key(quality) {
        return Some(vec![input(both)?]);
    }
    let video = usable().filter(|f| f.has_video()).max_by_key(quality);
    let audio = usable().filter(|f| f.has_audio()).max_by_key(|f| f.abr.or(f.tbr).unwrap_or(0.0) as u64);
    match (video, audio) {
        (Some(v), Some(a)) => Some(vec![input(v)?, input(a)?]),
        (Some(only), None) | (None, Some(only)) => Some(vec![input(only)?]),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_mpd_duration, Info};

    #[test]
    fn reads_dash_mpd_duration() {
        let xml = r#"<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1H2M3.5S"></MPD>"#;
        assert_eq!(parse_mpd_duration(xml), Some(3723.5));
        assert_eq!(parse_mpd_duration(r#"<MPD mediaPresentationDuration="PT95.25S">"#), Some(95.25));
        assert_eq!(parse_mpd_duration("<MPD type=\"dynamic\">"), None);
    }

    #[test]
    fn accepts_null_chapters_from_yt_dlp() {
        let json = br#"{"title":"Test","duration":12.0,"chapters":null,"formats":[]}"#;
        let info: Info = serde_json::from_slice(json).unwrap();
        assert!(info.chapters.is_none());
    }
}
