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
        let file = list.iter().find(|f| f.ext.as_deref() == Some("vtt"))?;
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

/// Larger than any real caption file.
const MAX_BYTES: usize = 5_000_000;

/// Downloads a caption track (WebVTT), with the video's page as Referer, as timed lines.
#[tauri::command]
pub async fn load_captions(url: String, link: String) -> Result<Vec<Caption>, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Not a web address.".into());
    }
    let (page, found_on) = crate::signin::split_referer(&link);
    let response = crate::media_cache::client()
        .get(&url)
        .header(reqwest::header::REFERER, found_on.unwrap_or(page))
        .send()
        .await
        .map_err(|e| format!("Couldn't load the captions: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("The captions' server answered {}.", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| format!("The captions stopped loading: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("The caption file is too big.".into());
    }
    Ok(parse_vtt(&String::from_utf8_lossy(&bytes)))
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
        let vtt = |url: &str| vec![SubFormat { ext: Some("vtt".into()), url: Some(url.into()), name: Some("English".into()) }];
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
