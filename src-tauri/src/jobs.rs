//! Export jobs: shared plumbing (progress events, cancelling, yt-dlp downloads) and the
//! fast path for a single untouched cut. Whole timelines render in `project.rs`.

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::engine::{last_error, sidecar_dir, FFMPEG, YT_DLP};
use crate::local::{normalize, OpenedFiles};

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Output {
    Video,
    Audio,
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Container {
    Mp4,
    Mkv,
    Mp3,
    Wav,
    Flac,
}

impl Container {
    pub(crate) fn ext(self) -> &'static str {
        match self {
            Container::Mp4 => "mp4",
            Container::Mkv => "mkv",
            Container::Mp3 => "mp3",
            Container::Wav => "wav",
            Container::Flac => "flac",
        }
    }
    pub(crate) fn is_video(self) -> bool {
        matches!(self, Container::Mp4 | Container::Mkv)
    }
}

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum CutMode {
    Fast,
    Precise,
}

/// A single untouched cut: one source, no edits. yt-dlp downloads just the section
/// (links), or FFmpeg copies it without re-encoding (files on this PC).
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
    file_name: String,
    /// `url` is a file on this PC (opened via `open_local`).
    #[serde(default)]
    local: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub(crate) enum JobEvent {
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

/// Runs `work` in the background and reports how it ended as a `job-event`.
pub(crate) fn spawn_job(app: AppHandle, id: String, work: impl Future<Output = Result<PathBuf, String>> + Send + 'static) {
    app.state::<Jobs>().register(&id);
    tauri::async_runtime::spawn(async move {
        let result = work.await;
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
}

/// Starts a single untouched cut; progress arrives as `job-event` events.
#[tauri::command]
pub async fn start_job(app: AppHandle, spec: JobSpec) -> Result<(), String> {
    if spec.end <= spec.start || spec.start < 0.0 {
        return Err("The clip range is empty.".into());
    }
    if (spec.output == Output::Video) != spec.container.is_video() {
        return Err("That file type doesn't match the output.".into());
    }
    if spec.local {
        if spec.output != Output::Video || spec.cut_mode != CutMode::Fast {
            return Err("Files on this PC are re-encoded by the timeline renderer.".into());
        }
        let opened = app.state::<OpenedFiles>();
        if !normalize(Path::new(&spec.url)).is_ok_and(|p| opened.contains(&p)) {
            return Err("Open the file again; Craftora only works on files you've opened.".into());
        }
    } else if !is_web_link(&spec.url) {
        return Err("Only web links can be downloaded.".into());
    }
    let task_app = app.clone();
    spawn_job(app, spec.id.clone(), async move { run_simple(&task_app, &spec).await });
    Ok(())
}

#[tauri::command]
pub fn cancel_job(jobs: State<'_, Jobs>, id: String) -> bool {
    jobs.cancel(&id)
}

pub(crate) fn is_web_link(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

/// The save folder the user chose, or `Videos\Craftora` (created on first use).
pub(crate) fn output_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = crate::store::chosen_output_dir(app) {
        return Ok(dir);
    }
    let dir = app
        .path()
        .video_dir()
        .map_err(|e| format!("Couldn't find your Videos folder: {e}"))?
        .join("Craftora");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// A safe file stem: letters, digits, `-` and `_` only, never empty.
pub(crate) fn safe_stem(name: &str) -> String {
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let clean: String = stem
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(80)
        .collect();
    if clean.is_empty() { "clip".into() } else { clean }
}

/// First free `stem.ext`, `stem (2).ext`, … in `dir`.
pub(crate) fn free_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    path
}

/// Formats seconds for FFmpeg and yt-dlp arguments.
pub(crate) fn secs(t: f64) -> String {
    format!("{t:.3}")
}

async fn run_simple(app: &AppHandle, spec: &JobSpec) -> Result<PathBuf, String> {
    let dir = output_dir(app)?;
    let ext = spec.container.ext();
    let final_path = free_path(&dir, &safe_stem(&spec.file_name), ext);
    let whole = spec.start <= 0.05 && spec.end >= spec.duration - 0.05;

    if spec.local {
        // Stream copy: instant and lossless; the start lands on a keyframe.
        let mut args: Vec<String> = ["-y", "-hide_banner", "-nostats", "-progress", "pipe:1"].map(String::from).to_vec();
        if !whole {
            args.extend(["-ss".into(), secs(spec.start), "-t".into(), secs(spec.end - spec.start)]);
        }
        args.extend(["-i".into(), spec.url.clone()]);
        args.extend(["-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero"].map(String::from));
        if spec.container == Container::Mp4 {
            args.extend(["-movflags".into(), "+faststart".into()]);
        }
        args.push(final_path.to_string_lossy().into_owned());
        let clip = if whole { spec.duration } else { spec.end - spec.start };
        let result = run_ffmpeg(app, &spec.id, args, clip, "cutting", None).await;
        if result.is_err() {
            let _ = std::fs::remove_file(&final_path);
        }
        return result.map(|_| final_path);
    }

    let stem = final_path.file_stem().unwrap().to_string_lossy().into_owned();
    let request = Download {
        url: &spec.url,
        format: &spec.format,
        section: (!whole).then_some((spec.start, spec.end)),
        precise: spec.cut_mode == CutMode::Precise,
        target: match spec.output {
            Output::Video => DownloadTarget::Video(ext),
            Output::Audio => DownloadTarget::Audio(ext),
        },
    };
    download(app, &spec.id, &request, &dir, &stem).await
}

pub(crate) enum DownloadTarget<'a> {
    /// Merge picture and sound into this container.
    Video(&'a str),
    /// Extract the sound and convert it to this format.
    Audio(&'a str),
    /// Keep whatever the source provides (for further processing).
    Any,
}

pub(crate) struct Download<'a> {
    pub url: &'a str,
    pub format: &'a str,
    /// Only this part of the source, in seconds.
    pub section: Option<(f64, f64)>,
    /// Re-encode at the cut points so the section starts exactly where asked.
    pub precise: bool,
    pub target: DownloadTarget<'a>,
}

/// yt-dlp downloads (only the requested section of) a link into `dir/stem.<ext>`.
pub(crate) async fn download(app: &AppHandle, job_id: &str, request: &Download<'_>, dir: &Path, stem: &str) -> Result<PathBuf, String> {
    let engines = sidecar_dir()?;
    let template = dir.join(format!("{stem}.%(ext)s"));

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
        request.format.to_string(),
        "--progress-template".into(),
        "download:CRAFTORA|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s".into(),
        "--print".into(),
        "after_move:CRAFTORA_FILE|%(filepath)s".into(),
        "-o".into(),
        template.to_string_lossy().into_owned(),
    ];
    if let Some((start, end)) = request.section {
        args.push("--download-sections".into());
        args.push(format!("*{start:.2}-{end:.2}"));
        if request.precise {
            args.push("--force-keyframes-at-cuts".into());
        }
    }
    match request.target {
        DownloadTarget::Video(ext) => {
            args.extend(["--merge-output-format".into(), ext.into(), "--remux-video".into(), ext.into()]);
        }
        DownloadTarget::Audio(ext) => args.extend(["-x".into(), "--audio-format".into(), ext.into()]),
        DownloadTarget::Any => args.extend(["--merge-output-format".into(), "mkv".into()]),
    }
    args.push("--".into());
    args.push(request.url.to_string());

    let mut final_file: Option<PathBuf> = None;
    let mut phase = "downloading";
    run_streaming(app, job_id, YT_DLP, args, None, |line| {
        if let Some(path) = line.strip_prefix("CRAFTORA_FILE|") {
            final_file = Some(PathBuf::from(path.trim()));
            return None;
        }
        if let Some(fields) = line.strip_prefix("CRAFTORA|") {
            return Some(progress_from_fields(job_id, fields));
        }
        // yt-dlp's post-processors announce themselves like "[Merger] Merging formats…".
        let post = ["[Merger]", "[ExtractAudio]", "[VideoRemuxer]", "[VideoConvertor]", "[FixupM3u8]", "[ModifyChapters]"];
        if phase == "downloading" && post.iter().any(|p| line.starts_with(p)) {
            phase = "processing";
            return Some(progress_event(job_id, "processing", None));
        }
        None
    })
    .await?;

    final_file
        .filter(|p| p.exists())
        .ok_or_else(|| "yt-dlp finished but the file wasn't found.".into())
}

/// Runs FFmpeg with `-progress pipe:1`, reporting progress against `length` seconds of output.
pub(crate) async fn run_ffmpeg(
    app: &AppHandle,
    job_id: &str,
    args: Vec<String>,
    length: f64,
    phase: &'static str,
    cwd: Option<&Path>,
) -> Result<(), String> {
    let _ = app.emit("job-event", progress_event(job_id, phase, Some(0.0)));
    run_streaming(app, job_id, FFMPEG, args, cwd, |line| {
        // `-progress` prints key=value lines; out_time_us is the position written so far.
        let micros: f64 = line.strip_prefix("out_time_us=")?.trim().parse().ok()?;
        let percent = (micros / 1_000_000.0 / length.max(0.1) * 100.0).clamp(0.0, 100.0);
        Some(progress_event(job_id, phase, Some(percent)))
    })
    .await
}

pub(crate) fn progress_event(id: &str, phase: &'static str, percent: Option<f64>) -> JobEvent {
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
    cwd: Option<&Path>,
    mut on_line: impl FnMut(&str) -> Option<JobEvent>,
) -> Result<(), String> {
    let jobs = app.state::<Jobs>();
    if jobs.is_cancelled(id) {
        return Err("Cancelled".into());
    }
    let mut command = app
        .shell()
        .sidecar(program)
        .map_err(|e| format!("{program} is not bundled: {e}"))?
        .args(args);
    if let Some(dir) = cwd {
        command = command.current_dir(dir);
    }
    let (mut rx, child) = command.spawn().map_err(|e| format!("Couldn't start {program}: {e}"))?;
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
