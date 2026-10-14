//! Running export jobs: yt-dlp downloads the chosen section, then FFmpeg applies
//! mirror/reverse when asked. Progress streams to the UI as `job-event` events.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::engine::{last_error, sidecar_dir, FFMPEG, YT_DLP};
use crate::local::{normalize, OpenedFiles};

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
}

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
    let transform = spec.output == Output::Video && (spec.mirror || spec.reverse);

    if spec.local {
        return convert_local(app, spec, transform, &final_path).await.map(|_| final_path);
    }

    // Download straight to the final name, or to a temporary one when FFmpeg still has work.
    let download_stem = if transform { format!(".{stem}.craftora-tmp") } else {
        final_path.file_stem().unwrap().to_string_lossy().into_owned()
    };
    let downloaded = download(app, spec, &dir, &download_stem).await?;

    if !transform {
        return Ok(downloaded);
    }
    let result = apply_transforms(app, spec, &downloaded, &final_path).await;
    let _ = std::fs::remove_file(&downloaded);
    result.map(|_| final_path)
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

/// Stage 2: FFmpeg mirrors and/or reverses the downloaded clip.
async fn apply_transforms(app: &AppHandle, spec: &JobSpec, input: &Path, output: &Path) -> Result<(), String> {
    let mut filters = Vec::new();
    if spec.mirror {
        filters.push("hflip");
    }
    if spec.reverse {
        filters.push("reverse");
    }
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-nostats".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-vf".into(),
        filters.join(","),
    ];
    if spec.reverse {
        args.extend(["-af".into(), "areverse".into()]);
    }
    args.extend(
        ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k"].map(String::from),
    );
    if spec.container == Container::Mp4 {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.push(output.to_string_lossy().into_owned());

    let clip = (spec.end - spec.start).max(0.1);
    let _ = app.emit("job-event", progress_event(&spec.id, "encoding", Some(0.0)));
    run_streaming(app, &spec.id, FFMPEG, args, |line| {
        // `-progress` prints key=value lines; out_time_us is the position written so far.
        let micros: f64 = line.strip_prefix("out_time_us=")?.trim().parse().ok()?;
        let percent = (micros / 1_000_000.0 / clip * 100.0).clamp(0.0, 100.0);
        Some(progress_event(&spec.id, "encoding", Some(percent)))
    })
    .await
}

/// Files on this PC: one FFmpeg pass cuts, transforms and converts. No network needed.
async fn convert_local(app: &AppHandle, spec: &JobSpec, transform: bool, output: &Path) -> Result<(), String> {
    let whole = spec.start <= 0.05 && spec.end >= spec.duration - 0.05;
    let clip = if whole { spec.duration } else { spec.end - spec.start };

    let mut args: Vec<String> = ["-y", "-hide_banner", "-nostats", "-progress", "pipe:1"].map(String::from).to_vec();
    if !whole {
        // Seeking before -i is fast; with stream copy it lands on a keyframe, as Fast promises.
        args.extend(["-ss".into(), format!("{:.3}", spec.start)]);
    }
    args.extend(["-i".into(), spec.url.clone()]);
    if !whole {
        args.extend(["-t".into(), format!("{:.3}", clip)]);
    }

    let copy = match spec.output {
        Output::Video if !transform && spec.cut_mode == CutMode::Fast => {
            args.extend(["-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero"].map(String::from));
            true
        }
        Output::Video => {
            let mut filters = Vec::new();
            if spec.mirror {
                filters.push("hflip");
            }
            if spec.reverse {
                filters.push("reverse");
            }
            if !filters.is_empty() {
                args.extend(["-vf".into(), filters.join(",")]);
            }
            if spec.reverse {
                args.extend(["-af".into(), "areverse".into()]);
            }
            args.extend(
                ["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k"]
                    .map(String::from),
            );
            false
        }
        Output::Audio => {
            args.extend(["-vn".into(), "-map".into(), "0:a:0".into()]);
            let codec: &[&str] = match spec.container {
                Container::Mp3 => &["-c:a", "libmp3lame", "-b:a", "320k"],
                Container::Wav => &["-c:a", "pcm_s16le"],
                _ => &["-c:a", "flac"],
            };
            args.extend(codec.iter().map(|s| s.to_string()));
            false
        }
    };
    if spec.container == Container::Mp4 {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.push(output.to_string_lossy().into_owned());

    let phase = if copy { "cutting" } else { "encoding" };
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
