//! Rendering a whole timeline in one FFmpeg pass. Every picture clip is scaled, placed and
//! faded over a black frame (lower tracks first, later clips on a track over earlier ones),
//! text is drawn on top, and every sound is mixed.
//!
//! Each clip is its own FFmpeg input that starts at the clip's first frame (`-ss`/`-t`
//! before `-i`), so a clip from the end of a long video doesn't decode everything before it.
//! Links are fetched first by yt-dlp, just the parts the timeline uses.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::encoders::{self, Encoder, Quality};
use crate::engine::FFMPEG;
use crate::jobs::{
    deliver, download, is_web_link, output_dir, progress_event, run_ffmpeg, run_streaming, safe_stem, secs,
    spawn_job, work_dir, Container, Download, DownloadTarget, Jobs, Output,
};
use crate::local::{normalize, probe, OpenedFiles, ProbeInfo};

/// Video and sound clips: each one is an FFmpeg input.
const MAX_CLIPS: usize = 150;
/// Text clips are only drawn on the picture: a 3-hour video's captions fit.
const MAX_TEXT_CLIPS: usize = 5000;
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
    /// Video files: the cover picture (a JPEG data URL from the editor's Cover), built in as the file's cover.
    #[serde(default)]
    cover: String,
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
    /// A filter or effect block (effects.ts): changes the pictures under it while it lasts.
    Effect,
    /// A shape (shapes.ts): the editor sends it drawn on a whole-frame PNG (`picture`), laid over the pictures.
    Shape,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
enum TransitionKind {
    #[default]
    Crossfade,
    /// Fade to black, then up from black.
    Dip,
    /// The same through white (a flash).
    Flash,
    /// The outgoing clip moves out to the left as the incoming one pushes in from the right.
    Slide,
    /// The outgoing clip zooms in; the incoming one fades in over it, settling from 1.5× to its own size.
    Zoom,
    /// The incoming clip is uncovered from its left edge, the edge moving right.
    Wipe,
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
    /// Pictures: degrees turned clockwise (0, 90, 180 or 270), after the crop.
    #[serde(default)]
    rotate: u16,
    /// Slowed down with in-between frames made by motion interpolation (Smooth slow-mo).
    #[serde(default)]
    smooth: bool,
    /// Filter blocks: the colour steps, in order (effects.ts `LookStep`): CSS filter names and amounts.
    #[serde(default)]
    look: Vec<(String, f64)>,
    /// Effect blocks: effects.ts `PICTURE_EFFECTS` id.
    #[serde(default)]
    effect: String,
    /// Shapes: the whole frame as a PNG data URL with the shape drawn on it.
    #[serde(default)]
    picture: String,
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
    /// Text font (model.ts `TEXT_FONTS`); Segoe UI when empty.
    #[serde(default)]
    font: String,
    /// "outline", "box", or a soft shadow when empty.
    #[serde(default)]
    edge: String,
}

/// A fade over the clip's own time: `fade_in` from `start` for `length`, or out.
struct Ramp {
    fade_in: bool,
    /// Through white (a flash transition) instead of see-through.
    white: bool,
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
            ramps.push(Ramp { white: false, fade_in: true, start: 0.0, length: self.fade_in });
        }
        if self.fade_out > 0.0 {
            ramps.push(Ramp { white: false, fade_in: false, start: length - self.fade_out, length: self.fade_out });
        }
        if self.transition_in > 0.0 {
            match self.transition_in_kind {
                TransitionKind::Crossfade | TransitionKind::Zoom => ramps.push(Ramp { white: false, fade_in: true, start: 0.0, length: self.transition_in }),
                // The picture moves in or is uncovered (`slide_x`, `wipe_in`); only the sound fades.
                TransitionKind::Slide | TransitionKind::Wipe if sound => {
                    ramps.push(Ramp { white: false, fade_in: true, start: 0.0, length: self.transition_in })
                }
                TransitionKind::Slide | TransitionKind::Wipe => {}
                TransitionKind::Dip | TransitionKind::Flash => ramps.push(Ramp {
                    white: self.transition_in_kind == TransitionKind::Flash,
                    fade_in: true,
                    start: self.transition_in / 2.0,
                    length: self.transition_in / 2.0,
                }),
            }
            // A flash's incoming clip stays hidden until the outgoing one is all white, or its own white covers that.
            if self.transition_in_kind == TransitionKind::Flash && !sound {
                ramps.push(Ramp { white: false, fade_in: true, start: self.transition_in / 2.0, length: 0.001 });
            }
        }
        if self.transition_out > 0.0 {
            let begins = length - self.transition_out;
            match self.transition_out_kind {
                TransitionKind::Dip | TransitionKind::Flash => ramps.push(Ramp {
                    white: self.transition_out_kind == TransitionKind::Flash,
                    fade_in: false,
                    start: begins,
                    length: self.transition_out / 2.0,
                }),
                // The picture stays under the incoming one (moved or zoomed, but whole); only the sound fades.
                _ if sound => ramps.push(Ramp { white: false, fade_in: false, start: begins, length: self.transition_out }),
                _ => {}
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
        // Turned after the crop (the crop is set on the upright picture), as the preview does.
        chain.push_str(match self.rotate {
            90 => ",transpose=clock",
            180 => ",hflip,vflip",
            270 => ",transpose=cclock",
            _ => "",
        });
        if self.speed != 1.0 {
            chain.push_str(&format!(",setpts=PTS/{:.4}", self.speed));
        }
        chain
    }

    /// Smooth slow-mo: in-between frames up to the export's frame rate, made from the motion
    /// between frames (slow: a few frames a second), instead of each frame shown longer.
    fn smooth_frames(&self, fps: u32) -> String {
        if self.smooth && self.speed < 1.0 {
            format!(",minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1")
        } else {
            String::new()
        }
    }

    /// Picture edits, scaling into the frame, and Smooth slow-mo in-between frames.
    fn picture_chain(&self, w: u32, h: u32, fps: u32) -> String {
        // Fits inside size × the frame (or covers it, with `fill`), keeping its shape.
        let (bw, bh) = (((w as f64) * self.size).round().max(2.0), ((h as f64) * self.size).round().max(2.0));
        let fit = if self.fill { "increase" } else { "decrease" };
        format!(
            "setpts=PTS-STARTPTS{},scale=w={bw}:h={bh}:force_original_aspect_ratio={fit}:force_divisible_by=2,setsar=1{}",
            self.picture_edits(),
            self.smooth_frames(fps)
        )
    }

    /// Picture fades to transparent (what's below shows through; black at the bottom).
    fn picture_fades(&self) -> String {
        self.ramps(false)
            .iter()
            // A flash fades the picture itself to white (each clip is fully white at the join, the later one on top).
            .map(|r| format!(",fade=t={}:st={}:d={}:{}", if r.fade_in { "in" } else { "out" }, secs(r.start.max(0.0)), secs(r.length), if r.white { "color=white" } else { "alpha=1" }))
            .collect()
    }

    /// Slide transitions: added to the overlay's x (timeline time `t`), eased like the preview (model.ts
    /// `transitionMix`). Empty without one.
    fn slide_x(&self) -> String {
        let ease = |from: f64, d: f64| format!("(0.5-0.5*cos(PI*clip((t-{})/{},0,1)))", secs(from), secs(d));
        let mut x = String::new();
        if self.transition_in > 0.0 && self.transition_in_kind == TransitionKind::Slide {
            x.push_str(&format!("+W*(1-{})", ease(self.start, self.transition_in)));
        }
        if self.transition_out > 0.0 && self.transition_out_kind == TransitionKind::Slide {
            x.push_str(&format!("-W*{}", ease(self.end() - self.transition_out, self.transition_out)));
        }
        x
    }

    /// Zoom transitions on the clip's own picture, in its own time (`in` counts its frames). Each starts with a comma.
    fn transition_zooms(&self, fps: u32) -> String {
        let mut chain = String::new();
        let mut zoom = |from: f64, d: f64, incoming: bool| {
            let e = format!("(0.5-0.5*cos(PI*clip((in/{fps}-{})/{},0,1)))", secs(from), secs(d));
            // The incoming clip settles from 1.5× to 1×; the outgoing one zooms from 1× to 1.5×.
            let z = if incoming { format!("(1.5-0.5*{e})") } else { format!("(1+0.5*{e})") };
            // Only while it lasts: perspective redraws every pixel.
            let on = format!("enable='between(t,{},{})'", secs(from), secs(from + d));
            chain.push_str(&format!(",{}", timed(&warp(&z, "0", "0"), &on)));
        };
        if self.transition_in > 0.0 && self.transition_in_kind == TransitionKind::Zoom {
            zoom(0.0, self.transition_in, true);
        }
        if self.transition_out > 0.0 && self.transition_out_kind == TransitionKind::Zoom {
            zoom(self.length() - self.transition_out, self.transition_out, false);
        }
        chain
    }

    /// A wipe into this clip: its picture uncovered from the left edge, at an even speed. xfade from a see-through copy
    /// of its first seconds does that (pads named after clip `i`). Empty without one.
    fn wipe_in(&self, i: usize) -> String {
        if self.transition_in <= 0.0 || self.transition_in_kind != TransitionKind::Wipe {
            return String::new();
        }
        let d = secs(self.transition_in);
        format!(",split[w{i}a][w{i}b];[w{i}a]trim=duration={d},lut=a=0[w{i}c];[w{i}c][w{i}b]xfade=transition=wiperight:duration={d}:offset=0")
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
    let texts = spec.clips.iter().filter(|c| c.role == Role::Text).count();
    if spec.clips.len() - texts > MAX_CLIPS {
        return Err(format!("A timeline can have at most {MAX_CLIPS} video and sound clips."));
    }
    if texts > MAX_TEXT_CLIPS {
        return Err(format!("A timeline can have at most {MAX_TEXT_CLIPS} texts and captions."));
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
            || ![0, 90, 180, 270].contains(&clip.rotate)
            || clip.look.len() > MAX_LOOK_STEPS
            || !clip.look.iter().all(|(op, amount)| look_filter(op, *amount).is_some())
        {
            return Err("A clip on the timeline has an invalid setting.".into());
        }
        match clip.role {
            Role::Video if !clip.effect.is_empty() && effect_filter(&clip.effect, 0.0, clip.length(), (1920, 1080, 30)).is_none() => {
                return Err("An effect on a clip isn't one Craftora knows.".into());
            }
            Role::Shape => {
                if shape_bytes(&clip.picture).is_none() {
                    return Err("A shape on the timeline couldn't be read.".into());
                }
            }
            Role::Text => {
                if clip.text.trim().is_empty() || clip.text.chars().count() > MAX_TEXT {
                    return Err("A text clip is empty or too long.".into());
                }
                let hex = clip.color.strip_prefix('#').unwrap_or("");
                if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Err("A text clip has an invalid color.".into());
                }
            }
            // A filter (colour steps, checked above) or one known effect, never both.
            Role::Effect => {
                if clip.look.is_empty() == clip.effect.is_empty() || (!clip.effect.is_empty() && effect_filter(&clip.effect, clip.start, clip.length(), (1920, 1080, 30)).is_none()) {
                    return Err("An effect on the timeline isn't one Craftora knows.".into());
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

/// Available physical memory in bytes, so Smooth slow-mo doesn't start more FFmpeg processes
/// than RAM can hold.
#[cfg(windows)]
fn free_memory() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: `status` is zeroed with `dwLength` set to its size, as `GlobalMemoryStatusEx` requires.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        (GlobalMemoryStatusEx(&raw mut status) != 0).then_some(status.ullAvailPhys)
    }
}

#[cfg(not(windows))]
fn free_memory() -> Option<u64> {
    None
}

/// How many FFmpeg processes to run side by side for a Smooth slow-mo clip (1–4).
fn pieces(len_out: f64, w: u32, h: u32, free_bytes: Option<u64>, threads: usize) -> usize {
    let per_piece = 150_000_000.0 + 300.0 * f64::from(w) * f64::from(h);
    let by_memory = free_bytes.map_or(2, |free| (free as f64 * 0.6 / per_piece).floor() as usize);
    let by_cpu = threads / 2;
    let by_length = (len_out / 2.0).ceil() as usize;
    4.min(by_memory).min(by_cpu).min(by_length).max(1)
}

/// Output `(first_frame, count)` for each of the `n` pieces of a `frames`-frame clip. Every cut is
/// a multiple of `step` (output frames per source frame), so each piece starts on a real frame.
fn piece_frames(frames: u64, n: usize, step: u64) -> Vec<(u64, u64)> {
    let n = n as u64;
    let cut = |j: u64| if j == n { frames } else { j * frames / n / step * step };
    (0..n).map(|j| (cut(j), cut(j + 1) - cut(j))).filter(|&(_, count)| count > 0).collect()
}

/// Output frames per source frame for Smooth slow-mo (2 at half speed from 30 to 30 fps), when it's
/// a whole number. shortcut: other frame rates (24 fps exported at 30) keep the one-pass way;
/// cut on the nearest real frames if those turn out common.
fn frame_step(export_fps: u32, source_fps: Option<f64>, speed: f64) -> Option<u64> {
    let step = f64::from(export_fps) / (source_fps? * speed);
    ((step - step.round()).abs() < 0.01 && step >= 1.0).then(|| step.round() as u64)
}

async fn render(app: &AppHandle, spec: &RenderSpec) -> Result<PathBuf, String> {
    let dir = output_dir(app)?;
    let work = work_dir(app, &spec.id)?;
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

    // Pre-render each Smooth slow-mo video clip in up to 4 pieces side by side.
    let (w, h, fps) = (spec.width, spec.height, spec.fps);
    let is_video = spec.output == Output::Video;
    let mut smoothed: HashSet<usize> = HashSet::new();
    if is_video {
        let threads = std::thread::available_parallelism().map(usize::from).unwrap_or(4);
        for (i, clip) in spec.clips.iter().enumerate() {
            if clip.role != Role::Video || !clip.smooth || clip.speed >= 1.0 {
                continue;
            }
            let Some(source) = clip.media_id.as_deref().and_then(|id| sources.get(id)) else { continue };
            // shortcut: a reversed clip keeps the one-pass way (its pieces would have to be cut from
            // the end of the source); split it too if reversed smooth slow-mo turns out common.
            if source.image || !source.info.has_video || clip.reverse {
                continue;
            }
            let Some(step) = frame_step(fps, source.info.fps, clip.speed) else { continue };
            let len_out = clip.length();
            let frames = (len_out * f64::from(fps)).round().max(1.0) as u64;
            let split = piece_frames(frames, pieces(len_out, w, h, free_memory(), threads), step);
            let n = split.len();
            let from = (clip.in_point - source.offset).max(0.0);
            let progress = Arc::new(Mutex::new(vec![0.0_f64; n]));
            let _ = app.emit("job-event", progress_event(&spec.id, "smoothing", Some(0.0)));

            let mut handles = Vec::with_capacity(n);
            for (j, (first_frame, count)) in split.into_iter().enumerate() {
                // Every piece seeks where the one-pass export does and skips whole source frames, so
                // it starts on exactly the frame the one-pass export shows there; the frames after its
                // end are still coming, so minterpolate has the next frame at the cut.
                // At the end of the file minterpolate has no next frame and comes up short: the last
                // frame is held (tpad) so the piece still has all its frames, not black ones.
                let chain = format!("trim=start_frame={},{},tpad=stop_mode=clone:stop_duration=2", first_frame / step, clip.picture_chain(w, h, fps));
                let args: Vec<String> = vec![
                    "-y".into(),
                    "-hide_banner".into(),
                    "-nostats".into(),
                    "-progress".into(),
                    "pipe:1".into(),
                    "-ss".into(),
                    secs(from),
                    "-t".into(),
                    secs(clip.out - clip.in_point),
                    "-i".into(),
                    source.path.to_string_lossy().into_owned(),
                    "-an".into(),
                    "-vf".into(),
                    chain,
                    "-c:v".into(),
                    "libx264".into(),
                    "-preset".into(),
                    "ultrafast".into(),
                    "-crf".into(),
                    "12".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-r".into(),
                    fps.to_string(),
                    "-frames:v".into(),
                    count.to_string(),
                    format!("smooth-{i}-{j}.mkv"),
                ];
                let task_app = app.clone();
                let job_id = spec.id.clone();
                let work_dir = work.to_path_buf();
                let progress = Arc::clone(&progress);
                handles.push(tauri::async_runtime::spawn(async move {
                    let res = run_streaming(&task_app, &job_id, FFMPEG, args, Some(&work_dir), |line| {
                        let micros: f64 = line.strip_prefix("out_time_us=")?.trim().parse().ok()?;
                        let mut done = progress.lock().unwrap();
                        done[j] = (micros / 1_000_000.0).max(0.0);
                        let sum: f64 = done.iter().sum();
                        let percent = (sum / len_out.max(0.1) * 100.0).clamp(0.0, 100.0);
                        Some(progress_event(&job_id, "smoothing", Some(percent)))
                    })
                    .await;
                    if res.is_err() {
                        let jobs = task_app.state::<Jobs>();
                        if !jobs.is_cancelled(&job_id) && !jobs.is_paused(&job_id) {
                            jobs.kill_children(&job_id);
                        }
                    }
                    res
                }));
            }

            let mut all_ok = true;
            for handle in handles {
                if !handle.await.is_ok_and(|r| r.is_ok()) {
                    all_ok = false;
                }
            }
            let jobs = app.state::<Jobs>();
            if jobs.is_cancelled(&spec.id) || jobs.is_paused(&spec.id) {
                return Err("Cancelled".into());
            }
            if all_ok {
                let list: String = (0..n).map(|j| format!("file 'smooth-{i}-{j}.mkv'\n")).collect();
                if std::fs::write(work.join(format!("smooth-{i}.txt")), list).is_ok() {
                    smoothed.insert(i);
                }
            }
        }
    }

    // 2. One input per clip, starting at the clip's first frame.
    let total = spec.clips.iter().map(ClipSpec::end).fold(0.0, f64::max);
    let mut inputs: Vec<String> = Vec::new();
    let mut input_of: HashMap<usize, (usize, &Source)> = HashMap::new();
    // Where each clip's input options start in `inputs` (the graphics-card export adds its own there).
    let mut input_at: HashMap<usize, usize> = HashMap::new();
    let mut smooth_of: HashMap<usize, usize> = HashMap::new();
    let mut next_input = 0usize;
    for (i, clip) in spec.clips.iter().enumerate() {
        let Some(source) = clip.media_id.as_deref().and_then(|id| sources.get(id)) else { continue };
        input_at.insert(i, inputs.len());
        if source.image {
            // One picture, repeated at the frame rate for as long as the clip lasts.
            inputs.extend(["-loop".into(), "1".into(), "-framerate".into(), fps.to_string(), "-t".into(), secs(clip.length())]);
        } else {
            let from = (clip.in_point - source.offset).max(0.0);
            inputs.extend(["-ss".into(), secs(from), "-t".into(), secs(clip.out - clip.in_point)]);
        }
        inputs.extend(["-i".into(), source.path.to_string_lossy().into_owned()]);
        input_of.insert(i, (next_input, source));
        next_input += 1;
        if smoothed.contains(&i) {
            inputs.extend(["-f".into(), "concat".into(), "-safe".into(), "0".into(), "-i".into(), format!("smooth-{i}.txt")]);
            smooth_of.insert(i, next_input);
            next_input += 1;
        }
    }

    // Shapes: each one's picture, read once (`loop` repeats it in the graph).
    let mut shape_of: HashMap<usize, usize> = HashMap::new();
    for (i, clip) in spec.clips.iter().enumerate().filter(|(_, c)| is_video && c.role == Role::Shape) {
        let bytes = shape_bytes(&clip.picture).ok_or("A shape couldn't be read. Try the export again.")?;
        let path = work.join(format!("shape{i}.png"));
        std::fs::write(&path, bytes).map_err(|e| format!("Couldn't prepare a shape: {e}"))?;
        inputs.extend(["-i".into(), path.to_string_lossy().into_owned()]);
        shape_of.insert(i, next_input);
        next_input += 1;
    }

    // 3. The filter graph.
    let mut graph: Vec<String> = Vec::new();
    if is_video {
        graph.push(format!("color=black:s={w}x{h}:r={fps}:d={},format=yuv420p[base]", secs(total)));
        let mut picture = String::from("base");
        let mut layered: Vec<(usize, &ClipSpec)> = spec.clips.iter().enumerate().filter(|(_, c)| c.role != Role::Audio).collect();
        // Pictures first, then the filter and effect blocks over them, then text and shapes on top by track (as the
        // preview shows them).
        layered.sort_by_key(|(_, c)| (matches!(c.role, Role::Effect) as u8 + 2 * matches!(c.role, Role::Text | Role::Shape) as u8, c.layer));
        for (i, clip) in layered {
            let (start, end) = (secs(clip.start), secs(clip.end()));
            match clip.role {
                Role::Video => {
                    let Some(&(k, source)) = input_of.get(&i) else { continue };
                    if !source.info.has_video {
                        continue;
                    }
                    let chain = match smooth_of.get(&i) {
                        Some(&s) => format!("[{s}:v]setpts=PTS-STARTPTS"),
                        None => format!("[{k}:v]{}", clip.picture_chain(w, h, fps)),
                    };
                    // A filter and an effect dropped on this clip draw on its own picture, timed from its first frame.
                    let own: String = clip
                        .look
                        .iter()
                        .filter_map(|(op, amount)| look_filter(op, *amount))
                        .chain(effect_filter(&clip.effect, 0.0, clip.length(), (w, h, fps)).map(|f| format!(",{f}")))
                        .collect();
                    graph.push(format!(
                        "{chain},fps={fps}{own}{},format=yuva420p{}{},setpts=PTS+{start}/TB[v{i}]",
                        clip.transition_zooms(fps),
                        clip.picture_fades(),
                        clip.wipe_in(i)
                    ));
                    graph.push(format!(
                        "[{picture}][v{i}]overlay=x='{x}*(W-w){slide}':y='{y}*(H-h)':eof_action=pass:repeatlast=0:enable='between(t,{start},{end})'[p{i}]",
                        x = clip.x,
                        y = clip.y,
                        slide = clip.slide_x()
                    ));
                    picture = format!("p{i}");
                }
                Role::Shape => {
                    let Some(&k) = shape_of.get(&i) else { continue };
                    // One frame repeated for the clip's time, faded like a picture, then moved to where the clip starts.
                    let frames = (clip.length() * f64::from(fps)).ceil() as u64;
                    graph.push(format!(
                        "[{k}:v]format=rgba,loop=loop={frames}:size=1:start=0,setpts=N/{fps}/TB{},setpts=PTS+{start}/TB[s{i}]",
                        clip.picture_fades()
                    ));
                    graph.push(format!("[{picture}][s{i}]overlay=0:0:eof_action=pass:repeatlast=0:enable='between(t,{start},{end})'[p{i}]"));
                    picture = format!("p{i}");
                }
                Role::Text => {
                    // The text goes in a file so no character can break the filter syntax.
                    let file = format!("text{i}.txt");
                    std::fs::write(work.join(&file), clip.text.as_bytes()).map_err(|e| format!("Couldn't prepare text: {e}"))?;
                    let size = ((h as f64) * clip.size).round().max(8.0) as u32;
                    let color = clip.color.trim_start_matches('#');
                    let font = font_path(&clip.text, &clip.font);
                    // As the preview draws them (Preview.css): an outline about 5% of the letter height, or a box.
                    let edge = match clip.edge.as_str() {
                        "outline" => format!("borderw={}:bordercolor=black", (f64::from(size) * 0.05).round().max(1.0)),
                        "box" => format!("box=1:boxcolor=black@0.6:boxborderw={}", (f64::from(size) * 0.2).round()),
                        _ => "shadowcolor=black@0.6:shadowx=2:shadowy=2".into(),
                    };
                    graph.push(format!(
                        "[{picture}]drawtext=fontfile='{font}':textfile='{file}':expansion=none:text_align=C:fontsize={size}:fontcolor=0x{color}:{edge}:x='(w-text_w)*{x}':y='(h-text_h)*{y}'{alpha}:enable='between(t,{start},{end})'[p{i}]",
                        x = clip.x,
                        y = clip.y,
                        alpha = clip.text_alpha()
                    ));
                    picture = format!("p{i}");
                }
                Role::Effect => {
                    // For the block's time only.
                    let on = format!("enable='between(t,{},{})'", secs(clip.start), secs(clip.end()));
                    let filters: Vec<String> = if clip.effect.is_empty() {
                        clip.look.iter().filter_map(|(op, amount)| look_filter(op, *amount)).map(|f| timed(f.trim_start_matches(','), &on)).collect()
                    } else {
                        effect_filter(&clip.effect, clip.start, clip.length(), (w, h, fps)).map(|f| timed(&f, &on)).into_iter().collect()
                    };
                    if filters.is_empty() {
                        continue;
                    }
                    graph.push(format!("[{picture}]{}[p{i}]", filters.join(",")));
                    picture = format!("p{i}");
                }
                Role::Audio => {}
            }
        }
        graph.push(format!("[{picture}]format=yuv420p[outv]"));
    }
    let sound_from = graph.len();

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

    // The cover: a picture stream marked as the file's cover, which players and File Explorer show.
    let cover = if is_video && matches!(spec.container, Container::Mp4 | Container::Mkv) { cover_file(&spec.cover, work)? } else { None };
    let cover_input = cover.map(|path| {
        let index = inputs.iter().filter(|a| *a == "-i").count();
        inputs.extend(["-i".into(), path.to_string_lossy().into_owned()]);
        index
    });

    // 4. Encode, on the graphics card when asked and possible; if that fails, on the processor.
    let encoder = if is_video { encoders::for_render(app, spec.quality).await } else { Encoder::Software };
    // From a file: hundreds of text clips (captions) would pass Windows' 32,767-character command limit.
    let graph_file = work.join("graph.txt");
    std::fs::write(&graph_file, graph.join(";")).map_err(|e| format!("Couldn't prepare the export: {e}"))?;
    // The same export with its picture drawn on the graphics card too, when it can be (`gpu_picture`).
    let gpu = if encoder == Encoder::Nvenc && smoothed.is_empty() { gpu_picture(spec, &input_of, total) } else { None };
    let gpu_file = work.join("graph-gpu.txt");
    if let Some((_, chain)) = &gpu {
        let lines: Vec<&str> = std::iter::once(chain.as_str()).chain(graph[sound_from..].iter().map(String::as_str)).collect();
        std::fs::write(&gpu_file, lines.join(";")).map_err(|e| format!("Couldn't prepare the export: {e}"))?;
    }
    let command = |encoder: Encoder, on_gpu: bool| -> Vec<String> {
        let mut args: Vec<String> = ["-y", "-hide_banner", "-nostats", "-progress", "pipe:1"].map(String::from).to_vec();
        match gpu.as_ref().filter(|_| on_gpu) {
            // The clip's frames stay on the graphics card from decoding to encoding.
            Some((i, _)) => {
                let at = input_at[i];
                args.extend(inputs[..at].iter().cloned());
                args.extend(["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"].map(String::from));
                args.extend(inputs[at..].iter().cloned());
            }
            None => args.extend(inputs.iter().cloned()),
        }
        let graph = if on_gpu { &gpu_file } else { &graph_file };
        args.extend(["-/filter_complex".into(), graph.to_string_lossy().into_owned()]);
        if is_video {
            args.extend(["-map".into(), "[outv]".into()]);
            let mut codec = encoder.args(spec.quality);
            // Already that format on the graphics card; asking for it again would add a step on the processor, which fails.
            if on_gpu && let Some(at) = codec.iter().position(|a| a == "-pix_fmt") {
                codec.drain(at..at + 2);
            }
            args.extend(codec);
            args.extend(["-r".into(), fps.to_string()]);
            if let Some(index) = cover_input {
                args.extend(["-map".into(), format!("{index}:v"), "-c:v:1".into(), "copy".into(), "-disposition:v:1".into(), "attached_pic".into()]);
            }
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
    // All on the graphics card if it can; if that fails, drawn on the processor; if its encoder fails too, all on the processor.
    let attempts = [gpu.is_some().then_some((encoder, true)), Some((encoder, false)), encoder.is_hardware().then_some((Encoder::Software, false))];
    let mut result = Err("Nothing to export.".to_string());
    for (encoder, on_gpu) in attempts.into_iter().flatten() {
        result = run_ffmpeg(app, &spec.id, command(encoder, on_gpu), total, "encoding", Some(work)).await;
        match &result {
            Ok(()) => break,
            Err(e) if e == "Cancelled" => break,
            Err(e) if on_gpu && !app.state::<Jobs>().is_paused(&spec.id) => {
                crate::diag::note(format!("export on the graphics card failed, drawing it on the processor: {e}"));
            }
            Err(_) => {}
        }
    }
    result
}

/// One video clip that fills the whole export, with nothing drawn over it, can be drawn entirely on an NVIDIA
/// graphics card: decoded, mirrored or turned, resized and encoded there. Measured on the owner's laptop with the
/// processor half busy (as while editing): 5.4x → 11x real time, the same picture (46 dB). Returns that clip's
/// index and its filter chain; None for anything else, which is drawn on the processor as before.
fn gpu_picture(spec: &RenderSpec, input_of: &HashMap<usize, (usize, &Source)>, total: f64) -> Option<(usize, String)> {
    let mut pictures = spec.clips.iter().enumerate().filter(|(_, c)| c.role != Role::Audio);
    let (i, clip) = pictures.next()?;
    let &(k, source) = input_of.get(&i)?;
    let plain = clip.role == Role::Video
        && pictures.next().is_none()
        && source.info.has_video
        && !source.image
        // Phone videos marked to be turned: FFmpeg turns them on the processor only (they came out sideways).
        && !source.info.turned
        && !clip.reverse
        && !clip.smooth
        // A filter or effect inside the clip is drawn on the processor.
        && clip.look.is_empty()
        && clip.effect.is_empty()
        && !clip.fill
        && clip.size == 1.0
        && clip.crop == [0.0; 4]
        && clip.picture_fades().is_empty()
        // No black before or after it (that's drawn on the processor).
        && clip.start <= 0.001
        && clip.end() >= total - 0.001;
    if !plain {
        return None;
    }
    // As `picture_edits` and `picture_chain` do on the processor: mirror, then turn, then speed, then fit inside the frame.
    let turn = match clip.rotate {
        90 => ",transpose_cuda=dir=clock",
        180 => ",transpose_cuda=dir=reversal",
        270 => ",transpose_cuda=dir=cclock",
        _ => "",
    };
    let (w, h, fps) = (spec.width, spec.height, spec.fps);
    Some((
        i,
        format!(
            "[{k}:v]setpts=PTS-STARTPTS{mirror}{turn}{speed},scale_cuda=w={w}:h={h}:force_original_aspect_ratio=decrease:force_divisible_by=2:format=yuv420p,pad_cuda=w={w}:h={h}:x='{x}*(ow-iw)':y='{y}*(oh-ih)',setsar=1,fps={fps}[outv]",
            mirror = if clip.mirror { ",transpose_cuda=dir=hflip" } else { "" },
            speed = if clip.speed == 1.0 { String::new() } else { format!(",setpts=PTS/{:.4}", clip.speed) },
            x = clip.x,
            y = clip.y,
        ),
    ))
}

/// The chosen font (`font`, model.ts `TEXT_FONTS`), or a bold Windows font, that has the text's
/// letters, escaped for FFmpeg's filter syntax. drawtext shows a missing letter as an empty box
/// and, unlike the preview, never tries another font.
fn font_path(text: &str, font: &str) -> String {
    let fonts = std::env::var("WINDIR").map(|w| PathBuf::from(w).join("Fonts")).unwrap_or_else(|_| PathBuf::from(r"C:\Windows\Fonts"));
    let has = |from: char, to: char| text.chars().any(|c| (from..=to).contains(&c));
    // Segoe UI has neither Khmer nor music notes and other symbols (♪ ♫ →…).
    let names: &[&str] = if has('\u{1780}', '\u{17FF}') {
        &["KhmerUIb.ttf", "KhmerUI.ttf"]
    } else if has('\u{2190}', '\u{2BFF}') {
        &["arialbd.ttf", "arial.ttf"]
    } else {
        &["segoeuib.ttf", "segoeui.ttf", "arialbd.ttf", "arial.ttf"]
    };
    // The chosen fonts have Latin letters only: Khmer and symbols keep the fonts above.
    let chosen: &[&str] = match font {
        "arial" => &["arialbd.ttf"],
        "impact" => &["impact.ttf"],
        "georgia" => &["georgiab.ttf"],
        "comic" => &["comicbd.ttf"],
        _ => &[],
    };
    let latin = !has('\u{1780}', '\u{17FF}') && !has('\u{2190}', '\u{2BFF}');
    let path = chosen
        .iter()
        .filter(|_| latin)
        .chain(names)
        .map(|name| fonts.join(name))
        .find(|p| p.exists())
        .unwrap_or_else(|| fonts.join("arial.ttf"));
    path.to_string_lossy().replace('\\', "/").replace(':', "\\:")
}

/// Writes the editor's cover (a JPEG data URL) into the working folder; None without one.
fn cover_file(data_url: &str, work: &Path) -> Result<Option<PathBuf>, String> {
    if data_url.is_empty() {
        return Ok(None);
    }
    let bytes = cover_bytes(data_url).ok_or("The cover picture can't be read. Pick it again.")?;
    let path = work.join("cover.jpg");
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn't prepare the cover: {e}"))?;
    Ok(Some(path))
}

/// A PNG data URL's picture, if it really is a PNG and not too big for a whole frame with a shape on it.
fn shape_bytes(data_url: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_url.strip_prefix("data:image/png;base64,")?).ok()?;
    (bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) && bytes.len() <= 16_000_000).then_some(bytes)
}

/// A JPEG data URL's picture, if it really is a JPEG and not too big for a cover.
fn cover_bytes(data_url: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_url.strip_prefix("data:image/jpeg;base64,")?).ok()?;
    (bytes.starts_with(&[0xFF, 0xD8, 0xFF]) && bytes.len() <= 8_000_000).then_some(bytes)
}

/// More than any look in effects.ts has.
const MAX_LOOK_STEPS: usize = 8;

/// Blur's strength: its standard deviation as a share of the frame width (effects.ts `BLUR_SHARE`).
const BLUR_SHARE: f64 = 0.006;

/// An effect block from `start` for `length` seconds, as the preview draws it (effects.ts
/// `blocksStyle`); without its time range (the caller adds it). None for an effect the catalog
/// doesn't have. `size`: the export's width, height and frame rate.
fn effect_filter(effect: &str, start: f64, length: f64, (w, h, fps): (u32, u32, u32)) -> Option<String> {
    let (st, d) = (secs(start), secs(length));
    let ease = |x: &str| format!("(0.5-0.5*cos(PI*{x}))");
    // Seconds into the block, from the frame count: perspective has no clock, and the picture runs at `fps` from 0.
    let u = format!("(in/{fps}-{st})");
    let through = ease(&format!("clip({u}/{d},0,1)"));
    Some(match effect {
        "fade-in" => format!("fade=t=in:st={st}:d={d}:color=black"),
        "fade-out" => format!("fade=t=out:st={st}:d={d}:color=black"),
        "flash" => format!("fade=t=in:st={st}:d={d}:color=white"),
        "blur" => format!("gblur=sigma={:.2}", BLUR_SHARE * f64::from(w)),
        "mirror" => "hflip".into(),
        "zoom-in" => warp(&format!("(1+0.3*{through})"), "0", "0"),
        "zoom-out" => warp(&format!("(1.3-0.3*{through})"), "0", "0"),
        "punch" => {
            let hit = format!("if(lt({u},0.1),{},1-{})", ease(&format!("clip({u}/0.1,0,1)")), ease(&format!("clip(({u}-0.1)/0.4,0,1)")));
            warp(&format!("(1+0.2*{hit})"), "0", "0")
        }
        "shake" => {
            let fall = format!("pow(1-clip({u}/{d},0,1),2)");
            let dx = format!("(0.02*W*{fall}*(sin(2*PI*7.3*{u})+0.5*sin(2*PI*13.1*{u}))/1.5)");
            let dy = format!("(0.02*H*{fall}*(sin(2*PI*9.1*{u}+1)+0.5*sin(2*PI*5.7*{u}+2))/1.5)");
            warp(&format!("(1+0.06*{fall})"), &dx, &dy)
        }
        "bars" => {
            // 2.39:1 on a landscape frame; a tenth of the height each on a tall one. On for the whole block: drawbox has
            // no clock (its `t` is the line thickness), so they can't slide.
            let share = if w > h { (1.0 - f64::from(w) / f64::from(h) / 2.39).max(0.0) / 2.0 } else { 0.1 };
            let bar = format!("max(1,ih*{share:.4})");
            // The caller times only the last filter; the first gets the same window here.
            let on = format!("between(t,{st},{})", secs(start + length));
            format!("drawbox=x=0:y=0:w=iw:h='{bar}':color=black:t=fill:enable='{on}',drawbox=x=0:y='ih-{bar}':w=iw:h='{bar}':color=black:t=fill")
        }
        _ => return None,
    })
}

/// The picture scaled by `z` about its centre, then moved by (`dx`, `dy`) pixels (FFmpeg expressions), as the preview's
/// CSS `translate(…) scale(z)`: each output corner shows the source point the inverse of that lands on.
fn warp(z: &str, dx: &str, dy: &str) -> String {
    let (left, right) = (format!("W/2-(W/2+{dx})/{z}"), format!("W/2+(W/2-{dx})/{z}"));
    let (top, bottom) = (format!("H/2-(H/2+{dy})/{z}"), format!("H/2+(H/2-{dy})/{z}"));
    format!("perspective=x0='{left}':y0='{top}':x1='{right}':y1='{top}':x2='{left}':y2='{bottom}':x3='{right}':y3='{bottom}':eval=frame")
}

/// A filter limited to `on` (its time range). A filter without options (hflip) takes it after
/// `=`; FFmpeg refuses `hflip:enable=…`.
fn timed(filter: &str, on: &str) -> String {
    format!("{filter}{}{on}", if filter.contains('=') { ':' } else { '=' })
}

/// One colour step of a look as FFmpeg draws it, with the same maths as the CSS filter function
/// the preview uses (Filter Effects spec matrices, on the picture's RGB values); starts with a comma.
/// None for a name or amount the catalog never sends.
fn look_filter(op: &str, amount: f64) -> Option<String> {
    let mixer = |m: [f64; 9]| {
        let names = ["rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"];
        let options: Vec<String> = names.iter().zip(m).map(|(name, v)| format!("{name}={v:.5}")).collect();
        format!(",colorchannelmixer={}", options.join(":"))
    };
    let within = |lo: f64, hi: f64| amount.is_finite() && (lo..=hi).contains(&amount);
    match op {
        "grayscale" if within(0.0, 1.0) => {
            let k = 1.0 - amount;
            Some(mixer([
                0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k,
                0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k,
                0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k,
            ]))
        }
        "sepia" if within(0.0, 1.0) => {
            let k = 1.0 - amount;
            Some(mixer([
                0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k,
                0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k,
                0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k,
            ]))
        }
        // Up to 2: colorchannelmixer takes factors from -2 to 2.
        "saturate" if within(0.0, 2.0) => {
            let s = amount;
            Some(mixer([
                0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
                0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
                0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
            ]))
        }
        "hue-rotate" if within(-180.0, 180.0) => {
            let (sin, cos) = amount.to_radians().sin_cos();
            Some(mixer([
                0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
                0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
                0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
            ]))
        }
        "brightness" if within(0.0, 2.0) => Some(mixer([amount, 0.0, 0.0, 0.0, amount, 0.0, 0.0, 0.0, amount])),
        // lutrgb keeps each result within 0..maxval, as the CSS functions do.
        "contrast" if within(0.0, 3.0) => {
            let channel = format!("'(val-maxval/2)*{amount:.4}+maxval/2'");
            Some(format!(",lutrgb=r={channel}:g={channel}:b={channel}"))
        }
        "invert" if within(0.0, 1.0) => {
            let channel = format!("'val*{:.4}+maxval*{amount:.4}'", 1.0 - 2.0 * amount);
            Some(format!(",lutrgb=r={channel}:g={channel}:b={channel}"))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{cover_bytes, effect_filter, frame_step, gpu_picture, look_filter, piece_frames, pieces, timed, ClipSpec, RenderSpec, Source};
    use crate::local::ProbeInfo;
    use std::collections::HashMap;

    #[test]
    fn draws_only_a_plain_full_clip_on_the_graphics_card() {
        let spec = |clips: &str| -> RenderSpec {
            serde_json::from_str(&format!(r#"{{"id":"t","media":[],"clips":[{clips}],"width":1920,"height":1080,"fps":30,"output":"video","container":"mp4","fileName":"x"}}"#)).unwrap()
        };
        let source = |turned| Source { path: "a.mp4".into(), image: false, offset: 0.0, info: ProbeInfo { has_video: true, has_audio: true, fps: Some(25.0), turned } };
        let (plain, phone) = (source(false), source(true));
        let video = r#"{"role":"video","layer":0,"mediaId":"a","start":0,"in":0,"out":10,"mirror":true}"#;
        let one = HashMap::from([(0, (0, &plain))]);
        let (i, chain) = gpu_picture(&spec(video), &one, 10.0).unwrap();
        assert_eq!(i, 0);
        assert!(chain.starts_with("[0:v]setpts=PTS-STARTPTS,transpose_cuda=dir=hflip,scale_cuda=w=1920:h=1080:"));
        assert!(chain.ends_with(",fps=30[outv]"));
        // Turned phone video, black after it, or text over it: drawn on the processor.
        assert!(gpu_picture(&spec(video), &HashMap::from([(0, (0, &phone))]), 10.0).is_none());
        assert!(gpu_picture(&spec(video), &one, 12.0).is_none());
        let text = r#"{"role":"text","layer":1,"start":0,"in":0,"out":2,"text":"hi"}"#;
        assert!(gpu_picture(&spec(&format!("{video},{text}")), &one, 10.0).is_none());
    }

    #[test]
    fn picks_how_many_smooth_pieces_fit() {
        assert_eq!(pieces(20.0, 1920, 1080, Some(32_000_000_000), 16), 4);
        assert_eq!(pieces(20.0, 1920, 1080, Some(8_000_000_000), 16), 4);
        assert_eq!(pieces(20.0, 1920, 1080, Some(1_000_000_000), 16), 1);
        assert_eq!(pieces(3.0, 1920, 1080, Some(32_000_000_000), 16), 2);
        assert_eq!(pieces(0.5, 1920, 1080, Some(32_000_000_000), 16), 1);
        assert_eq!(pieces(20.0, 1920, 1080, Some(32_000_000_000), 2), 1);
        assert_eq!(pieces(20.0, 1920, 1080, None, 16), 2);
    }

    #[test]
    fn splits_smooth_frames_without_gaps_or_drift() {
        let split = piece_frames(655, 4, 2);
        assert_eq!(split.len(), 4);
        assert_eq!(split.iter().map(|(_, count)| count).sum::<u64>(), 655);
        assert!(split.windows(2).all(|w| w[0].0 < w[1].0 && w[0].0 + w[0].1 == w[1].0));
        // At half speed every 2nd output frame is a real one: each piece starts on one.
        assert!(split.iter().all(|(first, _)| first % 2 == 0));
        assert_eq!(frame_step(30, Some(30.0), 0.5), Some(2));
        assert_eq!(frame_step(30, Some(60.0), 0.5), Some(1));
        assert_eq!(frame_step(30, Some(24.0), 0.5), None);
        assert_eq!(frame_step(30, None, 0.5), None);
    }

    #[test]
    fn takes_only_a_jpeg_as_the_cover() {
        assert_eq!(cover_bytes("data:image/jpeg;base64,/9j/4AAQ").unwrap()[..3], [0xFF, 0xD8, 0xFF]);
        assert!(cover_bytes("data:image/png;base64,iVBORw0KGgo=").is_none());
        assert!(cover_bytes("data:image/jpeg;base64,aGVsbG8=").is_none());
        assert!(cover_bytes("not a picture").is_none());
    }

    #[test]
    fn turns_a_picture_after_its_crop() {
        let clip: ClipSpec = serde_json::from_str(r#"{"role":"video","layer":0,"start":0,"in":0,"out":1,"crop":[0.1,0,0,0],"rotate":90}"#).unwrap();
        let edits = clip.picture_edits();
        assert!(edits.find("crop=").unwrap() < edits.find("transpose=clock").unwrap(), "{edits}");
        let upside: ClipSpec = serde_json::from_str(r#"{"role":"video","layer":0,"start":0,"in":0,"out":1,"rotate":180}"#).unwrap();
        assert_eq!(upside.picture_edits(), ",hflip,vflip");
    }

    #[test]
    fn moves_zooms_and_wipes_for_transitions() {
        // A 3 s clip at 2 s on the timeline.
        let clip = |json: &str| -> ClipSpec { serde_json::from_str(&format!(r#"{{"role":"video","start":2,"in":0,"out":3,{json}}}"#)).unwrap() };
        // Slide: in from the right, out to the left; only the sound fades.
        let slide_in = clip(r#""transitionIn":1,"transitionInKind":"slide""#);
        assert_eq!(slide_in.slide_x(), "+W*(1-(0.5-0.5*cos(PI*clip((t-2.000)/1.000,0,1))))");
        assert_eq!(slide_in.picture_fades(), "");
        assert!(slide_in.sound_edits().contains(",afade=t=in:st=0.000:d=1.000"));
        let slide_out = clip(r#""transitionOut":1,"transitionOutKind":"slide""#);
        assert_eq!(slide_out.slide_x(), "-W*(0.5-0.5*cos(PI*clip((t-4.000)/1.000,0,1)))");
        assert_eq!(slide_out.picture_fades(), "");
        // Zoom: the incoming clip fades in as it settles; each zoom only while its transition lasts.
        let zoom_in = clip(r#""transitionIn":1,"transitionInKind":"zoom""#);
        assert_eq!(zoom_in.picture_fades(), ",fade=t=in:st=0.000:d=1.000:alpha=1");
        let zooms = zoom_in.transition_zooms(30);
        assert!(zooms.starts_with(",perspective=x0='W/2-(W/2+0)/(1.5-0.5*(0.5-0.5*cos(PI*clip((in/30-0.000)/1.000,0,1))))'"), "{zooms}");
        assert!(zooms.ends_with(":eval=frame:enable='between(t,0.000,1.000)'"), "{zooms}");
        let zooms = clip(r#""transitionOut":1,"transitionOutKind":"zoom""#).transition_zooms(30);
        assert!(zooms.contains("/(1+0.5*(0.5-0.5*cos(PI*clip((in/30-2.000)/1.000,0,1))))'") && zooms.ends_with("enable='between(t,2.000,3.000)'"), "{zooms}");
        // Wipe: uncovered by xfade from a see-through copy; no fade.
        let wipe = clip(r#""transitionIn":1,"transitionInKind":"wipe""#);
        assert_eq!(wipe.wipe_in(4), ",split[w4a][w4b];[w4a]trim=duration=1.000,lut=a=0[w4c];[w4c][w4b]xfade=transition=wiperight:duration=1.000:offset=0");
        assert_eq!(wipe.picture_fades(), "");
        // A crossfade moves, zooms and wipes nothing.
        let fade = clip(r#""transitionIn":1,"transitionOut":1"#);
        assert_eq!(fade.slide_x() + &fade.transition_zooms(30) + &fade.wipe_in(4), "");
    }

    #[test]
    fn makes_in_between_frames_only_for_smooth_slow_motion() {
        let smooth: ClipSpec = serde_json::from_str(r#"{"role":"video","start":0,"in":0,"out":2,"speed":0.5,"smooth":true}"#).unwrap();
        assert!(smooth.smooth_frames(30).starts_with(",minterpolate=fps=30:"));
        let plain: ClipSpec = serde_json::from_str(r#"{"role":"video","start":0,"in":0,"out":2,"speed":0.5}"#).unwrap();
        assert_eq!(plain.smooth_frames(30), "");
        let fast: ClipSpec = serde_json::from_str(r#"{"role":"video","start":0,"in":0,"out":2,"speed":2,"smooth":true}"#).unwrap();
        assert_eq!(fast.smooth_frames(30), "");
    }

    #[test]
    fn draws_each_effect_block() {
        assert_eq!(effect_filter("fade-in", 2.0, 3.0, (1920, 1080, 30)).unwrap(), "fade=t=in:st=2.000:d=3.000:color=black");
        assert_eq!(effect_filter("flash", 0.0, 1.0, (1920, 1080, 30)).unwrap(), "fade=t=in:st=0.000:d=1.000:color=white");
        assert_eq!(effect_filter("blur", 0.0, 1.0, (1000, 562, 30)).unwrap(), "gblur=sigma=6.00");
        assert_eq!(effect_filter("mirror", 0.0, 1.0, (1920, 1080, 30)).unwrap(), "hflip");
        assert!(effect_filter("explode", 0.0, 1.0, (1920, 1080, 30)).is_none());
        // Zoom: 1 to 1.3 eased over the block, timed by frame count at the export's rate.
        let zoom = effect_filter("zoom-in", 2.0, 3.0, (1920, 1080, 30)).unwrap();
        assert!(zoom.starts_with("perspective=x0='W/2-(W/2+0)/(1+0.3*(0.5-0.5*cos(PI*clip((in/30-2.000)/3.000,0,1))))'"), "{zoom}");
        assert!(zoom.ends_with(":eval=frame"));
        // Bars: 2.39:1 on 16:9 (12.81% each), both boxes timed.
        let bars = effect_filter("bars", 1.0, 2.0, (1920, 1080, 30)).unwrap();
        assert!(bars.contains("ih*0.1281)") && bars.contains(":enable='between(t,1.000,3.000)',drawbox"), "{bars}");
        assert!(effect_filter("bars", 1.0, 2.0, (1080, 1920, 30)).unwrap().contains("ih*0.1000)"));
        let on = "enable='between(t,1.000,2.000)'";
        assert_eq!(timed("hflip", on), "hflip=enable='between(t,1.000,2.000)'");
        assert_eq!(timed("gblur=sigma=6.00", on), "gblur=sigma=6.00:enable='between(t,1.000,2.000)'");
    }

    #[test]
    fn draws_each_look_step_and_refuses_anything_else() {
        // No change at all for "none" amounts: the identity matrix.
        assert_eq!(look_filter("grayscale", 0.0).unwrap(), ",colorchannelmixer=rr=1.00000:rg=0.00000:rb=0.00000:gr=0.00000:gg=1.00000:gb=0.00000:br=0.00000:bg=0.00000:bb=1.00000");
        assert!(look_filter("saturate", 1.0).unwrap().contains("rr=1.00000:rg=0.00000"));
        assert!(look_filter("hue-rotate", 0.0).unwrap().contains("rr=1.00000:rg=0.00000"));
        assert!(look_filter("grayscale", 1.0).unwrap().contains("rr=0.21260:rg=0.71520:rb=0.07220"));
        assert_eq!(look_filter("contrast", 1.5).unwrap(), ",lutrgb=r='(val-maxval/2)*1.5000+maxval/2':g='(val-maxval/2)*1.5000+maxval/2':b='(val-maxval/2)*1.5000+maxval/2'");
        assert!(look_filter("invert", 1.0).unwrap().contains("r='val*-1.0000+maxval*1.0000'"));
        // Only the catalog's names and amounts reach FFmpeg.
        assert!(look_filter("saturate", 2.5).is_none());
        assert!(look_filter("blur", 1.0).is_none());
        assert!(look_filter("brightness", f64::NAN).is_none());
        assert!(look_filter("grayscale';drawtext", 1.0).is_none());
    }
}
