//! Captions that come with a fetched video (the uploader's own, or the site's automatic ones):
//! which track to use, and its WebVTT file as timed lines for the preview and the timeline.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// One of yt-dlp's `subtitles` / `automatic_captions` entries (one per file format).
#[derive(Deserialize)]
pub(crate) struct SubFormat {
    ext: Option<String>,
    url: Option<String>,
    name: Option<String>,
    /// "m3u8_native" for a stream's caption track (a list of WebVTT pieces).
    protocol: Option<String>,
}

impl SubFormat {
    /// A stream's caption track: yt-dlp marks it as one, or (when it couldn't read it) gives no caption file type.
    fn stream_track(&self) -> bool {
        self.protocol.as_deref() == Some("m3u8_native") || !is_caption_format(self.ext.as_deref())
    }

    /// A stream's caption track without a name (yt-dlp leaves them out): `stream_names` reads them.
    pub(crate) fn nameless_stream_track(&self) -> bool {
        self.name.is_none() && self.stream_track()
    }
}

/// The caption track chosen for a video.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// Its WebVTT file.
    pub(crate) url: String,
    /// Such as "English" or "English (automatic)".
    pub(crate) label: String,
}

/// A line of captions, in media seconds (timeline seconds when saved as .srt).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Caption {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Picks the uploader's captions in the video's language (else English, else any), or failing that
/// the site's automatic ones in the video's original language. None when there are none as WebVTT.
pub(crate) fn pick(
    manual: &BTreeMap<String, Vec<SubFormat>>,
    automatic: &BTreeMap<String, Vec<SubFormat>>,
    language: Option<&str>,
) -> Option<Track> {
    // "en-US" → "en": tracks are keyed by the plain language.
    let lang = language.unwrap_or("en").split('-').next().unwrap_or("en");
    let is = |key: &str, l: &str| key == l || key.starts_with(&format!("{l}-"));
    let vtt = |(key, list): (&String, &Vec<SubFormat>), automatic: bool| {
        // Not a stream's tracks: those load only when asked ("Captions from the website").
        let file = list.iter().find(|f| f.ext.as_deref() == Some("vtt") && !f.stream_track())?;
        let name = file.name.clone().unwrap_or_else(|| key.clone());
        let name = name.trim_end_matches(" - Original").trim_end_matches(" (Original)").to_string();
        Some(Track { url: file.url.clone()?, label: if automatic { format!("{name} (automatic)") } else { name } })
    };
    // Live replays list their chat as a "subtitle".
    let own = || manual.iter().filter(|(k, _)| k.as_str() != "live_chat");
    let mine = own().find(|(k, _)| is(k, lang)).or_else(|| own().find(|(k, _)| is(k, "en"))).or_else(|| own().next());
    // Automatic ones come in every language by machine translation; "-orig" marks what was said, one per
    // audio track when the video is dubbed, so the video's own language comes first.
    let orig = format!("{lang}-orig");
    let auto = automatic
        .get_key_value(&orig)
        .or_else(|| automatic.get_key_value(lang))
        .or_else(|| automatic.iter().find(|(k, _)| k.ends_with("-orig")));
    mine.and_then(|m| vtt(m, false)).or_else(|| auto.and_then(|a| vtt(a, true)))
}

/// The languages "Captions from the website" offers: code, the three-letter code some sites use, name.
const SITE_LANGUAGES: [(&str, &str, &str); 2] = [("en", "eng", "English"), ("km", "khm", "Khmer")];

/// The website's caption tracks in `SITE_LANGUAGES`, for the Transcript's "Captions from the website": the
/// uploader's own first, then the site's automatic ones. `names`: a track's name by its address, read from the
/// stream's list (`stream_track_names`: yt-dlp leaves them out there).
pub(crate) fn site_tracks(
    manual: &BTreeMap<String, Vec<SubFormat>>,
    automatic: &BTreeMap<String, Vec<SubFormat>>,
    names: &BTreeMap<String, String>,
) -> Vec<Track> {
    let mut tracks: Vec<Track> = Vec::new();
    for (is_automatic, list) in [(false, manual), (true, automatic)] {
        for (key, formats) in list {
            let Some(language) = site_language(key) else { continue };
            // Automatic ones: "en-orig" is what was said, "en" the same machine-made; the original wins.
            if is_automatic && !key.ends_with("-orig") && list.contains_key(&format!("{key}-orig")) {
                continue;
            }
            // A stream's tracks are each a track of their own (a list of WebVTT pieces). Otherwise it's one
            // track in several formats (vtt, srv3, json3…): its WebVTT one.
            let streamed: Vec<&SubFormat> = formats.iter().filter(|f| f.stream_track()).collect();
            let entries = match formats.iter().find(|f| f.ext.as_deref() == Some("vtt")) {
                _ if !streamed.is_empty() => streamed,
                Some(vtt) => vec![vtt],
                None => continue,
            };
            for entry in entries {
                let Some(url) = entry.url.clone() else { continue };
                let name = names.get(&url).cloned().or_else(|| entry.name.clone()).unwrap_or_else(|| language.to_string());
                let name = name.trim_end_matches(" - Original").trim_end_matches(" (Original)").to_string();
                add_track(&mut tracks, url, if is_automatic { format!("{name} (automatic)") } else { name });
            }
        }
    }
    tracks
}

/// A caption file the page's player listed or loaded, seen by the sign-in window (signin.rs `WATCH_MEDIA`).
#[derive(Deserialize, Clone, Default)]
#[serde(default)]
pub(crate) struct FoundCaption {
    url: String,
    /// The player's name for it ("Khmer"); may be empty.
    label: String,
    /// Its language code ("km", "en-US"); may be empty.
    lang: String,
}

/// The tracks in `SITE_LANGUAGES` among caption files found on the video's page (kisskh lists its .srt files
/// in a list of its own, so yt-dlp never sees them), after `tracks` and not repeating them.
pub(crate) fn add_page_tracks(tracks: &mut Vec<Track>, found: &[FoundCaption]) {
    for caption in found {
        if !(caption.url.starts_with("https://") || caption.url.starts_with("http://")) || tracks.iter().any(|t| t.url == caption.url) {
            continue;
        }
        let Some(language) = site_language(&caption.lang).or_else(|| site_language(&caption.label)) else { continue };
        let label = if caption.label.trim().is_empty() { language.to_string() } else { caption.label.trim().to_string() };
        add_track(tracks, caption.url.clone(), label);
    }
}

/// "English", "eng", "en-US" → "English"; None for a language not in `SITE_LANGUAGES`.
fn site_language(code: &str) -> Option<&'static str> {
    let code = code.trim().split(['-', '_']).next().unwrap_or_default().to_ascii_lowercase();
    SITE_LANGUAGES.iter().find(|(two, three, name)| code == *two || code == *three || code == name.to_ascii_lowercase()).map(|(_, _, name)| *name)
}

/// Adds a track, numbering labels that repeat: tracks without names of their own are "English", "English 2"…
fn add_track(tracks: &mut Vec<Track>, url: String, label: String) {
    let numbered = |t: &Track| t.label.strip_prefix(&format!("{label} ")).is_some_and(|n| n.parse::<u32>().is_ok());
    let same = tracks.iter().filter(|t| t.label == label || numbered(t)).count();
    let label = if same == 0 { label } else { format!("{label} {}", same + 1) };
    tracks.push(Track { url, label });
}

/// yt-dlp's names for caption formats it knows (anything else is a stream's caption track).
fn is_caption_format(ext: Option<&str>) -> bool {
    ext.is_some_and(|ext| ["vtt", "srt", "ttml", "srv1", "srv2", "srv3", "json3", "dfxp", "ass", "ssa"].contains(&ext))
}

/// Each caption track's name by its address, from a stream's master list (`#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="English [CR]",…,URI="…"`).
pub(crate) fn stream_track_names(playlist: &str, base: &reqwest::Url) -> BTreeMap<String, String> {
    let attribute = |line: &str, key: &str| line.split(&format!("{key}=\"")).nth(1).and_then(|rest| rest.split('"').next()).map(str::to_string);
    playlist
        .lines()
        .filter(|line| line.starts_with("#EXT-X-MEDIA:") && line.contains("TYPE=SUBTITLES"))
        .filter_map(|line| Some((base.join(&attribute(line, "URI")?).ok()?.to_string(), attribute(line, "NAME")?)))
        .collect()
}

/// Reads the names of a stream's caption tracks (`stream_track_names`) from its master list; empty when it can't.
pub(crate) async fn stream_names(manifest: &str, page: Option<&str>) -> BTreeMap<String, String> {
    let Ok(response) = crate::media_cache::get(manifest, |r| crate::media_cache::from_page(r, page)).await else {
        return BTreeMap::new();
    };
    let base = response.url().clone();
    match response.text().await {
        Ok(text) if text.len() < MAX_BYTES => stream_track_names(&text, &base),
        _ => BTreeMap::new(),
    }
}

/// Larger than any real caption file.
const MAX_BYTES: usize = 5_000_000;
/// More pieces than a caption track of a stream has (they're usually one, or one per few seconds).
const MAX_PIECES: usize = 2_000;

/// Downloads a caption track (WebVTT), with the video's page as Referer, as timed lines.
#[tauri::command]
pub async fn load_captions(url: String, link: String) -> Result<Vec<Caption>, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Not a web address.".into());
    }
    let (page, found_on) = crate::signin::split_referer(&link);
    let referer = found_on.unwrap_or(page);
    let (text, base) = caption_file(&url, referer).await?;
    if !text.starts_with("#EXTM3U") {
        return Ok(parse_vtt(&text));
    }
    // A stream's caption track: a list of WebVTT pieces, read one after the other.
    // shortcut: ignores X-TIMESTAMP-MAP (pieces whose times count from the stream's own clock); read it if a site's lines come out shifted.
    let mut lines = Vec::new();
    let mut total = 0;
    for piece in text.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')).take(MAX_PIECES) {
        let piece = base.join(piece.trim()).map_err(|_| "The captions' list has a bad address.".to_string())?;
        let (vtt, _) = caption_file(piece.as_str(), referer).await?;
        total += vtt.len();
        if total > MAX_BYTES {
            return Err("The caption file is too big.".into());
        }
        lines.extend(parse_vtt(&vtt));
    }
    Ok(lines)
}

/// One caption file (or a stream's list of them) as text, and the address it came from.
async fn caption_file(url: &str, referer: &str) -> Result<(String, reqwest::Url), String> {
    let response = crate::media_cache::get(url, |r| r.header(reqwest::header::REFERER, referer))
        .await
        .map_err(|e| format!("Couldn't load the captions: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("The captions' server answered {}.", response.status()));
    }
    let base = response.url().clone();
    let bytes = response.bytes().await.map_err(|e| format!("The captions stopped loading: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("The caption file is too big.".into());
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), base))
}

/// "01:02.5", "00:01:02.500" (or with a comma) in seconds.
pub(crate) fn seconds(time: &str) -> Option<f64> {
    time.trim().replace(',', ".").split(':').try_fold(0.0, |total, part| Some(total * 60.0 + part.parse::<f64>().ok()?))
}

/// A caption line without its styling tags (`<c>`, `<00:00:01.000>`…) and HTML entities.
fn clean(line: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for c in line.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => text.push(c),
            _ => {}
        }
    }
    let text = text.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Timed lines from a WebVTT file. Automatic captions (YouTube) scroll: each cue repeats the line
/// before it, with blink-short cues in between, so a line already shown is dropped.
pub(crate) fn parse_vtt(text: &str) -> Vec<Caption> {
    let text = text.replace("\r\n", "\n");
    let mut out: Vec<Caption> = Vec::new();
    let mut last_line = String::new();
    for block in text.split("\n\n") {
        let mut lines = block.lines().skip_while(|l| !l.contains("-->"));
        let Some((from, to)) = lines.next().and_then(|t| t.split_once("-->")) else {
            continue;
        };
        let (Some(start), Some(end)) = (seconds(from), to.split_whitespace().next().and_then(seconds)) else {
            continue;
        };
        let mut fresh = Vec::new();
        for line in lines.map(clean) {
            if !line.is_empty() && line != last_line {
                last_line.clone_from(&line);
                fresh.push(line);
            }
        }
        if !fresh.is_empty() && end - start >= 0.05 {
            out.push(Caption { start, end, text: fresh.join(" ") });
        }
    }
    // One line at a time: each ends when the next one starts.
    for i in 1..out.len() {
        let next = out[i].start;
        if out[i - 1].end > next && next > out[i - 1].start {
            out[i - 1].end = next;
        }
    }
    out
}

/// Saves captions as an .srt file, which YouTube and video players read next to the video.
#[tauri::command]
pub fn save_srt(path: String, lines: Vec<Caption>) -> Result<(), String> {
    if !path.to_ascii_lowercase().ends_with(".srt") {
        return Err("Captions are saved as .srt files.".into());
    }
    std::fs::write(&path, srt(&lines)).map_err(|e| format!("Couldn't save the captions: {e}"))
}

/// Opens a caption or lyrics file (.srt, .vtt or .lrc) from this PC as timed lines.
#[tauri::command]
pub fn open_captions(path: String) -> Result<Vec<Caption>, String> {
    let ext = std::path::Path::new(&path).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    let Some(ext @ ("srt" | "vtt" | "lrc")) = ext.as_deref() else {
        return Err("Craftora opens captions from .srt, .vtt and .lrc files.".into());
    };
    let meta = std::fs::metadata(&path).map_err(|e| format!("Couldn't open the captions: {e}"))?;
    if meta.len() > MAX_BYTES as u64 {
        return Err("The caption file is too big.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Couldn't open the captions: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("The caption file is too big.".into());
    }
    let text = caption_text(&bytes);
    // `parse_vtt` also reads .srt (cue blocks with "-->" and comma times); it drops a cue that repeats
    // the line just before it (made for scrolling automatic captions).
    let lines = if ext == "lrc" { crate::speech::parse_lrc(&text, f64::MAX) } else { parse_vtt(&text) };
    if lines.is_empty() {
        return Err("No timed captions were found in this file.".into());
    }
    Ok(lines)
}

/// Subtitle files from Windows tools sometimes come as UTF-16 or start with a byte-order mark.
fn caption_text(bytes: &[u8]) -> String {
    let text = match bytes {
        [0xFF, 0xFE, rest @ ..] => {
            let units: Vec<u16> = rest.as_chunks::<2>().0.iter().map(|&c| u16::from_le_bytes(c)).collect();
            String::from_utf16_lossy(&units)
        }
        [0xFE, 0xFF, rest @ ..] => {
            let units: Vec<u16> = rest.as_chunks::<2>().0.iter().map(|&c| u16::from_be_bytes(c)).collect();
            String::from_utf16_lossy(&units)
        }
        _ => String::from_utf8_lossy(bytes).into_owned(),
    };
    text.trim_start_matches('\u{feff}').to_owned()
}

/// SubRip text: numbered blocks of "start --> end" and the words, a blank line between them.
fn srt(lines: &[Caption]) -> String {
    let time = |s: f64| {
        let ms = (s.max(0.0) * 1000.0).round() as u64;
        format!("{:02}:{:02}:{:02},{:03}", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000)
    };
    let mut out = String::new();
    // A blank line would end the block early, so the words keep only their non-empty lines.
    let texts = lines.iter().map(|l| (l, l.text.lines().map(str::trim).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\r\n")));
    for (n, (line, text)) in texts.filter(|(_, t)| !t.is_empty()).enumerate() {
        out.push_str(&format!("{}\r\n{} --> {}\r\n{text}\r\n\r\n", n + 1, time(line.start), time(line.end)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn site_tracks_in_english_and_khmer() {
        let entry = |ext: &str, url: &str, name: Option<&str>| SubFormat { ext: Some(ext.into()), url: Some(url.into()), name: name.map(str::to_string), protocol: None };
        let streamed = |url: &str| SubFormat { ext: Some("vtt".into()), url: Some(url.into()), name: None, protocol: Some("m3u8_native".into()) };
        // A stream's tracks (anipm): three-letter codes, no file type, several to a language, names from its list.
        let manual = BTreeMap::from([
            ("eng".to_string(), vec![entry("unknown_video", "https://s.example/a", None), entry("x1", "https://s.example/b", None), entry("x2", "https://s.example/c", None)]),
            ("khm".to_string(), vec![entry("vtt", "https://s.example/km.vtt", None)]),
            // yt-dlp read these: WebVTT pieces, one entry per track.
            ("km".to_string(), vec![streamed("https://s.example/km1.m3u8"), streamed("https://s.example/km2.m3u8")]),
            ("spa".to_string(), vec![entry("unknown_video", "https://s.example/es", None)]),
        ]);
        // YouTube's automatic ones: the original wins over the same language machine-made; one format per track.
        let automatic = BTreeMap::from([
            ("en".to_string(), vec![entry("vtt", "https://y.example/en", Some("English"))]),
            ("en-orig".to_string(), vec![entry("srv3", "https://y.example/o.srv3", None), entry("vtt", "https://y.example/o", Some("English (Original)"))]),
            ("km".to_string(), vec![entry("json3", "https://y.example/km.json", None)]),
        ]);
        let names = BTreeMap::from([
            ("https://s.example/b".to_string(), "English [CR]".to_string()),
            ("https://s.example/km2.m3u8".to_string(), "ភាសាខ្មែរ".to_string()),
        ]);
        let labels: Vec<(String, String)> = site_tracks(&manual, &automatic, &names).into_iter().map(|t| (t.label, t.url)).collect();
        let expected = [
            ("English", "https://s.example/a"),
            ("English [CR]", "https://s.example/b"),
            ("English 2", "https://s.example/c"),
            ("Khmer", "https://s.example/km.vtt"),
            ("Khmer 2", "https://s.example/km1.m3u8"),
            ("ភាសាខ្មែរ", "https://s.example/km2.m3u8"),
            ("English (automatic)", "https://y.example/o"),
        ];
        assert_eq!(labels, expected.map(|(l, u)| (l.to_string(), u.to_string())));
    }

    #[test]
    fn page_tracks_from_a_players_list() {
        let found = |url: &str, label: &str, lang: &str| FoundCaption { url: url.into(), label: label.into(), lang: lang.into() };
        let mut tracks = vec![Track { url: "https://s.example/en.vtt".into(), label: "English".into() }];
        add_page_tracks(
            &mut tracks,
            &[
                found("https://sub.example/x.ar.srt", "Arabic", "ar"),
                found("https://sub.example/x.en.srt", "English", "en"),
                found("https://sub.example/x.km.srt", "Khmer", "km"),
                found("https://s.example/en.vtt", "English", "en"),
                found("https://sub.example/other.srt", "ខ្មែរ", "khm"),
                found("https://sub.example/y.srt", "Khmer", ""),
                found("blob:https://sub.example/z", "English", "en"),
            ],
        );
        let labels: Vec<&str> = tracks.iter().map(|t| t.label.as_str()).collect();
        assert_eq!(labels, ["English", "English 2", "Khmer", "ខ្មែរ", "Khmer 2"]);
        assert_eq!(tracks[2].url, "https://sub.example/x.km.srt");
    }

    #[test]
    fn reads_stream_track_names() {
        let list = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"Japanese\",URI=\"audio.m3u8\"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"s1\",NAME=\"English [CR]\",LANGUAGE=\"eng\",URI=\"subs/en.m3u8\"\n#EXT-X-MEDIA:TYPE=SUBTITLES,NAME=\"Khmer\",LANGUAGE=\"khm\",URI=\"https://other.example/km\"\n";
        let names = stream_track_names(list, &reqwest::Url::parse("https://cdn.example/v/master.m3u8").unwrap());
        assert_eq!(names.len(), 2);
        assert_eq!(names["https://cdn.example/v/subs/en.m3u8"], "English [CR]");
        assert_eq!(names["https://other.example/km"], "Khmer");
    }

    #[test]
    fn writes_srt() {
        let lines = [
            Caption { start: 1.0, end: 3.25, text: "Hello\n\nthere".into() },
            Caption { start: 2.0, end: 2.5, text: "  ".into() },
            Caption { start: 3725.5, end: 3727.0, text: "Bye".into() },
        ];
        assert_eq!(srt(&lines), "1\r\n00:00:01,000 --> 00:00:03,250\r\nHello\r\nthere\r\n\r\n2\r\n01:02:05,500 --> 01:02:07,000\r\nBye\r\n\r\n");
    }

    #[test]
    fn reads_plain_captions() {
        let vtt = "WEBVTT\nKind: captions\n\n1\n00:00:01.000 --> 00:00:03.500 align:start\nHello &amp; <b>welcome</b>\nto the zoo\n\n01:04.000 --> 01:05.000\nBye\n";
        assert_eq!(
            parse_vtt(vtt),
            vec![
                Caption { start: 1.0, end: 3.5, text: "Hello & welcome to the zoo".into() },
                Caption { start: 64.0, end: 65.0, text: "Bye".into() },
            ]
        );
    }

    #[test]
    fn drops_scrolling_repeats() {
        let vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhello<00:00:00.500><c> there</c>\n\n00:00:02.000 --> 00:00:02.010\nhello there\n\n00:00:02.010 --> 00:00:04.000\nhello there\nhow<00:00:02.500><c> are</c><c> you</c>\n\n00:00:04.000 --> 00:00:04.010\nhow are you\n";
        assert_eq!(
            parse_vtt(vtt),
            vec![
                Caption { start: 0.0, end: 2.0, text: "hello there".into() },
                Caption { start: 2.01, end: 4.0, text: "how are you".into() },
            ]
        );
    }

    #[test]
    fn picks_own_captions_then_original_automatic() {
        let vtt = |url: &str| vec![SubFormat { ext: Some("vtt".into()), url: Some(url.into()), name: Some("English".into()), protocol: None }];
        let mut manual = BTreeMap::new();
        let mut automatic = BTreeMap::new();
        automatic.insert("fr".to_string(), vtt("auto-fr"));
        automatic.insert("en-orig".to_string(), vtt("auto-orig"));
        let track = pick(&manual, &automatic, Some("en")).unwrap();
        assert_eq!((track.url.as_str(), track.label.as_str()), ("auto-orig", "English (automatic)"));
        // A dubbed video lists an "-orig" per audio track: the video's own language wins.
        automatic.insert("bn-orig".to_string(), vtt("auto-bn"));
        assert_eq!(pick(&manual, &automatic, Some("en-US")).unwrap().url, "auto-orig");
        manual.insert("live_chat".to_string(), vtt("chat"));
        manual.insert("en-US".to_string(), vtt("mine"));
        assert_eq!(pick(&manual, &automatic, Some("en")).unwrap().url, "mine");
        assert!(pick(&BTreeMap::new(), &BTreeMap::new(), None).is_none());
    }

    #[test]
    fn reads_srt_utf16_and_lrc_files() {
        let srt = "\u{feff}1\r\n00:00:01,250 --> 00:00:04,000\r\n<i>First line</i>\r\nand second\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,500\r\nBye\r\n";
        assert_eq!(
            parse_vtt(&caption_text(srt.as_bytes())),
            vec![
                Caption { start: 1.25, end: 4.0, text: "First line and second".into() },
                Caption { start: 60.0, end: 62.5, text: "Bye".into() },
            ]
        );

        let utf16: Vec<u8> = [0xFF, 0xFE]
            .into_iter()
            .chain("1\r\n00:00:02,000 --> 00:00:05,000\r\nHello\r\n".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        assert_eq!(parse_vtt(&caption_text(&utf16)), vec![Caption { start: 2.0, end: 5.0, text: "Hello".into() }]);

        let lrc = "\u{feff}[00:10.50]First verse\r\n[00:14.00]Second verse\r\n";
        assert_eq!(
            crate::speech::parse_lrc(&caption_text(lrc.as_bytes()), f64::MAX),
            vec![
                Caption { start: 10.5, end: 14.0, text: "First verse".into() },
                Caption { start: 14.0, end: 24.0, text: "Second verse".into() },
            ]
        );

        let dir = std::env::temp_dir().join(format!("craftora-captions-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let txt = dir.join("notes.txt");
        std::fs::write(&txt, srt).unwrap();
        assert_eq!(open_captions(txt.to_string_lossy().into_owned()), Err("Craftora opens captions from .srt, .vtt and .lrc files.".into()));
        let empty = dir.join("empty.srt");
        std::fs::write(&empty, "nothing timed").unwrap();
        assert_eq!(open_captions(empty.to_string_lossy().into_owned()), Err("No timed captions were found in this file.".into()));
        let big = dir.join("big.SRT");
        std::fs::File::create(&big).unwrap().set_len(MAX_BYTES as u64 + 1).unwrap();
        assert_eq!(open_captions(big.to_string_lossy().into_owned()), Err("The caption file is too big.".into()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
