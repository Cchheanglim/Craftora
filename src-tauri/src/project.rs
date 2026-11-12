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
#[serde(rename_all = "kebab-case")]
enum TransitionKind {
    #[default]
    Crossfade,
    /// Fade to black, then up from black.
    Dip,
    /// The same through white (a flash).
    Flash,
    /// The outgoing clip moves out to the left as the incoming one pushes in from the right.
    Slide,
    /// The same to the right, up and down.
    SlideRight,
    SlideUp,
    SlideDown,
    /// The outgoing clip zooms in; the incoming one fades in over it, settling from 1.5× to its own size.
    Zoom,
    /// The incoming clip is uncovered from its left edge, the edge moving right.
    Wipe,
    /// From its right edge moving left, from the bottom moving up, from the top moving down.
    WipeLeft,
    WipeUp,
    WipeDown,
    /// The incoming clip is uncovered through a circle growing from its centre.
    Circle,
    /// Like Zoom, with the outgoing clip turning a quarter clockwise and the incoming one turning in from a quarter back.
    Spin,
}

impl TransitionKind {
    /// Where a slide brings the incoming clip from, in frame widths and heights (the outgoing one leaves the other way).
    fn slide_from(self) -> (i8, i8) {
        match self {
            TransitionKind::Slide => (1, 0),
            TransitionKind::SlideRight => (-1, 0),
            TransitionKind::SlideUp => (0, 1),
            TransitionKind::SlideDown => (0, -1),
            _ => (0, 0),
        }
    }

    /// Whether the incoming picture fades in over the outgoing one (the others move it in or uncover it).
    fn fades_in(self) -> bool {
        matches!(self, TransitionKind::Crossfade | TransitionKind::Zoom | TransitionKind::Spin)
    }
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
    /// Remove a colour, before the colour steps: effects.ts `keyLine` ([r, g, b, edge, width]).
    #[serde(default)]
    key: Option<[f64; 5]>,
    /// Effect blocks: effects.ts `PICTURE_EFFECTS` id.
    #[serde(default)]
    effect: String,
    /// The effect's Strength as a multiple of how it was made (0–2) and Speed (0.5–3×): effects.ts `effectStrength`,
    /// `effectSpeed`.
    #[serde(default = "one")]
    effect_strength: f64,
    #[serde(default = "one")]
    effect_speed: f64,
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
    /// Seconds the sound alone fades in and out (the picture stays).
    #[serde(default)]
    sound_fade_in: f64,
    #[serde(default)]
    sound_fade_out: f64,
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
    /// How loud the sound stays in the middle of each transition, 0–1 (`transition_sound`).
    #[serde(default = "one")]
    transition_in_volume: f64,
    #[serde(default = "one")]
    transition_out_volume: f64,
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
    /// Text style presets (model.ts `Clip`): the edge's colour (#rrggbb) and strength; absent both, the old look.
    #[serde(default)]
    edge_color: Option<String>,
    #[serde(default)]
    edge_size: Option<f64>,
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
    /// The sound's share of transitions is `transition_sound` instead.
    fn ramps(&self, sound: bool) -> Vec<Ramp> {
        let length = self.length();
        let mut ramps = Vec::new();
        if self.fade_in > 0.0 {
            ramps.push(Ramp { white: false, fade_in: true, start: 0.0, length: self.fade_in });
        }
        if self.fade_out > 0.0 {
            ramps.push(Ramp { white: false, fade_in: false, start: length - self.fade_out, length: self.fade_out });
        }
        if sound && self.sound_fade_in > 0.0 {
            ramps.push(Ramp { white: false, fade_in: true, start: 0.0, length: self.sound_fade_in.min(length) });
        }
        if sound && self.sound_fade_out > 0.0 {
            let d = self.sound_fade_out.min(length);
            ramps.push(Ramp { white: false, fade_in: false, start: length - d, length: d });
        }
        if self.transition_in > 0.0 && !sound {
            match self.transition_in_kind {
                TransitionKind::Dip | TransitionKind::Flash => ramps.push(Ramp {
                    white: self.transition_in_kind == TransitionKind::Flash,
                    fade_in: true,
                    start: self.transition_in / 2.0,
                    length: self.transition_in / 2.0,
                }),
                // Otherwise the picture moves in or is uncovered (`slide`, `reveal_in`).
                k if k.fades_in() => ramps.push(Ramp { white: false, fade_in: true, start: 0.0, length: self.transition_in }),
                _ => {}
            }
            // A flash's incoming clip stays hidden until the outgoing one is all white, or its own white covers that.
            if self.transition_in_kind == TransitionKind::Flash {
                ramps.push(Ramp { white: false, fade_in: true, start: self.transition_in / 2.0, length: 0.001 });
            }
        }
        // Otherwise the picture stays under the incoming one (moved or zoomed, but whole).
        if self.transition_out > 0.0 && !sound && matches!(self.transition_out_kind, TransitionKind::Dip | TransitionKind::Flash) {
            ramps.push(Ramp {
                white: self.transition_out_kind == TransitionKind::Flash,
                fade_in: false,
                start: length - self.transition_out,
                length: self.transition_out / 2.0,
            });
        }
        ramps
    }

    /// The sound through its transitions, matching the preview (model.ts `transitionGain`): an equal-power crossfade
    /// (sine in, cosine out, so the two clips together stay as loud), dipped in the middle down to the transition's
    /// volume. A `volume` filter over the clip's own time; nothing without transitions.
    fn transition_sound(&self) -> String {
        let dip = |p: &str, volume: f64| format!("(1-{:.3}*sin(PI*{p}))", 1.0 - volume.clamp(0.0, 1.0));
        let mut gain = Vec::new();
        if self.transition_in > 0.0 {
            let p = format!("clip(t/{},0,1)", secs(self.transition_in));
            gain.push(format!("sin(PI/2*{p})*{}", dip(&p, self.transition_in_volume)));
        }
        if self.transition_out > 0.0 {
            let p = format!("clip((t-{})/{},0,1)", secs(self.length() - self.transition_out), secs(self.transition_out));
            gain.push(format!("cos(PI/2*{p})*{}", dip(&p, self.transition_out_volume)));
        }
        if gain.is_empty() {
            return String::new();
        }
        format!(",volume='{}':eval=frame", gain.join("*"))
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

    /// Slide transitions: added to the overlay's x (`axis` 'W') or y ('H') in timeline time `t`, eased like the preview
    /// (model.ts `transitionMix`). Empty without one.
    fn slide(&self, axis: char) -> String {
        let ease = |from: f64, d: f64| format!("(0.5-0.5*cos(PI*clip((t-{})/{},0,1)))", secs(from), secs(d));
        let along = |kind: TransitionKind| {
            let (x, y) = kind.slide_from();
            if axis == 'W' { x } else { y }
        };
        let sign = |d: i8| if d > 0 { '+' } else { '-' };
        let mut moved = String::new();
        let from = along(self.transition_in_kind);
        if self.transition_in > 0.0 && from != 0 {
            moved.push_str(&format!("{}{axis}*(1-{})", sign(from), ease(self.start, self.transition_in)));
        }
        // The outgoing clip leaves the way the next one comes in.
        let to = -along(self.transition_out_kind);
        if self.transition_out > 0.0 && to != 0 {
            moved.push_str(&format!("{}{axis}*{}", sign(to), ease(self.end() - self.transition_out, self.transition_out)));
        }
        moved
    }

    /// Zoom and spin transitions on the clip's own picture, in its own time (`in` counts its frames, `t` is seconds),
    /// after it has a see-through layer (the turned corners). Each starts with a comma.
    fn transition_moves(&self, fps: u32) -> String {
        let mut chain = String::new();
        let mut zoom = |from: f64, d: f64, incoming: bool, spin: bool| {
            let e = |time: &str| format!("(0.5-0.5*cos(PI*clip(({time}-{})/{},0,1)))", secs(from), secs(d));
            // Only while it lasts: perspective and rotate redraw every pixel.
            let on = format!("enable='between(t,{},{})'", secs(from), secs(from + d));
            if spin {
                // Turned first, then zoomed, as the preview's `rotate() scale()`: the outgoing clip turns a quarter
                // clockwise, the incoming one comes in from a quarter back.
                let a = if incoming { format!("-PI/2*(1-{})", e("t")) } else { format!("PI/2*{}", e("t")) };
                chain.push_str(&format!(",{}", timed(&format!("rotate=a='{a}':c=black@0"), &on)));
            }
            // The incoming clip settles from 1.5× to 1×; the outgoing one zooms from 1× to 1.5×.
            let z = if incoming { format!("(1.5-0.5*{})", e(&format!("in/{fps}"))) } else { format!("(1+0.5*{})", e(&format!("in/{fps}"))) };
            chain.push_str(&format!(",{}", timed(&warp(&z, "0", "0"), &on)));
        };
        if self.transition_in > 0.0 && matches!(self.transition_in_kind, TransitionKind::Zoom | TransitionKind::Spin) {
            zoom(0.0, self.transition_in, true, self.transition_in_kind == TransitionKind::Spin);
        }
        if self.transition_out > 0.0 && matches!(self.transition_out_kind, TransitionKind::Zoom | TransitionKind::Spin) {
            zoom(self.length() - self.transition_out, self.transition_out, false, self.transition_out_kind == TransitionKind::Spin);
        }
        chain
    }

    /// A wipe or circle into this clip: its picture uncovered at an even speed, by xfade from a see-through copy. Only
    /// the transition's first `n` frames go through it (xfade on the whole clip made a Wipe's export ~2× slower), then
    /// the rest is joined back on. Pads are named after clip `i`. Empty without one.
    fn reveal_in(&self, i: usize, fps: u32) -> String {
        let shape = match self.transition_in_kind {
            TransitionKind::Wipe => "wiperight",
            TransitionKind::WipeLeft => "wipeleft",
            TransitionKind::WipeUp => "wipeup",
            TransitionKind::WipeDown => "wipedown",
            TransitionKind::Circle => "circleopen",
            _ => return String::new(),
        };
        if self.transition_in <= 0.0 {
            return String::new();
        }
        let d = secs(self.transition_in);
        let n = (self.transition_in * f64::from(fps) - 1e-6).ceil().max(1.0) as u64;
        let reveal = if shape == "circleopen" {
            // xfade's circle has a soft edge as wide as the whole picture: its middle third, cut at half, is a sharp
            // circle growing evenly from nothing to the corners. Padding puts the clip's frames in that third.
            // shortcut: about 3 s of export time per 1 s of circle at 1080p (three times the frames through xfade).
            format!(
                "tpad=start={n}:stop={n}:stop_mode=clone:color=black@0,split[w{i}a][w{i}b];[w{i}a]lut=a=0[w{i}c];[w{i}c][w{i}b]xfade=transition=circleopen:duration={}:offset=0,trim=start_frame={n}:end_frame={},setpts=PTS-STARTPTS,lut=a='if(gte(val,128),255,0)'",
                secs(3.0 * n as f64 / f64::from(fps)),
                2 * n
            )
        } else {
            format!("split[w{i}a][w{i}b];[w{i}a]lut=a=0[w{i}c];[w{i}c][w{i}b]xfade=transition={shape}:duration={d}:offset=0")
        };
        format!(",split[h{i}a][h{i}b];[h{i}a]trim=end_frame={n},{reveal},format=yuva420p[h{i}h];[h{i}b]trim=start_frame={n},setpts=PTS-STARTPTS[h{i}r];[h{i}h][h{i}r]concat=n=2:v=1:a=0")
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
        chain.push_str(&self.transition_sound());
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
            clip.start, clip.in_point, clip.out, clip.speed, clip.volume, clip.fade_in, clip.fade_out, clip.sound_fade_in, clip.sound_fade_out, clip.transition_in,
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
            || clip.sound_fade_in < 0.0
            || clip.sound_fade_out < 0.0
            || clip.sound_fade_in + clip.sound_fade_out > clip.length() + 0.01
            || !(0.0..=clip.length() / 2.0 + 0.01).contains(&clip.transition_in)
            || !(0.0..=clip.length() / 2.0 + 0.01).contains(&clip.transition_out)
            // At least 5% of the picture kept each way (crop.ts `MIN_KEEP`); the box may sit anywhere.
            || !clip.crop.iter().all(|side| (0.0..=0.95).contains(side))
            || l + r > 0.9501
            || t + b > 0.9501
            || !(0.0..=2.0).contains(&clip.volume)
            || !(0.01..=1.0).contains(&clip.size)
            || !(0.0..=1.0).contains(&clip.x)
            || !(0.0..=1.0).contains(&clip.y)
            || ![0, 90, 180, 270].contains(&clip.rotate)
            || !(0.0..=2.0).contains(&clip.effect_strength)
            || !(0.5..=3.0).contains(&clip.effect_speed)
            || clip.look.len() > MAX_LOOK_STEPS
            || !clip.look.iter().all(|(op, amount)| look_filter(op, *amount).is_some())
            || clip.key.is_some_and(|k| key_filter(k).is_none())
        {
            return Err("A clip on the timeline has an invalid setting.".into());
        }
        // A style preset's edge: a #rrggbb colour (it goes into the filter graph) and a sane strength.
        let hex = |c: &str| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
        if clip.edge_color.as_deref().is_some_and(|c| !hex(c)) || clip.edge_size.is_some_and(|k| !(0.5..=6.0).contains(&k)) {
            return Err("A text on the timeline has an invalid style.".into());
        }
        // A library font is downloaded when it's picked (fonts.rs): without its file, the text would come out in another font.
        if clip.role == Role::Text && !["", "arial", "impact", "georgia", "comic"].contains(&clip.font.as_str()) && crate::fonts::installed(&clip.font).is_none() {
            return Err(format!("The font “{}” isn't on this PC. Pick it again in the Text tab to download it, then export.", clip.font));
        }
        match clip.role {
            Role::Video if !clip.effect.is_empty() && effect_filter(&clip.effect, 0.0, clip.length(), (1920, 1080, 30), (1.0, 1.0)).is_none() => {
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
                if clip.look.is_empty() == clip.effect.is_empty() || (!clip.effect.is_empty() && effect_filter(&clip.effect, clip.start, clip.length(), (1920, 1080, 30), (1.0, 1.0)).is_none()) {
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
                    // A filter and an effect dropped on this clip draw on its own picture, timed from its first frame;
                    // a removed colour goes first, from the picture as it comes.
                    let own: String = clip
                        .key
                        .and_then(key_filter)
                        .into_iter()
                        .chain(clip.look.iter().filter_map(|(op, amount)| look_filter(op, *amount)))
                        .chain(effect_filter(&clip.effect, 0.0, clip.length(), (w, h, fps), (clip.effect_strength, clip.effect_speed)).map(|f| format!(",{f}")))
                        .collect();
                    // Uncovered before the fades: the circle's sharp edge would cut a fading picture's see-through too.
                    graph.push(format!(
                        "{chain},fps={fps}{own},format=yuva420p{}{}{},setpts=PTS+{start}/TB[v{i}]",
                        clip.transition_moves(fps),
                        clip.reveal_in(i, fps),
                        clip.picture_fades()
                    ));
                    graph.push(format!(
                        "[{picture}][v{i}]overlay=x='{x}*(W-w){}':y='{y}*(H-h){}':eof_action=pass:repeatlast=0:enable='between(t,{start},{end})'[p{i}]",
                        clip.slide('W'),
                        clip.slide('H'),
                        x = clip.x,
                        y = clip.y
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
                    // As the preview draws them (Preview.css): an outline about 5% of the letter height, or a box; a
                    // style preset colours the edge (`validate` checked it) and makes it stronger.
                    let k = clip.edge_size.unwrap_or(1.0);
                    let tint = clip.edge_color.as_deref().map(|c| format!("0x{}", c.trim_start_matches('#')));
                    let edge = match (clip.edge.as_str(), &tint) {
                        ("outline", _) => format!("borderw={}:bordercolor={}", (f64::from(size) * 0.05 * k).round().max(1.0), tint.as_deref().unwrap_or("black")),
                        ("box", _) => format!("box=1:boxcolor={}:boxborderw={}", tint.as_deref().unwrap_or("black@0.6"), (f64::from(size) * 0.2).round()),
                        (_, None) if clip.edge_size.is_none() => "shadowcolor=black@0.6:shadowx=2:shadowy=2".into(),
                        (_, _) => {
                            let off = (f64::from(size) * 0.06 * k).round().max(1.0);
                            format!("shadowcolor={}:shadowx={off}:shadowy={off}", tint.as_deref().unwrap_or("black@0.6"))
                        }
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
                        effect_filter(&clip.effect, clip.start, clip.length(), (w, h, fps), (clip.effect_strength, clip.effect_speed)).map(|f| timed(&f, &on)).into_iter().collect()
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
    // A font from the library (fonts.rs), downloaded when it was picked: `validate` refuses the export without it.
    if let Some(file) = crate::fonts::installed(font).filter(|_| latin) {
        return file.to_string_lossy().replace('\\', "/").replace(':', "\\:");
    }
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

/// More than any look in effects.ts has, plus every Adjust slider and Enhance's steps.
const MAX_LOOK_STEPS: usize = 24;

/// Blur's strength: its standard deviation as a share of the frame width (effects.ts `BLUR_SHARE`).
/// RGB split at strength 1: red and blue moved this share of the width (effects.ts `RGB_SHARE`).
const RGB_SHARE: f64 = 0.008;
const BLUR_SHARE: f64 = 0.006;

/// An effect block from `start` for `length` seconds, as the preview draws it (effects.ts
/// `blocksStyle`); without its time range (the caller adds it). None for an effect the catalog
/// doesn't have. `size`: the export's width, height and frame rate.
fn effect_filter(effect: &str, start: f64, length: f64, (w, h, fps): (u32, u32, u32), (s, v): (f64, f64)) -> Option<String> {
    let (st, d) = (secs(start), secs(length));
    let ease = |x: &str| format!("(0.5-0.5*cos(PI*{x}))");
    // Seconds into the block, from the frame count: perspective has no clock, and the picture runs at `fps` from 0.
    let u = format!("(in/{fps}-{st})");
    let through = ease(&format!("clip({u}/{d},0,1)"));
    Some(match effect {
        "fade-in" => format!("fade=t=in:st={st}:d={d}:color=black"),
        "fade-out" => format!("fade=t=out:st={st}:d={d}:color=black"),
        "flash" => format!("fade=t=in:st={st}:d={d}:color=white"),
        "blur" => format!("gblur=sigma={:.2}", (BLUR_SHARE * f64::from(w) * s).max(0.01)),
        "mirror" => "hflip".into(),
        "zoom-in" => warp(&format!("(1+{:.4}*{through})", 0.3 * s), "0", "0"),
        "zoom-out" => warp(&format!("(1+{:.4}-{:.4}*{through})", 0.3 * s, 0.3 * s), "0", "0"),
        "punch" => {
            // A hit every 1/speed seconds (quicker hits when they come faster than 0.5 s apart), as effects.ts.
            let period = 1.0 / v;
            let (rise, fall) = (0.1 * (period / 0.5).min(1.0), 0.4 * (period / 0.5).min(1.0));
            let at = format!("mod({u},{period:.4})");
            let hit = format!("if(lt({at},{rise:.4}),{},1-{})", ease(&format!("clip({at}/{rise:.4},0,1)")), ease(&format!("clip(({at}-{rise:.4})/{fall:.4},0,1)")));
            warp(&format!("(1+{:.4}*{hit})", 0.2 * s), "0", "0")
        }
        "shake" => {
            // Steady for the whole block.
            let dx = format!("(0.02*W*{s:.4}*(sin(2*PI*{:.4}*{u})+0.5*sin(2*PI*{:.4}*{u}))/1.5)", 7.3 * v, 13.1 * v);
            let dy = format!("(0.02*H*{s:.4}*(sin(2*PI*{:.4}*{u}+1)+0.5*sin(2*PI*{:.4}*{u}+2))/1.5)", 9.1 * v, 5.7 * v);
            warp(&format!("(1+{:.4})", 0.06 * s), &dx, &dy)
        }
        // FFmpeg's lens falloff, which the preview draws as a gradient (effects.ts `vignetteGradient`).
        "vignette" => format!("vignette=angle={:.5}", (std::f64::consts::PI / 5.0 * s).min(std::f64::consts::FRAC_PI_2)),
        "strobe" => {
            // A white flash every 0.5/speed seconds: mixing toward white (video white is 235: brightness 107/256) is eq's
            // contrast 1-p, brightness 0.418p and saturation 1-p, the preview's white layer at opacity p (within 5/255).
            let period = 0.5 / v;
            let p = format!("({:.4}*pow(max(0,1-mod(t-{st},{period:.4})/{:.4}),2))", (0.6 * s).min(1.0), 0.6 * period);
            format!("eq=contrast='1-{p}':brightness='0.418*{p}':saturation='1-{p}':eval=frame")
        }
        "rgb-split" => {
            let n = (RGB_SHARE * f64::from(w) * s).round() as i64;
            format!("rgbashift=rh={}:bh={n}:edge=smear", -n)
        }
        // Grain on the brightness only, new every frame; the preview tiles a noise texture (a look-alike, not the same dots).
        "grain" => format!("noise=c0s={}:c0f=t+u", (14.0 * s).round() as i64),
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

/// Remove a colour as effects.ts `keyLine` draws it: the pixel's lean towards the key colour, 0.5 + r·R + g·G + b·B,
/// goes into alpha (colorchannelmixer, `aa` × the opaque alpha as the 0.5), then alpha = (edge − that) / width, within
/// 0–1 (lutrgb); starts with a comma. None for numbers effects.ts never sends.
fn key_filter([r, g, b, edge, width]: [f64; 5]) -> Option<String> {
    let ok = [r, g, b].iter().all(|w| (-1.0..=1.0).contains(w)) && (0.5..=1.5).contains(&edge) && (0.005..=1.0).contains(&width);
    ok.then(|| format!(",format=rgba,colorchannelmixer=ar={r:.4}:ag={g:.4}:ab={b:.4}:aa=0.5,lutrgb=a='clip(({edge:.4}-val/maxval)/{width:.4},0,1)*maxval'"))
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
    // A tone curve of x = val/maxval on red, green and blue.
    let curve = |y: String| {
        let channel = format!("'maxval*({})'", y.replace('X', "(val/maxval)"));
        Some(format!(",lutrgb=r={channel}:g={channel}:b={channel}"))
    };
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
        // Edit → Adjust → Warmth: red up and blue down by 0.2 at 1 (effects.ts `warmthMatrix`).
        "warmth" if within(-1.0, 1.0) => Some(mixer([1.0 + 0.2 * amount, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0 - 0.2 * amount])),
        // lutrgb keeps each result within 0..maxval, as the CSS functions do.
        "contrast" if within(0.0, 3.0) => {
            let channel = format!("'(val-maxval/2)*{amount:.4}+maxval/2'");
            Some(format!(",lutrgb=r={channel}:g={channel}:b={channel}"))
        }
        "invert" if within(0.0, 1.0) => {
            let channel = format!("'val*{:.4}+maxval*{amount:.4}'", 1.0 - 2.0 * amount);
            Some(format!(",lutrgb=r={channel}:g={channel}:b={channel}"))
        }
        // Edit → Adjust → Exposure, Highlights, Shadows: the same curves as effects.ts `toneCurve`.
        "exposure" if within(-1.0, 1.0) => {
            let g = 2f64.powf(1.5 * amount);
            curve(format!("{g:.5}*X/(1{:+.5}*X)", g - 1.0))
        }
        "highlights" if within(-1.0, 1.0) => curve(format!("X{amount:+.4}*X*X*(1-X)")),
        "shadows" if within(-1.0, 1.0) => curve(format!("X{amount:+.4}*X*(1-X)*(1-X)")),
        // Edit → Adjust → Sharpen: each neighbour's weight 0.5 × amount taken away (effects.ts `sharpenWeight`), in
        // thousandths, as convolution takes whole numbers; the same on every colour plane, alpha left alone.
        "sharpen" if within(0.0, 1.0) => {
            let a = (500.0 * amount).round() as i64;
            let m = format!("'0 -{a} 0 -{a} {} -{a} 0 -{a} 0'", 1000 + 4 * a);
            Some(format!(",convolution=0m={m}:1m={m}:2m={m}:0rdiv=0.001:1rdiv=0.001:2rdiv=0.001"))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{cover_bytes, effect_filter, frame_step, gpu_picture, key_filter, look_filter, piece_frames, pieces, timed, ClipSpec, RenderSpec, Source};
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
        assert_eq!(slide_in.slide('W'), "+W*(1-(0.5-0.5*cos(PI*clip((t-2.000)/1.000,0,1))))");
        assert_eq!(slide_in.slide('H'), "");
        assert_eq!(slide_in.picture_fades(), "");
        assert_eq!(slide_in.sound_edits(), ",volume=1.00,volume='sin(PI/2*clip(t/1.000,0,1))*(1-0.000*sin(PI*clip(t/1.000,0,1)))':eval=frame");
        // Out, at 30%: falls from 2 s of the 3 s clip and dips to 30% in the middle (the preview's `transitionGain`).
        let quiet_out = clip(r#""transitionOut":1,"transitionOutKind":"dip","transitionOutVolume":0.3"#).sound_edits();
        assert!(quiet_out.ends_with(",volume='cos(PI/2*clip((t-2.000)/1.000,0,1))*(1-0.700*sin(PI*clip((t-2.000)/1.000,0,1)))':eval=frame"), "{quiet_out}");
        assert!(!quiet_out.contains("afade"), "{quiet_out}");
        let slide_out = clip(r#""transitionOut":1,"transitionOutKind":"slide""#);
        assert_eq!(slide_out.slide('W'), "-W*(0.5-0.5*cos(PI*clip((t-4.000)/1.000,0,1)))");
        assert_eq!(slide_out.picture_fades(), "");
        // Slide up: in from below, out over the top.
        let up = clip(r#""transitionIn":1,"transitionInKind":"slide-up","transitionOut":1,"transitionOutKind":"slide-up""#);
        assert_eq!(up.slide('W'), "");
        assert_eq!(up.slide('H'), "+H*(1-(0.5-0.5*cos(PI*clip((t-2.000)/1.000,0,1))))-H*(0.5-0.5*cos(PI*clip((t-4.000)/1.000,0,1)))");
        assert!(clip(r#""transitionIn":1,"transitionInKind":"slide-right""#).slide('W').starts_with("-W*(1-"));
        // Zoom: the incoming clip fades in as it settles; each zoom only while its transition lasts.
        let zoom_in = clip(r#""transitionIn":1,"transitionInKind":"zoom""#);
        assert_eq!(zoom_in.picture_fades(), ",fade=t=in:st=0.000:d=1.000:alpha=1");
        let zooms = zoom_in.transition_moves(30);
        assert!(zooms.starts_with(",perspective=x0='W/2-(W/2+0)/(1.5-0.5*(0.5-0.5*cos(PI*clip((in/30-0.000)/1.000,0,1))))'"), "{zooms}");
        assert!(zooms.ends_with(":eval=frame:enable='between(t,0.000,1.000)'"), "{zooms}");
        let zooms = clip(r#""transitionOut":1,"transitionOutKind":"zoom""#).transition_moves(30);
        assert!(zooms.contains("/(1+0.5*(0.5-0.5*cos(PI*clip((in/30-2.000)/1.000,0,1))))'") && zooms.ends_with("enable='between(t,2.000,3.000)'"), "{zooms}");
        // Spin: turned, then zoomed; the incoming clip fades in.
        let spin = clip(r#""transitionIn":1,"transitionInKind":"spin","transitionOut":1,"transitionOutKind":"spin""#);
        let moves = spin.transition_moves(30);
        assert!(moves.starts_with(",rotate=a='-PI/2*(1-(0.5-0.5*cos(PI*clip((t-0.000)/1.000,0,1))))':c=black@0:enable='between(t,0.000,1.000)',perspective="), "{moves}");
        assert!(moves.contains(",rotate=a='PI/2*(0.5-0.5*cos(PI*clip((t-2.000)/1.000,0,1)))':c=black@0:enable='between(t,2.000,3.000)',perspective="), "{moves}");
        assert_eq!(spin.picture_fades(), ",fade=t=in:st=0.000:d=1.000:alpha=1");
        // Wipe: the first 30 frames uncovered by xfade from a see-through copy, the rest joined back; no fade.
        let wipe = clip(r#""transitionIn":1,"transitionInKind":"wipe""#);
        assert_eq!(
            wipe.reveal_in(4, 30),
            ",split[h4a][h4b];[h4a]trim=end_frame=30,split[w4a][w4b];[w4a]lut=a=0[w4c];[w4c][w4b]xfade=transition=wiperight:duration=1.000:offset=0,format=yuva420p[h4h];[h4b]trim=start_frame=30,setpts=PTS-STARTPTS[h4r];[h4h][h4r]concat=n=2:v=1:a=0"
        );
        assert_eq!(wipe.picture_fades(), "");
        assert!(clip(r#""transitionIn":1,"transitionInKind":"wipe-up""#).reveal_in(4, 30).contains("transition=wipeup:"));
        // A 0.75 s circle at 30 fps: 23 frames (0.733 s is the last before 0.75), the middle third of a 69-frame circleopen.
        let circle = clip(r#""transitionIn":0.75,"transitionInKind":"circle""#).reveal_in(4, 30);
        assert!(circle.contains("trim=end_frame=23,tpad=start=23:stop=23:") && circle.contains("circleopen:duration=2.300:offset=0,trim=start_frame=23:end_frame=46,"), "{circle}");
        assert_eq!(clip(r#""transitionIn":1,"transitionInKind":"circle""#).picture_fades(), "");
        // A sound fade changes the sound only.
        let quiet = clip(r#""soundFadeIn":0.5,"soundFadeOut":2"#);
        assert_eq!(quiet.picture_fades(), "");
        let sound = quiet.sound_edits();
        assert!(sound.contains(",afade=t=in:st=0.000:d=0.500") && sound.contains(",afade=t=out:st=1.000:d=2.000"), "{sound}");
        // A crossfade moves, zooms and wipes nothing.
        let fade = clip(r#""transitionIn":1,"transitionOut":1"#);
        assert_eq!(fade.slide('W') + &fade.slide('H') + &fade.transition_moves(30) + &fade.reveal_in(4, 30), "");
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
        assert_eq!(effect_filter("fade-in", 2.0, 3.0, (1920, 1080, 30), (1.0, 1.0)).unwrap(), "fade=t=in:st=2.000:d=3.000:color=black");
        assert_eq!(effect_filter("flash", 0.0, 1.0, (1920, 1080, 30), (1.0, 1.0)).unwrap(), "fade=t=in:st=0.000:d=1.000:color=white");
        assert_eq!(effect_filter("blur", 0.0, 1.0, (1000, 562, 30), (1.0, 1.0)).unwrap(), "gblur=sigma=6.00");
        assert_eq!(effect_filter("mirror", 0.0, 1.0, (1920, 1080, 30), (1.0, 1.0)).unwrap(), "hflip");
        assert!(effect_filter("explode", 0.0, 1.0, (1920, 1080, 30), (1.0, 1.0)).is_none());
        // Zoom: 1 to 1.3 eased over the block, timed by frame count at the export's rate.
        let zoom = effect_filter("zoom-in", 2.0, 3.0, (1920, 1080, 30), (1.0, 1.0)).unwrap();
        assert!(zoom.starts_with("perspective=x0='W/2-(W/2+0)/(1+0.3000*(0.5-0.5*cos(PI*clip((in/30-2.000)/3.000,0,1))))'"), "{zoom}");
        assert!(zoom.ends_with(":eval=frame"));
        // Strength and speed: twice the blur; a punch every half second; shake steady (no fall-off) at twice the speed.
        assert_eq!(effect_filter("blur", 0.0, 1.0, (1000, 562, 30), (2.0, 1.0)).unwrap(), "gblur=sigma=12.00");
        assert!(effect_filter("punch", 0.0, 5.0, (1920, 1080, 30), (1.0, 2.0)).unwrap().contains("mod((in/30-0.000),0.5000)"));
        let shake = effect_filter("shake", 0.0, 5.0, (1920, 1080, 30), (1.0, 2.0)).unwrap();
        assert!(shake.contains("sin(2*PI*14.6000*(in/30-0.000))") && !shake.contains("pow(1-"), "{shake}");
        // The new ones.
        assert_eq!(effect_filter("vignette", 0.0, 1.0, (1920, 1080, 30), (1.0, 1.0)).unwrap(), "vignette=angle=0.62832");
        assert_eq!(effect_filter("vignette", 0.0, 1.0, (1920, 1080, 30), (2.0, 1.0)).unwrap(), "vignette=angle=1.25664");
        assert_eq!(effect_filter("rgb-split", 0.0, 1.0, (1920, 1080, 30), (1.0, 1.0)).unwrap(), "rgbashift=rh=-15:bh=15:edge=smear");
        assert_eq!(effect_filter("grain", 0.0, 1.0, (1920, 1080, 30), (1.0, 1.0)).unwrap(), "noise=c0s=14:c0f=t+u");
        let strobe = effect_filter("strobe", 2.0, 1.0, (1920, 1080, 30), (1.0, 1.0)).unwrap();
        assert_eq!(strobe, "eq=contrast='1-(0.6000*pow(max(0,1-mod(t-2.000,0.5000)/0.3000),2))':brightness='0.418*(0.6000*pow(max(0,1-mod(t-2.000,0.5000)/0.3000),2))':saturation='1-(0.6000*pow(max(0,1-mod(t-2.000,0.5000)/0.3000),2))':eval=frame");
        // Bars: 2.39:1 on 16:9 (12.81% each), both boxes timed.
        let bars = effect_filter("bars", 1.0, 2.0, (1920, 1080, 30), (1.0, 1.0)).unwrap();
        assert!(bars.contains("ih*0.1281)") && bars.contains(":enable='between(t,1.000,3.000)',drawbox"), "{bars}");
        assert!(effect_filter("bars", 1.0, 2.0, (1080, 1920, 30), (1.0, 1.0)).unwrap().contains("ih*0.1000)"));
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
        assert!(look_filter("warmth", 0.5).unwrap().ends_with("rr=1.10000:rg=0.00000:rb=0.00000:gr=0.00000:gg=1.00000:gb=0.00000:br=0.00000:bg=0.00000:bb=0.90000"));
        assert!(look_filter("warmth", 1.5).is_none());
        assert_eq!(
            look_filter("exposure", -1.0).unwrap(),
            ",lutrgb=r='maxval*(0.35355*(val/maxval)/(1-0.64645*(val/maxval)))':g='maxval*(0.35355*(val/maxval)/(1-0.64645*(val/maxval)))':b='maxval*(0.35355*(val/maxval)/(1-0.64645*(val/maxval)))'"
        );
        assert!(look_filter("highlights", 0.5).unwrap().starts_with(",lutrgb=r='maxval*((val/maxval)+0.5000*(val/maxval)*(val/maxval)*(1-(val/maxval)))'"));
        assert!(look_filter("shadows", -0.25).unwrap().starts_with(",lutrgb=r='maxval*((val/maxval)-0.2500*(val/maxval)*(1-(val/maxval))*(1-(val/maxval)))'"));
        assert_eq!(look_filter("sharpen", 0.5).unwrap(), ",convolution=0m='0 -250 0 -250 2000 -250 0 -250 0':1m='0 -250 0 -250 2000 -250 0 -250 0':2m='0 -250 0 -250 2000 -250 0 -250 0':0rdiv=0.001:1rdiv=0.001:2rdiv=0.001");
        assert!(look_filter("sharpen", -0.5).is_none());
        assert!(look_filter("exposure", 1.5).is_none());
        // Remove a colour: effects.ts `keyLine` for #00b140 at 50 / 20; numbers it never sends are refused.
        assert_eq!(
            key_filter([-0.4203, 0.5024, -0.0821, 0.6887, 0.0492]).unwrap(),
            ",format=rgba,colorchannelmixer=ar=-0.4203:ag=0.5024:ab=-0.0821:aa=0.5,lutrgb=a='clip((0.6887-val/maxval)/0.0492,0,1)*maxval'"
        );
        assert!(key_filter([0.0, 0.0, 0.0, 0.6887, 0.0]).is_none());
        assert!(key_filter([f64::NAN, 0.5, 0.0, 0.6887, 0.05]).is_none());
        // Only the catalog's names and amounts reach FFmpeg.
        assert!(look_filter("saturate", 2.5).is_none());
        assert!(look_filter("blur", 1.0).is_none());
        assert!(look_filter("brightness", f64::NAN).is_none());
        assert!(look_filter("grayscale';drawtext", 1.0).is_none());
    }
}
