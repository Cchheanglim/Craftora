//! Rendering a whole timeline in one FFmpeg pass. Every picture clip is scaled, placed and
//! faded over a black frame (lower tracks first, later clips on a track over earlier ones),
//! text is drawn on top, and every sound is mixed.
//!
//! Each clip is its own FFmpeg input that starts at the clip's first frame (`-ss`/`-t`
//! before `-i`), so a clip from the end of a long video doesn't decode everything before it.
//! Links are fetched first by yt-dlp, just the parts the timeline uses.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::encoders::{self, Encoder, Quality};
use crate::jobs::{
    deliver, download, is_web_link, output_dir, run_ffmpeg, safe_stem, secs, spawn_job, work_dir, Container,
    Download, DownloadTarget, Output,
};
use crate::local::{normalize, probe, OpenedFiles, ProbeInfo};

const MAX_CLIPS: usize = 150;
const MAX_TEXT: usize = 500;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpec {
    id: String,
    media: Vec<MediaSpec>,
    clips: Vec<ClipSpec>,
    width: u32,
    height: u32,
    fps: u32,
    output: Output,
    container: Container,
    file_name: String,
    #[serde(default)]
    quality: Quality,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaSpec {
    id: String,
    /// `src` is a file on this PC rather than a link.
    local: bool,
    src: String,
    /// yt-dlp format selector for links.
    #[serde(default)]
    format: String,
    /// A still picture, shown for as long as its clips last.
    #[serde(default)]
    image: bool,
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Role {
    /// A clip on a video track: a picture (and its sound).
    Video,
    Audio,
    Text,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
enum TransitionKind {
    #[default]
    Crossfade,
    /// Fade to black, then up from black.
    Dip,
}

fn one() -> f64 {
    1.0
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipSpec {
    role: Role,
    /// Drawing order: higher is on top.
    #[serde(default)]
    layer: i64,
    #[serde(default)]
    media_id: Option<String>,
    /// Timeline position in seconds.
    start: f64,
    /// Part of the source used, in source seconds (text clips: 0..length).
    #[serde(rename = "in")]
    in_point: f64,
    out: f64,
    /// 2 plays twice as fast and takes half as long on the timeline.
    #[serde(default = "one")]
    speed: f64,
    #[serde(default = "one")]
    volume: f64,
    #[serde(default)]
    mirror: bool,
    #[serde(default)]
    reverse: bool,
    /// Cover size × the frame (what spills over is cut off by the frame) instead of fitting inside.
    #[serde(default)]
    fill: bool,
    /// Seconds of fade in and out (picture from/to transparent, sound from/to silence).
    #[serde(default)]
    fade_in: f64,
    #[serde(default)]
    fade_out: f64,
    /// Fractions of the picture cut off: left, top, right, bottom.
    #[serde(default)]
    crop: [f64; 4],
    /// Seconds this clip overlaps the clip before it on its track, and how.
    #[serde(default)]
    transition_in: f64,
    #[serde(default)]
    transition_in_kind: TransitionKind,
    /// Seconds the next clip overlaps this clip's end, and how.
    #[serde(default)]
    transition_out: f64,
    #[serde(default)]
    transition_out_kind: TransitionKind,
    /// Video: scale where 1 fills the frame as far as the shape allows. Text: height / frame.
    #[serde(default = "one")]
    size: f64,
    /// Position across the free space, 0 = left/top, 1 = right/bottom.
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    #[serde(default)]
    text: String,
    #[serde(default)]
    color: String,
}

/// A fade over the clip's own time: `fade_in` from `start` for `length`, or out.
struct Ramp {
    fade_in: bool,
    start: f64,
    length: f64,
}

impl ClipSpec {
    /// Seconds on the timeline (after the speed change).
    fn length(&self) -> f64 {
        (self.out - self.in_point) / self.speed
    }
    fn end(&self) -> f64 {
        self.start + self.length()
    }

    /// Every fade the clip has, in its own time: fades, and its share of transitions. A
    /// crossfade fades the incoming clip in over the outgoing one (whose picture stays); a dip
    /// fades the outgoing clip out in the first half and the incoming one in the second half.
    fn ramps(&self, sound: bool) -> Vec<Ramp> {
        let length = self.length();
        let mut ramps = Vec::new();
        if self.fade_in > 0.0 {
            ramps.push(Ramp { fade_in: true, start: 0.0, length: self.fade_in });
        }
        if self.fade_out > 0.0 {
            ramps.push(Ramp { fade_in: false, start: length - self.fade_out, length: self.fade_out });
        }
        if self.transition_in > 0.0 {
            ramps.push(match self.transition_in_kind {
                TransitionKind::Crossfade => Ramp { fade_in: true, start: 0.0, length: self.transition_in },
                TransitionKind::Dip => Ramp { fade_in: true, start: self.transition_in / 2.0, length: self.transition_in / 2.0 },
            });
        }
        if self.transition_out > 0.0 {
            let begins = length - self.transition_out;
            match self.transition_out_kind {
                // The picture stays under the incoming one; only the sound fades.
                TransitionKind::Crossfade if sound => ramps.push(Ramp { fade_in: false, start: begins, length: self.transition_out }),
                TransitionKind::Crossfade => {}
                TransitionKind::Dip => ramps.push(Ramp { fade_in: false, start: begins, length: self.transition_out / 2.0 }),
            }
        }
        ramps
    }

    /// Picture filters after the cut: mirror, reverse, crop, speed. Each starts with a comma.
    fn picture_edits(&self) -> String {
        let mut chain = String::new();
        if self.mirror {
            chain.push_str(",hflip");
        }
        if self.reverse {
            chain.push_str(",reverse");
        }
        let [l, t, r, b] = self.crop;
        if l > 0.0 || t > 0.0 || r > 0.0 || b > 0.0 {
            chain.push_str(&format!(",crop=w=iw*{:.4}:h=ih*{:.4}:x=iw*{l:.4}:y=ih*{t:.4}", 1.0 - l - r, 1.0 - t - b));
        }
        if self.speed != 1.0 {
            chain.push_str(&format!(",setpts=PTS/{:.4}", self.speed));
        }
        chain
    }

    /// Picture fades to transparent (what's below shows through; black at the bottom).
    fn picture_fades(&self) -> String {
        self.ramps(false)
            .iter()
            .map(|r| format!(",fade=t={}:st={}:d={}:alpha=1", if r.fade_in { "in" } else { "out" }, secs(r.start.max(0.0)), secs(r.length)))
            .collect()
    }

    /// Sound filters after the cut: reverse, speed, volume, fades. Each starts with a comma.
    fn sound_edits(&self) -> String {
        let mut chain = String::new();
        if self.reverse {
            chain.push_str(",areverse");
        }
        if self.speed != 1.0 {
            chain.push_str(&atempo(self.speed));
        }
        chain.push_str(&format!(",volume={:.2}", self.volume));
        for r in self.ramps(true) {
            chain.push_str(&format!(",afade=t={}:st={}:d={}", if r.fade_in { "in" } else { "out" }, secs(r.start.max(0.0)), secs(r.length)));
        }
        chain
    }

    /// drawtext's opacity over time for faded text, or nothing.
    fn text_alpha(&self) -> String {
        let ramps = self.ramps(false);
        if ramps.is_empty() {
            return String::new();
        }
        // The lowest of all ramps, each 0–1 in timeline time.
        let terms: Vec<String> = ramps
            .iter()
            .map(|r| {
                let from = self.start + r.start;
                if r.fade_in {
                    format!("clip((t-{})/{},0,1)", secs(from), secs(r.length))
                } else {
                    format!("clip(({}-t)/{},0,1)", secs(from + r.length), secs(r.length))
                }
            })
            .collect();
        let expr = terms.iter().skip(1).fold(terms[0].clone(), |acc, t| format!("min({acc},{t})"));
        format!(":alpha='{expr}'")
    }
}

/// FFmpeg's atempo takes 0.5–2 per step; chain steps for 0.25 or 4.
fn atempo(speed: f64) -> String {
    let mut rest = speed;
    let mut chain = String::new();
    while rest < 0.5 {
        chain.push_str(",atempo=0.5");
        rest /= 0.5;
    }
    while rest > 2.0 {
        chain.push_str(",atempo=2.0");
        rest /= 2.0;
    }
    chain.push_str(&format!(",atempo={rest:.4}"));
    chain
}

/// Starts rendering a timeline; progress arrives as `job-event` events.
#[tauri::command]
pub async fn start_render(app: AppHandle, spec: RenderSpec) -> Result<(), String> {
    validate(&app, &spec)?;
    let task_app = app.clone();
    spawn_job(app, spec.id.clone(), async move { render(&task_app, &spec).await })
}

fn validate(app: &AppHandle, spec: &RenderSpec) -> Result<(), String> {
    if spec.clips.is_empty() {
        return Err("The timeline is empty.".into());
    }
    if spec.clips.len() > MAX_CLIPS {
        return Err(format!("A timeline can have at most {MAX_CLIPS} clips."));
    }
    if (spec.output == Output::Video) != spec.container.is_video() {
        return Err("That file type doesn't match the output.".into());
    }
    if !(16..=4096).contains(&spec.width) || !(16..=4096).contains(&spec.height) || !(1..=120).contains(&spec.fps) {
        return Err("The video size is out of range.".into());
    }
    let opened = app.state::<OpenedFiles>();
    for media in &spec.media {
        let ok = if media.local {
            normalize(Path::new(&media.src)).is_ok_and(|p| opened.contains(&p))
        } else {
            is_web_link(&media.src) && !media.format.is_empty()
        };
        if !ok {
            return Err("A file on the timeline isn't open any more. Import it again.".into());
        }
    }
    let finite = |v: f64| v.is_finite();
    for clip in &spec.clips {
        let [l, t, r, b] = clip.crop;
        let numbers = [
            clip.start, clip.in_point, clip.out, clip.speed, clip.volume, clip.fade_in, clip.fade_out, clip.transition_in,
            clip.transition_out, clip.size, clip.x, clip.y, l, t, r, b,
        ];
        if !numbers.into_iter().all(finite)
            || clip.start < 0.0
            || clip.in_point < 0.0
            || !(0.25..=4.0).contains(&clip.speed)
            || clip.length() < 0.05
            || clip.fade_in < 0.0
            || clip.fade_out < 0.0
            || clip.fade_in + clip.fade_out > clip.length() + 0.01
            || !(0.0..=clip.length() / 2.0 + 0.01).contains(&clip.transition_in)
            || !(0.0..=clip.length() / 2.0 + 0.01).contains(&clip.transition_out)
            || !clip.crop.iter().all(|side| (0.0..=0.45).contains(side))
            || !(0.0..=2.0).contains(&clip.volume)
            || !(0.01..=1.0).contains(&clip.size)
            || !(0.0..=1.0).contains(&clip.x)
            || !(0.0..=1.0).contains(&clip.y)
        {
            return Err("A clip on the timeline has an invalid setting.".into());
        }
        match clip.role {
            Role::Text => {
                if clip.text.trim().is_empty() || clip.text.chars().count() > MAX_TEXT {
                    return Err("A text clip is empty or too long.".into());
                }
                let hex = clip.color.strip_prefix('#').unwrap_or("");
                if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Err("A text clip has an invalid color.".into());
                }
            }
            _ => {
                let known = clip.media_id.as_ref().is_some_and(|id| spec.media.iter().any(|m| &m.id == id));
                if !known {
                    return Err("A clip refers to media that isn't in the project.".into());
                }
            }
        }
    }
    Ok(())
}

/// A media file ready for FFmpeg: a local path and how far its time is shifted.
struct Source {
    path: PathBuf,
    image: bool,
    /// Downloaded sections start at the section's beginning, not at 0.
    offset: f64,
    info: ProbeInfo,
}

async fn render(app: &AppHandle, spec: &RenderSpec) -> Result<PathBuf, String> {
    let dir = output_dir(app)?;
    let work = work_dir(&dir, &spec.id)?;
    let ext = spec.container.ext();
    // Rendered inside the working folder; only a finished file reaches the export folder.
    let temp = work.join(format!("output.{ext}"));
    let result = match render_in(app, spec, &work, &temp).await {
        Ok(()) => deliver(&temp, &dir, &safe_stem(&spec.file_name), ext),
        Err(e) => Err(e),
    };
    let _ = std::fs::remove_dir_all(&work);
    result
}

async fn render_in(app: &AppHandle, spec: &RenderSpec, work: &Path, output: &Path) -> Result<(), String> {
    // 1. Every media file used, as a local path (links: just the part the clips use).
    let mut sources: HashMap<&str, Source> = HashMap::new();
    for (n, media) in spec.media.iter().enumerate() {
        let used: Vec<&ClipSpec> = spec.clips.iter().filter(|c| c.media_id.as_deref() == Some(media.id.as_str())).collect();
        if used.is_empty() {
            continue;
        }
        let (path, offset) = if media.local {
            (PathBuf::from(&media.src), 0.0)
        } else {
            let from = used.iter().map(|c| c.in_point).fold(f64::INFINITY, f64::min);
            let to = used.iter().map(|c| c.out).fold(0.0, f64::max);
            let request = Download { url: &media.src, format: &media.format, section: Some((from, to)), precise: true, target: DownloadTarget::Any };
            (download(app, &spec.id, &request, work, &format!("media-{n}")).await?, from)
        };
        let info = probe(app, &path).await?;
        sources.insert(media.id.as_str(), Source { path, offset, info, image: media.image });
    }

    // 2. One input per clip, starting at the clip's first frame.
    let (w, h, fps) = (spec.width, spec.height, spec.fps);
    let is_video = spec.output == Output::Video;
    let total = spec.clips.iter().map(ClipSpec::end).fold(0.0, f64::max);
    let mut inputs: Vec<String> = Vec::new();
    let mut input_of: HashMap<usize, (usize, &Source)> = HashMap::new();
    for (i, clip) in spec.clips.iter().enumerate() {
        let Some(source) = clip.media_id.as_deref().and_then(|id| sources.get(id)) else { continue };
        if source.image {
            // One picture, repeated at the frame rate for as long as the clip lasts.
            inputs.extend(["-loop".into(), "1".into(), "-framerate".into(), fps.to_string(), "-t".into(), secs(clip.length())]);
        } else {
            let from = (clip.in_point - source.offset).max(0.0);
            inputs.extend(["-ss".into(), secs(from), "-t".into(), secs(clip.out - clip.in_point)]);
        }
        inputs.extend(["-i".into(), source.path.to_string_lossy().into_owned()]);
        input_of.insert(i, (input_of.len(), source));
    }

    // 3. The filter graph.
    let mut graph: Vec<String> = Vec::new();
    if is_video {
        graph.push(format!("color=black:s={w}x{h}:r={fps}:d={},format=yuv420p[base]", secs(total)));
        let mut picture = String::from("base");
        let mut layered: Vec<(usize, &ClipSpec)> = spec.clips.iter().enumerate().filter(|(_, c)| c.role != Role::Audio).collect();
        layered.sort_by_key(|(_, c)| c.layer);
        let font = font_path();
        for (i, clip) in layered {
            let (start, end) = (secs(clip.start), secs(clip.end()));
            match clip.role {
                Role::Video => {
                    let Some(&(k, source)) = input_of.get(&i) else { continue };
                    if !source.info.has_video {
                        continue;
                    }
                    // Fits inside size × the frame (or covers it, with `fill`), keeping its shape.
                    let (bw, bh) = (((w as f64) * clip.size).round().max(2.0), ((h as f64) * clip.size).round().max(2.0));
                    let fit = if clip.fill { "increase" } else { "decrease" };
                    graph.push(format!(
                        "[{k}:v]setpts=PTS-STARTPTS{},scale=w={bw}:h={bh}:force_original_aspect_ratio={fit}:force_divisible_by=2,setsar=1,fps={fps},format=yuva420p{},setpts=PTS+{start}/TB[v{i}]",
                        clip.picture_edits(),
                        clip.picture_fades()
                    ));
                    graph.push(format!(
                        "[{picture}][v{i}]overlay=x='{x}*(W-w)':y='{y}*(H-h)':eof_action=pass:repeatlast=0:enable='between(t,{start},{end})'[p{i}]",
                        x = clip.x,
                        y = clip.y
                    ));
                    picture = format!("p{i}");
                }
                Role::Text => {
                    // The text goes in a file so no character can break the filter syntax.
                    let file = format!("text{i}.txt");
                    std::fs::write(work.join(&file), clip.text.as_bytes()).map_err(|e| format!("Couldn't prepare text: {e}"))?;
                    let size = ((h as f64) * clip.size).round().max(8.0) as u32;
                    let color = clip.color.trim_start_matches('#');
                    graph.push(format!(
                        "[{picture}]drawtext=fontfile='{font}':textfile='{file}':expansion=none:fontsize={size}:fontcolor=0x{color}:shadowcolor=black@0.6:shadowx=2:shadowy=2:x='(w-text_w)*{x}':y='(h-text_h)*{y}'{alpha}:enable='between(t,{start},{end})'[p{i}]",
                        x = clip.x,
                        y = clip.y,
                        alpha = clip.text_alpha()
                    ));
                    picture = format!("p{i}");
                }
                Role::Audio => {}
            }
        }
        graph.push(format!("[{picture}]format=yuv420p[outv]"));
    }

    // Every sound, placed at its clip's start.
    let mut sounds: Vec<String> = Vec::new();
    for (i, clip) in spec.clips.iter().enumerate() {
        let Some(&(k, source)) = input_of.get(&i) else { continue };
        if !source.info.has_audio || clip.volume <= 0.0 {
            continue;
        }
        let delay = (clip.start * 1000.0).round() as u64;
        graph.push(format!(
            "[{k}:a]asetpts=PTS-STARTPTS{},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays={delay}:all=1[s{i}]",
            clip.sound_edits()
        ));
        sounds.push(format!("[s{i}]"));
    }
    let sound = match sounds.len() {
        0 => None,
        1 => Some(sounds[0].trim_matches(['[', ']']).to_string()),
        n => {
            graph.push(format!("{}amix=inputs={n}:duration=longest:normalize=0[mix]", sounds.join("")));
            Some("mix".to_string())
        }
    };
    if sound.is_none() && !is_video {
        return Err("There's no sound on the timeline to save.".into());
    }

    // 4. Encode, on the graphics card when asked and possible; if that fails, on the processor.
    let encoder = if is_video { encoders::for_render(app, spec.quality).await } else { Encoder::Software };
    let command = |encoder: Encoder| -> Vec<String> {
        let mut args: Vec<String> = ["-y", "-hide_banner", "-nostats", "-progress", "pipe:1"].map(String::from).to_vec();
        args.extend(inputs.iter().cloned());
        args.extend(["-filter_complex".into(), graph.join(";")]);
        if is_video {
            args.extend(["-map".into(), "[outv]".into()]);
            args.extend(encoder.args(spec.quality));
            args.extend(["-r".into(), fps.to_string()]);
        }
        match &sound {
            Some(label) => {
                args.extend(["-map".into(), format!("[{label}]")]);
                let codec: &[&str] = match spec.container {
                    Container::Mp3 => &["-c:a", "libmp3lame", "-b:a", "320k"],
                    Container::Wav => &["-c:a", "pcm_s16le"],
                    Container::Flac => &["-c:a", "flac"],
                    _ => &["-c:a", "aac", "-b:a", "192k"],
                };
                args.extend(codec.iter().map(|s| s.to_string()));
            }
            None => args.push("-an".into()),
        }
        args.extend(["-t".into(), secs(total)]);
        if spec.container == Container::Mp4 {
            args.extend(["-movflags".into(), "+faststart".into()]);
        }
        args.push(output.to_string_lossy().into_owned());
        args
    };
    match run_ffmpeg(app, &spec.id, command(encoder), total, "encoding", Some(work)).await {
        Err(e) if encoder.is_hardware() && e != "Cancelled" => {
            run_ffmpeg(app, &spec.id, command(Encoder::Software), total, "encoding", Some(work)).await
        }
        result => result,
    }
}

/// A bold Windows font for text clips, escaped for FFmpeg's filter syntax.
fn font_path() -> String {
    let fonts = std::env::var("WINDIR").map(|w| PathBuf::from(w).join("Fonts")).unwrap_or_else(|_| PathBuf::from(r"C:\Windows\Fonts"));
    let path = ["segoeuib.ttf", "segoeui.ttf", "arialbd.ttf", "arial.ttf"]
        .iter()
        .map(|name| fonts.join(name))
        .find(|p| p.exists())
        .unwrap_or_else(|| fonts.join("arial.ttf"));
    path.to_string_lossy().replace('\\', "/").replace(':', "\\:")
}
