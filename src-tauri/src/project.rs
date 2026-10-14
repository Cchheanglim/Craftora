//! Rendering a whole timeline: clips joined back to back on the main track, videos
//! overlaid on top, text drawn in, every sound mixed. One FFmpeg pass, after yt-dlp has
//! fetched the parts of any links that are used.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::jobs::{
    download, free_path, is_web_link, output_dir, run_ffmpeg, safe_stem, secs, spawn_job, Container, Download,
    DownloadTarget, Output,
};
use crate::local::{normalize, probe, OpenedFiles, ProbeInfo};

const MAX_CLIPS: usize = 80;
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
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Role {
    /// Video 1: clips play back to back and set the base picture.
    Main,
    /// Video 2+: picture-in-picture on top.
    Overlay,
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

impl TransitionKind {
    /// The matching FFmpeg `xfade` transition.
    fn xfade(self) -> &'static str {
        match self {
            TransitionKind::Crossfade => "fade",
            TransitionKind::Dip => "fadeblack",
        }
    }
}

fn one() -> f64 {
    1.0
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipSpec {
    role: Role,
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
    /// Seconds of fade in and out (picture from/to black or transparent, sound from/to silence).
    #[serde(default)]
    fade_in: f64,
    #[serde(default)]
    fade_out: f64,
    /// Fractions of the picture cut off: left, top, right, bottom.
    #[serde(default)]
    crop: [f64; 4],
    /// Main clips: seconds this clip overlaps the previous one (0 = straight cut).
    #[serde(default)]
    transition: f64,
    #[serde(default)]
    transition_kind: TransitionKind,
    /// Overlays: width as a fraction of the frame. Text: height as a fraction of the frame.
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

impl ClipSpec {
    /// Seconds on the timeline (after the speed change).
    fn length(&self) -> f64 {
        (self.out - self.in_point) / self.speed
    }
    fn end(&self) -> f64 {
        self.start + self.length()
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

    /// Picture fades over the clip's own time: to black, or with `alpha` to transparent.
    fn picture_fades(&self, alpha: bool) -> String {
        let alpha = if alpha { ":alpha=1" } else { "" };
        let mut chain = String::new();
        if self.fade_in > 0.0 {
            chain.push_str(&format!(",fade=t=in:st=0:d={}{alpha}", secs(self.fade_in)));
        }
        if self.fade_out > 0.0 {
            chain.push_str(&format!(",fade=t=out:st={}:d={}{alpha}", secs(self.length() - self.fade_out), secs(self.fade_out)));
        }
        chain
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
        if self.fade_in > 0.0 {
            chain.push_str(&format!(",afade=t=in:st=0:d={}", secs(self.fade_in)));
        }
        if self.fade_out > 0.0 {
            chain.push_str(&format!(",afade=t=out:st={}:d={}", secs(self.length() - self.fade_out), secs(self.fade_out)));
        }
        chain
    }

    /// drawtext's opacity over time for a faded text clip, or nothing.
    fn text_alpha(&self) -> String {
        let (start, end) = (self.start, self.end());
        let mut expr = "1".to_string();
        if self.fade_out > 0.0 {
            expr = format!("if(gt(t,{}),({}-t)/{},{expr})", secs(end - self.fade_out), secs(end), secs(self.fade_out));
        }
        if self.fade_in > 0.0 {
            expr = format!("if(lt(t,{}),(t-{})/{},{expr})", secs(start + self.fade_in), secs(start), secs(self.fade_in));
        }
        if expr == "1" { String::new() } else { format!(":alpha='clip({expr},0,1)'") }
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
    spawn_job(app, spec.id.clone(), async move { render(&task_app, &spec).await });
    Ok(())
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
        let numbers =
            [clip.start, clip.in_point, clip.out, clip.speed, clip.volume, clip.fade_in, clip.fade_out, clip.transition, clip.size, clip.x, clip.y, l, t, r, b];
        if !numbers.into_iter().all(finite)
            || clip.start < 0.0
            || clip.in_point < 0.0
            || !(0.25..=4.0).contains(&clip.speed)
            || clip.length() < 0.05
            || clip.fade_in < 0.0
            || clip.fade_out < 0.0
            || clip.fade_in + clip.fade_out > clip.length() + 0.01
            || clip.transition < 0.0
            || clip.transition > clip.length() / 2.0 + 0.01
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

/// A usable input for FFmpeg: a local file plus how far its time is shifted.
struct Input {
    index: usize,
    /// Downloaded sections start at the section's beginning, not at 0.
    offset: f64,
    info: ProbeInfo,
}

async fn render(app: &AppHandle, spec: &RenderSpec) -> Result<PathBuf, String> {
    let dir = output_dir(app)?;
    let final_path = free_path(&dir, &safe_stem(&spec.file_name), spec.container.ext());
    let work = dir.join(format!(".craftora-{}", safe_stem(&spec.id)));
    std::fs::create_dir_all(&work).map_err(|e| format!("Couldn't create a working folder: {e}"))?;

    let result = render_in(app, spec, &work, &final_path).await;
    let _ = std::fs::remove_dir_all(&work);
    if result.is_err() {
        let _ = std::fs::remove_file(&final_path);
    }
    result.map(|_| final_path)
}

async fn render_in(app: &AppHandle, spec: &RenderSpec, work: &Path, output: &Path) -> Result<(), String> {
    // 1. Every media file used, as a local path (links: just the part the clips use).
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut inputs: HashMap<&str, Input> = HashMap::new();
    for media in &spec.media {
        let used: Vec<&ClipSpec> =
            spec.clips.iter().filter(|c| c.media_id.as_deref() == Some(media.id.as_str())).collect();
        if used.is_empty() {
            continue;
        }
        let (path, offset) = if media.local {
            (PathBuf::from(&media.src), 0.0)
        } else {
            let from = used.iter().map(|c| c.in_point).fold(f64::INFINITY, f64::min);
            let to = used.iter().map(|c| c.out).fold(0.0, f64::max);
            let request = Download {
                url: &media.src,
                format: &media.format,
                section: Some((from, to)),
                precise: true,
                target: DownloadTarget::Any,
            };
            let stem = format!("media-{}", paths.len());
            (download(app, &spec.id, &request, work, &stem).await?, from)
        };
        let info = probe(app, &path).await?;
        inputs.insert(media.id.as_str(), Input { index: paths.len(), offset, info });
        paths.push(path);
    }

    // 2. The filter graph.
    let (w, h, fps) = (spec.width, spec.height, spec.fps);
    let is_video = spec.output == Output::Video;
    let total = spec.clips.iter().map(ClipSpec::end).fold(0.0, f64::max);
    let mut graph: Vec<String> = Vec::new();
    let mut sounds: Vec<String> = Vec::new();
    let input_of = |clip: &ClipSpec| clip.media_id.as_deref().and_then(|id| inputs.get(id));

    // Main track, back to back.
    let mut main: Vec<&ClipSpec> = spec.clips.iter().filter(|c| c.role == Role::Main).collect();
    main.sort_by(|a, b| a.start.total_cmp(&b.start));
    let main_end = main.iter().map(|c| c.end()).fold(0.0, f64::max);
    for (i, clip) in main.iter().enumerate() {
        let input = input_of(clip).ok_or("Missing media for a clip.")?;
        let (from, to) = (clip.in_point - input.offset, clip.out - input.offset);
        let length = clip.length();
        if is_video {
            if input.info.has_video {
                graph.push(format!(
                    "[{}:v]trim=start={}:end={},setpts=PTS-STARTPTS{},scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps={fps},tpad=stop_mode=clone:stop_duration=1,trim=duration={},setpts=PTS-STARTPTS,format=yuv420p{}[mv{i}]",
                    input.index,
                    secs(from),
                    secs(to),
                    clip.picture_edits(),
                    secs(length),
                    clip.picture_fades(false)
                ));
            } else {
                graph.push(format!("color=black:s={w}x{h}:r={fps}:d={},format=yuv420p[mv{i}]", secs(length)));
            }
        }
        // Every main clip contributes sound (silence if it has none), exactly as long as its
        // picture, so the joins and transitions stay in step.
        if input.info.has_audio {
            graph.push(format!(
                "[{}:a]atrim=start={}:end={},asetpts=PTS-STARTPTS{},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur={len},atrim=duration={len}[ma{i}]",
                input.index,
                secs(from),
                secs(to),
                clip.sound_edits(),
                len = secs(length)
            ));
        } else {
            graph.push(format!("anullsrc=r=48000:cl=stereo,atrim=duration={},aformat=sample_fmts=fltp[ma{i}]", secs(length)));
        }
    }

    // Join the main clips one by one: a straight cut, or a transition where they overlap.
    // A transition starts where the incoming clip starts on the timeline.
    let (mut joined, mut main_audio) = ("mv0".to_string(), "ma0".to_string());
    for (i, clip) in main.iter().enumerate().skip(1) {
        if clip.transition > 0.0 {
            if is_video {
                graph.push(format!(
                    "[{joined}][mv{i}]xfade=transition={}:duration={}:offset={}[jv{i}]",
                    clip.transition_kind.xfade(),
                    secs(clip.transition),
                    secs(clip.start)
                ));
            }
            graph.push(format!("[{main_audio}][ma{i}]acrossfade=d={}:c1=tri:c2=tri[ja{i}]", secs(clip.transition)));
        } else {
            if is_video {
                graph.push(format!("[{joined}][mv{i}]concat=n=2:v=1:a=0[jv{i}]"));
            }
            graph.push(format!("[{main_audio}][ma{i}]concat=n=2:v=0:a=1[ja{i}]"));
        }
        (joined, main_audio) = (format!("jv{i}"), format!("ja{i}"));
    }

    let mut picture = String::new();
    if is_video {
        if main.is_empty() {
            graph.push(format!("color=black:s={w}x{h}:r={fps}:d={},format=yuv420p[base]", secs(total)));
        } else {
            // Overlays or sounds that run past the main track continue over black.
            let pad = (total - main_end).max(0.0);
            graph.push(format!("[{joined}]tpad=stop_mode=add:stop_duration={}:color=black[base]", secs(pad)));
            sounds.push(format!("[{main_audio}]"));
        }
        picture = "base".into();
    } else if !main.is_empty() {
        sounds.push(format!("[{main_audio}]"));
    }

    // Everything else, in timeline order.
    let mut others: Vec<(usize, &ClipSpec)> = spec.clips.iter().filter(|c| c.role != Role::Main).enumerate().collect();
    others.sort_by(|a, b| a.1.start.total_cmp(&b.1.start));
    let font = font_path();
    for (j, clip) in others {
        let (start, end) = (secs(clip.start), secs(clip.end()));
        match clip.role {
            Role::Overlay if is_video => {
                let input = input_of(clip).ok_or("Missing media for a clip.")?;
                if input.info.has_video {
                    let width = (((w as f64) * clip.size / 2.0).round() as u32 * 2).max(2);
                    graph.push(format!(
                        "[{}:v]trim=start={}:end={},setpts=PTS-STARTPTS{},scale={width}:-2,format=yuva420p{},setpts=PTS+{start}/TB[o{j}]",
                        input.index,
                        secs(clip.in_point - input.offset),
                        secs(clip.out - input.offset),
                        clip.picture_edits(),
                        clip.picture_fades(true)
                    ));
                    graph.push(format!(
                        "[{picture}][o{j}]overlay=x='{x}*(W-w)':y='{y}*(H-h)':eof_action=pass:enable='between(t,{start},{end})'[p{j}]",
                        x = clip.x,
                        y = clip.y
                    ));
                    picture = format!("p{j}");
                }
            }
            Role::Text if is_video => {
                // The text goes in a file so no character can break the filter syntax.
                let file = format!("text{j}.txt");
                std::fs::write(work.join(&file), clip.text.as_bytes()).map_err(|e| format!("Couldn't prepare text: {e}"))?;
                let size = ((h as f64) * clip.size).round().max(8.0) as u32;
                let color = clip.color.trim_start_matches('#');
                graph.push(format!(
                    "[{picture}]drawtext=fontfile='{font}':textfile='{file}':expansion=none:fontsize={size}:fontcolor=0x{color}:shadowcolor=black@0.6:shadowx=2:shadowy=2:x='(w-text_w)*{x}':y='(h-text_h)*{y}'{alpha}:enable='between(t,{start},{end})'[p{j}]",
                    x = clip.x,
                    y = clip.y,
                    alpha = clip.text_alpha()
                ));
                picture = format!("p{j}");
            }
            _ => {}
        }
        // Sound from overlays and audio clips, placed at their start.
        if matches!(clip.role, Role::Overlay | Role::Audio) && clip.volume > 0.0 {
            let input = input_of(clip).ok_or("Missing media for a clip.")?;
            if input.info.has_audio {
                let delay = (clip.start * 1000.0).round() as u64;
                graph.push(format!(
                    "[{}:a]atrim=start={}:end={},asetpts=PTS-STARTPTS{},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays={delay}:all=1[s{j}]",
                    input.index,
                    secs(clip.in_point - input.offset),
                    secs(clip.out - input.offset),
                    clip.sound_edits()
                ));
                sounds.push(format!("[s{j}]"));
            }
        }
    }

    let sound = match sounds.len() {
        0 => None,
        1 => Some(sounds[0].trim_matches(['[', ']']).to_string()),
        n => {
            graph.push(format!("{}amix=inputs={n}:duration=longest:normalize=0[mix]", sounds.join("")));
            Some("mix".to_string())
        }
    };

    // 3. The FFmpeg command.
    let mut args: Vec<String> = ["-y", "-hide_banner", "-nostats", "-progress", "pipe:1"].map(String::from).to_vec();
    for path in &paths {
        args.extend(["-i".into(), path.to_string_lossy().into_owned()]);
    }
    args.extend(["-filter_complex".into(), graph.join(";")]);
    if is_video {
        args.extend(["-map".into(), format!("[{picture}]")]);
        args.extend(["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-r"].map(String::from));
        args.push(fps.to_string());
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
        None if !is_video => return Err("There's no sound on the timeline to save.".into()),
        None => args.push("-an".into()),
    }
    args.extend(["-t".into(), secs(total)]);
    if spec.container == Container::Mp4 {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.push(output.to_string_lossy().into_owned());

    run_ffmpeg(app, &spec.id, args, total, "encoding", Some(work)).await
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
