//! Running export jobs: yt-dlp downloads the chosen section of a link (files on this PC
//! skip that), then one FFmpeg pass applies mirror/reverse, layers and the sound mix. Progress streams to the UI as `job-event` events.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::engine::{last_error, sidecar_dir, FFMPEG, YT_DLP};
use crate::local::{normalize, probe, OpenedFiles};

/// What the export panel asks for. Rust builds every command-line argument itself;
/// the UI never passes raw arguments.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSpec {
    id: String,
    url: String,
    /// yt-dlp format selector, as returned by `fetch_media`.
    format: String,
    output: Output,
    container: Container,
    start: f64,
    end: f64,
    duration: f64,
    cut_mode: CutMode,
    mirror: bool,
    reverse: bool,
    file_name: String,
    /// `url` is a file on this PC (opened via `open_local`); FFmpeg does all the work.
    #[serde(default)]
    local: bool,
    /// Extra videos and sounds stacked on the clip, CapCut-style.
    #[serde(default)]
    layers: Vec<LayerSpec>,
    /// Loudness of the clip's own sound, 0–2 (1 = unchanged).
    #[serde(default = "one")]
    main_volume: f64,
}

fn one() -> f64 {
    1.0
}

/// A file from this PC placed on the clip.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerSpec {
    path: String,
    kind: LayerKind,
    /// Seconds after the clip's In point when the layer begins.
    start: f64,
    /// 0–2 (1 = unchanged); 0 drops the layer's sound.
    volume: f64,
    /// Video layers: width as a fraction of the clip's width.
    #[serde(default = "one")]
    size: f64,
    /// Video layers: position across the free space, 0 = left/top, 1 = right/bottom.
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum LayerKind {
    Video,
    Audio,
}

const MAX_LAYERS: usize = 8;

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Output {
    Video,
    Audio,
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Container {
    Mp4,
    Mkv,
    Mp3,
    Wav,
    Flac,
}

impl Container {
    fn ext(self) -> &'static str {
        match self {
            Container::Mp4 => "mp4",
            Container::Mkv => "mkv",
            Container::Mp3 => "mp3",
            Container::Wav => "wav",
            Container::Flac => "flac",
        }
    }
    fn is_video(self) -> bool {
        matches!(self, Container::Mp4 | Container::Mkv)
    }
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum CutMode {
    Fast,
    Precise,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
enum JobEvent {
    Progress {
        id: String,
        phase: &'static str,
        /// 0–100, or None while the total is unknown.
        percent: Option<f64>,
        downloaded_bytes: Option<f64>,
        total_bytes: Option<f64>,
        speed_bps: Option<f64>,
        eta_seconds: Option<f64>,
    },
    Done {
        id: String,
        path: String,
        size_bytes: u64,
    },
    Failed {
        id: String,
        message: String,
    },
    Cancelled {
        id: String,
    },
}

/// Jobs currently running, so they can be cancelled.
#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, Running>>);

#[derive(Default)]
struct Running {
    child: Option<CommandChild>,
    cancelled: bool,
}

impl Jobs {
    fn register(&self, id: &str) {
        self.0.lock().unwrap().insert(id.to_string(), Running::default());
    }

    /// Keeps the running process so it can be killed. Returns the child back
    /// when the job was cancelled before the process started.
    fn attach(&self, id: &str, child: CommandChild) -> Option<CommandChild> {
        let mut jobs = self.0.lock().unwrap();
        match jobs.get_mut(id) {
            Some(job) if !job.cancelled => {
                job.child = Some(child);
                None
            }
            _ => Some(child),
        }
    }

    fn is_cancelled(&self, id: &str) -> bool {
        self.0.lock().unwrap().get(id).is_none_or(|j| j.cancelled)
    }

    fn cancel(&self, id: &str) -> bool {
        let mut jobs = self.0.lock().unwrap();
        let Some(job) = jobs.get_mut(id) else { return false };
        job.cancelled = true;
        if let Some(child) = job.child.take() {
            let _ = child.kill();
        }
        true
    }

    /// Forgets the job; returns whether it had been cancelled.
    fn finish(&self, id: &str) -> bool {
        self.0.lock().unwrap().remove(id).is_some_and(|j| j.cancelled)
    }
}

/// Starts a job in the background; progress arrives as `job-event` events.
#[tauri::command]
pub async fn start_job(app: AppHandle, jobs: State<'_, Jobs>, spec: JobSpec) -> Result<(), String> {
    if spec.end <= spec.start || spec.start < 0.0 {
        return Err("The clip range is empty.".into());
    }
    if (spec.output == Output::Video) != spec.container.is_video() {
        return Err("That file type doesn't match the output.".into());
    }
    if spec.local {
        let opened = app.state::<OpenedFiles>();
        let allowed = normalize(Path::new(&spec.url)).is_ok_and(|p| opened.contains(&p));
        if !allowed {
            return Err("Open the file again; Craftora only works on files you've opened.".into());
        }
    } else if !(spec.url.starts_with("https://") || spec.url.starts_with("http://")) {
        return Err("Only web links can be downloaded.".into());
    }
    if spec.layers.len() > MAX_LAYERS {
        return Err(format!("A clip can have at most {MAX_LAYERS} layers."));
    }
    let opened = app.state::<OpenedFiles>();
    for layer in &spec.layers {
        if !normalize(Path::new(&layer.path)).is_ok_and(|p| opened.contains(&p)) {
            return Err("A layer's file isn't open any more. Remove the layer and add it again.".into());
        }
        let in_range = |v: f64, lo: f64, hi: f64| v.is_finite() && (lo..=hi).contains(&v);
        if !(in_range(layer.start, 0.0, spec.duration)
            && in_range(layer.volume, 0.0, 2.0)
            && in_range(layer.size, 0.05, 1.0)
            && in_range(layer.x, 0.0, 1.0)
            && in_range(layer.y, 0.0, 1.0))
        {
            return Err("A layer has an invalid setting.".into());
        }
    }
    if !(0.0..=2.0).contains(&spec.main_volume) {
        return Err("The clip volume is out of range.".into());
    }
    jobs.register(&spec.id);
    tauri::async_runtime::spawn(async move {
        let id = spec.id.clone();
        let result = run_job(&app, &spec).await;
        let cancelled = app.state::<Jobs>().finish(&id);
        let event = match result {
            _ if cancelled => JobEvent::Cancelled { id },
            Ok(path) => {
                let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                JobEvent::Done { id, path: path.to_string_lossy().into_owned(), size_bytes }
            }
            Err(message) => JobEvent::Failed { id, message },
        };
        let _ = app.emit("job-event", event);
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_job(jobs: State<'_, Jobs>, id: String) -> bool {
    jobs.cancel(&id)
}

/// `Videos\Craftora`, created on first use.
fn output_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .video_dir()
        .map_err(|e| format!("Couldn't find your Videos folder: {e}"))?
        .join("Craftora");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// A safe file stem: letters, digits, `-` and `_` only, never empty.
fn safe_stem(name: &str) -> String {
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let clean: String = stem
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(80)
        .collect();
    if clean.is_empty() { "clip".into() } else { clean }
}

/// First free `stem.ext`, `stem (2).ext`, … in `dir`.
fn free_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    path
}

async fn run_job(app: &AppHandle, spec: &JobSpec) -> Result<PathBuf, String> {
    let dir = output_dir(app)?;
    let ext = spec.container.ext();
    let stem = safe_stem(&spec.file_name);
    let final_path = free_path(&dir, &stem, ext);

    if spec.local {
        return render(app, spec, Main::Local, &final_path).await.map(|_| final_path);
    }

    // Web links: yt-dlp downloads the section, straight to the final name unless FFmpeg
    // still has work (transforms, layers, volume), in which case it goes to a temporary file.
    let needs_render = spec.has_transform() || !spec.layers.is_empty() || (spec.main_volume - 1.0).abs() > 0.01;
    let download_stem = if needs_render { format!(".{stem}.craftora-tmp") } else {
        final_path.file_stem().unwrap().to_string_lossy().into_owned()
    };
    let downloaded = download(app, spec, &dir, &download_stem).await?;
    if !needs_render {
        return Ok(downloaded);
    }
    let result = render(app, spec, Main::Downloaded(&downloaded), &final_path).await;
    let _ = std::fs::remove_file(&downloaded);
    result.map(|_| final_path)
}

impl JobSpec {
    fn has_transform(&self) -> bool {
        self.output == Output::Video && (self.mirror || self.reverse)
    }
    fn is_whole(&self) -> bool {
        self.start <= 0.05 && self.end >= self.duration - 0.05
    }
    fn clip_length(&self) -> f64 {
        if self.is_whole() { self.duration } else { self.end - self.start }
    }
}

/// Stage 1: yt-dlp downloads (only the chosen section of) the source.
async fn download(app: &AppHandle, spec: &JobSpec, dir: &Path, stem: &str) -> Result<PathBuf, String> {
    let engines = sidecar_dir()?;
    let template = dir.join(format!("{stem}.%(ext)s"));
    let ext = spec.container.ext();

    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--newline".into(),
        "--progress".into(),
        "--encoding".into(),
        "utf-8".into(),
        "--ffmpeg-location".into(),
        engines.to_string_lossy().into_owned(),
        "-f".into(),
        spec.format.clone(),
        "--progress-template".into(),
        "download:CRAFTORA|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s".into(),
        "--print".into(),
        "after_move:CRAFTORA_FILE|%(filepath)s".into(),
        "-o".into(),
        template.to_string_lossy().into_owned(),
    ];

    let whole = spec.start <= 0.05 && spec.end >= spec.duration - 0.05;
    if !whole {
        args.push("--download-sections".into());
        args.push(format!("*{:.2}-{:.2}", spec.start, spec.end));
        if spec.cut_mode == CutMode::Precise {
            args.push("--force-keyframes-at-cuts".into());
        }
    }
    match spec.output {
        Output::Video => {
            args.extend(["--merge-output-format".into(), ext.into(), "--remux-video".into(), ext.into()]);
        }
        Output::Audio => {
            args.extend(["-x".into(), "--audio-format".into(), ext.into()]);
        }
    }
    args.push("--".into());
    args.push(spec.url.clone());

    let mut final_file: Option<PathBuf> = None;
    let mut phase = "downloading";
    run_streaming(app, &spec.id, YT_DLP, args, |line| {
        if let Some(path) = line.strip_prefix("CRAFTORA_FILE|") {
            final_file = Some(PathBuf::from(path.trim()));
            return None;
        }
        if let Some(fields) = line.strip_prefix("CRAFTORA|") {
            return Some(progress_from_fields(&spec.id, fields));
        }
        // yt-dlp's post-processors announce themselves like "[Merger] Merging formats…".
        let post = ["[Merger]", "[ExtractAudio]", "[VideoRemuxer]", "[VideoConvertor]", "[FixupM3u8]", "[ModifyChapters]"];
        if phase == "downloading" && post.iter().any(|p| line.starts_with(p)) {
            phase = "processing";
            return Some(progress_event(&spec.id, "processing", None));
        }
        None
    })
    .await?;

    final_file
        .filter(|p| p.exists())
        .ok_or_else(|| "yt-dlp finished but the file wasn't found.".into())
}

/// Where the clip's own picture and sound come from for the FFmpeg pass.
enum Main<'a> {
    /// A file on this PC: FFmpeg seeks to the In point itself.
    Local,
    /// A section yt-dlp already downloaded: it starts at the In point.
    Downloaded(&'a Path),
}

/// Formats seconds for FFmpeg arguments.
fn secs(t: f64) -> String {
    format!("{t:.3}")
}

/// One FFmpeg pass: cut (local files), mirror/reverse, stack video layers, mix sound,
/// and convert to the chosen format. Works offline.
async fn render(app: &AppHandle, spec: &JobSpec, main: Main<'_>, output: &Path) -> Result<(), String> {
    let clip = spec.clip_length();
    let main_path = match main {
        Main::Local => PathBuf::from(&spec.url),
        Main::Downloaded(path) => path.to_path_buf(),
    };

    let mut args: Vec<String> = ["-y", "-hide_banner", "-nostats", "-progress", "pipe:1"].map(String::from).to_vec();
    if matches!(main, Main::Local) && !spec.is_whole() {
        // Input options: seeking before -i is fast, and with stream copy lands on a keyframe.
        args.extend(["-ss".into(), secs(spec.start), "-t".into(), secs(clip)]);
    }
    args.extend(["-i".into(), main_path.to_string_lossy().into_owned()]);

    let is_video = spec.output == Output::Video;
    let simple = spec.layers.is_empty() && (spec.main_volume - 1.0).abs() <= 0.01;
    let phase;

    if is_video && simple && !spec.has_transform() && spec.cut_mode == CutMode::Fast {
        // Nothing to change in the picture or sound: copy the streams as they are.
        args.extend(["-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero"].map(String::from));
        phase = "cutting";
    } else {
        let main_info = probe(app, &main_path).await?;
        let mut layer_info = Vec::with_capacity(spec.layers.len());
        for layer in &spec.layers {
            args.extend(["-i".into(), layer.path.clone()]);
            layer_info.push(probe(app, Path::new(&layer.path)).await?);
        }

        let mut graph: Vec<String> = Vec::new();

        // Picture: the clip (mirrored/reversed if asked), then each video layer on top.
        let mut video_out = None;
        if is_video {
            let mut filters: Vec<&str> = Vec::new();
            if spec.mirror {
                filters.push("hflip");
            }
            if spec.reverse {
                filters.push("reverse");
            }
            let base = if filters.is_empty() { "null".to_string() } else { filters.join(",") };
            graph.push(format!("[0:v]{base}[v0]"));
            let mut current = "v0".to_string();
            for (i, (layer, info)) in spec.layers.iter().zip(&layer_info).enumerate() {
                if layer.kind != LayerKind::Video || !info.has_video {
                    continue;
                }
                let input = i + 1;
                let width = ((main_info.width.unwrap_or(1280) as f64 * layer.size / 2.0).round() as u32 * 2).max(2);
                graph.push(format!(
                    "[{input}:v]scale={width}:-2,setpts=PTS-STARTPTS+{start}/TB[l{input}]",
                    start = secs(layer.start)
                ));
                let next = format!("v{input}");
                graph.push(format!(
                    "[{current}][l{input}]overlay=x='{x}*(W-w)':y='{y}*(H-h)':eof_action=pass[{next}]",
                    x = layer.x,
                    y = layer.y
                ));
                current = next;
            }
            video_out = Some(current);
        }

        // Sound: the clip's own (reversed with the picture), plus every layer's, mixed.
        let mut sounds: Vec<String> = Vec::new();
        if main_info.has_audio && spec.main_volume > 0.0 {
            let reverse = if spec.reverse && is_video { "areverse," } else { "" };
            graph.push(format!("[0:a]{reverse}volume={:.2}[a0]", spec.main_volume));
            sounds.push("[a0]".into());
        }
        for (i, (layer, info)) in spec.layers.iter().zip(&layer_info).enumerate() {
            if !info.has_audio || layer.volume <= 0.0 {
                continue;
            }
            let input = i + 1;
            let delay_ms = (layer.start * 1000.0).round() as u64;
            graph.push(format!("[{input}:a]adelay=delays={delay_ms}:all=1,volume={:.2}[a{input}]", layer.volume));
            sounds.push(format!("[a{input}]"));
        }
        let audio_out = match sounds.len() {
            0 => None,
            1 => Some(sounds[0].trim_matches(['[', ']']).to_string()),
            n => {
                graph.push(format!("{}amix=inputs={n}:duration=longest:normalize=0[amix]", sounds.join("")));
                Some("amix".to_string())
            }
        };

        if !graph.is_empty() {
            args.extend(["-filter_complex".into(), graph.join(";")]);
        }
        if let Some(v) = &video_out {
            args.extend(["-map".into(), format!("[{v}]")]);
            args.extend(["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p"].map(String::from));
        }
        match &audio_out {
            Some(a) => args.extend(["-map".into(), format!("[{a}]")]),
            None if !is_video => return Err("There's no sound to save: the clip and its layers are silent.".into()),
            None => args.push("-an".into()),
        }
        if audio_out.is_some() {
            let codec: &[&str] = match spec.container {
                Container::Mp3 => &["-c:a", "libmp3lame", "-b:a", "320k"],
                Container::Wav => &["-c:a", "pcm_s16le"],
                Container::Flac => &["-c:a", "flac"],
                _ => &["-c:a", "aac", "-b:a", "192k"],
            };
            args.extend(codec.iter().map(|s| s.to_string()));
        }
        // Layers may run past the clip; the clip's length decides the output's.
        args.extend(["-t".into(), secs(clip)]);
        phase = "encoding";
    }

    if spec.container == Container::Mp4 {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.push(output.to_string_lossy().into_owned());

    let _ = app.emit("job-event", progress_event(&spec.id, phase, Some(0.0)));
    let result = run_streaming(app, &spec.id, FFMPEG, args, |line| {
        let micros: f64 = line.strip_prefix("out_time_us=")?.trim().parse().ok()?;
        let percent = (micros / 1_000_000.0 / clip.max(0.1) * 100.0).clamp(0.0, 100.0);
        Some(progress_event(&spec.id, phase, Some(percent)))
    })
    .await;
    if result.is_err() {
        let _ = std::fs::remove_file(output);
    }
    result
}

fn progress_event(id: &str, phase: &'static str, percent: Option<f64>) -> JobEvent {
    JobEvent::Progress {
        id: id.to_string(),
        phase,
        percent,
        downloaded_bytes: None,
        total_bytes: None,
        speed_bps: None,
        eta_seconds: None,
    }
}

fn progress_from_fields(id: &str, fields: &str) -> JobEvent {
    // status|downloaded|total|total_estimate|speed|eta; yt-dlp writes "NA" for unknowns.
    let parts: Vec<&str> = fields.split('|').collect();
    let num = |i: usize| parts.get(i).and_then(|s| s.trim().parse::<f64>().ok());
    let downloaded = num(1);
    let total = num(2).or(num(3));
    let percent = match (downloaded, total) {
        (Some(d), Some(t)) if t > 0.0 => Some((d / t * 100.0).clamp(0.0, 100.0)),
        _ => None,
    };
    JobEvent::Progress {
        id: id.to_string(),
        phase: "downloading",
        percent,
        downloaded_bytes: downloaded,
        total_bytes: total,
        speed_bps: num(4),
        eta_seconds: num(5),
    }
}

/// Runs a sidecar, feeding each output line to `on_line` and emitting the events it returns.
async fn run_streaming(
    app: &AppHandle,
    id: &str,
    program: &str,
    args: Vec<String>,
    mut on_line: impl FnMut(&str) -> Option<JobEvent>,
) -> Result<(), String> {
    let jobs = app.state::<Jobs>();
    if jobs.is_cancelled(id) {
        return Err("Cancelled".into());
    }
    let (mut rx, child) = app
        .shell()
        .sidecar(program)
        .map_err(|e| format!("{program} is not bundled: {e}"))?
        .args(args)
        .spawn()
        .map_err(|e| format!("Couldn't start {program}: {e}"))?;
    if let Some(child) = jobs.attach(id, child) {
        let _ = child.kill();
        return Err("Cancelled".into());
    }

    let mut errors = String::new();
    let mut exit_code = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
                    if line.starts_with("ERROR:") || line.contains("Error") {
                        errors.push_str(line);
                        errors.push('\n');
                    }
                    if let Some(event) = on_line(line) {
                        let _ = app.emit("job-event", event);
                    }
                }
            }
            CommandEvent::Terminated(payload) => exit_code = payload.code,
            CommandEvent::Error(message) => errors.push_str(&message),
            _ => {}
        }
    }

    match exit_code {
        Some(0) => Ok(()),
        _ if jobs.is_cancelled(id) => Err("Cancelled".into()),
        _ => Err(last_error(&errors)
            .or_else(|| errors.lines().last().map(str::to_string))
            .unwrap_or_else(|| format!("{program} stopped unexpectedly."))),
    }
}
