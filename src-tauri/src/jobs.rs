//! Export jobs: shared plumbing (progress events, cancelling, yt-dlp downloads) and the
//! fast path for a single untouched cut. Whole timelines render in `project.rs`.

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

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
    /// A download stopped by `pause_job`: what it saved waits in its working folder.
    Paused {
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
    paused: bool,
}

impl Jobs {
    /// Starts tracking a job; false when a job with this id is already running.
    fn register(&self, id: &str) -> bool {
        let mut jobs = self.0.lock().unwrap();
        if jobs.contains_key(id) {
            return false;
        }
        jobs.insert(id.to_string(), Running::default());
        true
    }

    /// Keeps the running process so it can be killed. Returns the child back
    /// when the job was cancelled or paused before the process started.
    fn attach(&self, id: &str, child: CommandChild) -> Option<CommandChild> {
        let mut jobs = self.0.lock().unwrap();
        match jobs.get_mut(id) {
            Some(job) if !job.cancelled && !job.paused => {
                job.child = Some(child);
                None
            }
            _ => Some(child),
        }
    }

    pub(crate) fn is_cancelled(&self, id: &str) -> bool {
        self.0.lock().unwrap().get(id).is_none_or(|j| j.cancelled)
    }

    fn cancel(&self, id: &str) -> bool {
        let child = {
            let mut jobs = self.0.lock().unwrap();
            let Some(job) = jobs.get_mut(id) else { return false };
            job.cancelled = true;
            job.child.take()
        };
        if let Some(child) = child {
            kill_tree(child);
        }
        true
    }

    /// Asks a recording's FFmpeg to finish ("q"), so it closes its files and the job ends
    /// normally with what it saved. `cancel` instead throws the work away.
    pub(crate) fn stop(&self, id: &str) -> bool {
        let mut jobs = self.0.lock().unwrap();
        jobs.get_mut(id).and_then(|j| j.child.as_mut()).is_some_and(|child| child.write(b"q").is_ok())
    }

    /// Stops a download but keeps what it saved, to continue later (`pause_job`).
    fn pause(&self, id: &str) -> bool {
        let child = {
            let mut jobs = self.0.lock().unwrap();
            let Some(job) = jobs.get_mut(id) else { return false };
            job.paused = true;
            job.child.take()
        };
        if let Some(child) = child {
            kill_tree(child);
        }
        true
    }

    fn is_paused(&self, id: &str) -> bool {
        self.0.lock().unwrap().get(id).is_some_and(|j| j.paused)
    }

    /// Forgets the job; returns whether it had been cancelled, and whether paused.
    fn finish(&self, id: &str) -> (bool, bool) {
        self.0.lock().unwrap().remove(id).map_or((false, false), |j| (j.cancelled, j.paused))
    }
}

/// Stops a process and everything it started: yt-dlp runs FFmpeg itself, and killing only
/// yt-dlp would leave FFmpeg writing (and locking) files.
fn kill_tree(child: CommandChild) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &child.pid().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
}

/// Runs `work` in the background and reports how it ended as a `job-event`.
pub(crate) fn spawn_job(
    app: AppHandle,
    id: String,
    work: impl Future<Output = Result<PathBuf, String>> + Send + 'static,
) -> Result<(), String> {
    if !app.state::<Jobs>().register(&id) {
        return Err("This export is already running.".into());
    }
    tauri::async_runtime::spawn(async move {
        let result = work.await;
        let (cancelled, paused) = app.state::<Jobs>().finish(&id);
        let event = match result {
            _ if cancelled => JobEvent::Cancelled { id },
            _ if paused => JobEvent::Paused { id },
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
    spawn_job(app, spec.id.clone(), async move { run_simple(&task_app, &spec).await })
}

#[tauri::command]
pub fn cancel_job(jobs: State<'_, Jobs>, id: String) -> bool {
    jobs.cancel(&id)
}

/// Pauses a "download for editing"; starting it again with the same id continues it, even after
/// Craftora was closed.
#[tauri::command]
pub fn pause_job(jobs: State<'_, Jobs>, id: String) -> bool {
    jobs.pause(&id)
}

/// Throws away what a paused download saved (cancelling it from the queue).
#[tauri::command]
pub fn discard_download(app: AppHandle, id: String) -> Result<(), String> {
    let work = downloads_dir(&app)?.join(format!("{WORK_PREFIX}{}", safe_stem(&id)));
    match std::fs::remove_dir_all(&work) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Couldn't remove the paused download: {e}")),
        _ => Ok(()),
    }
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

/// A job's private working folder, `.craftora-<id>` in the export folder (the same drive,
/// so the finished file moves into place instantly). Removed when the job ends; leftovers
/// from a crash are removed at the next start (`clean_work_dirs`).
pub(crate) fn work_dir(dir: &Path, job_id: &str) -> Result<PathBuf, String> {
    let work = dir.join(format!("{WORK_PREFIX}{}", safe_stem(job_id)));
    std::fs::create_dir_all(&work).map_err(|e| format!("Couldn't create a working folder: {e}"))?;
    Ok(work)
}

const WORK_PREFIX: &str = ".craftora-";
/// In a paused download's working folder: keep it at startup (`clean_work_dirs`).
const PAUSED_MARK: &str = "paused";

/// Moves a finished file from the working folder into `dir` as `stem.ext`, or
/// `stem (2).ext`… if that's taken. The name is claimed only now, when the file is complete,
/// so two exports never share a name and nothing already in the folder is ever replaced.
pub(crate) fn deliver(finished: &Path, dir: &Path, stem: &str, ext: &str) -> Result<PathBuf, String> {
    for n in 1..10_000 {
        let path = if n == 1 { dir.join(format!("{stem}.{ext}")) } else { dir.join(format!("{stem} ({n}).{ext}")) };
        // create_new fails if the name exists, so this claims it atomically.
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(placeholder) => {
                drop(placeholder);
                let moved = std::fs::rename(finished, &path).or_else(|_| std::fs::copy(finished, &path).map(|_| ()));
                return match moved {
                    Ok(()) => Ok(path),
                    Err(e) => {
                        let _ = std::fs::remove_file(&path);
                        Err(format!("Couldn't save the file to {}: {e}", dir.display()))
                    }
                };
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Couldn't save the file to {}: {e}", dir.display())),
        }
    }
    Err("There are too many files with this name in the export folder.".into())
}

/// Removes working folders left behind when Craftora was closed during an export or a
/// download. Called at startup, when nothing can be running.
pub(crate) fn clean_work_dirs(app: &AppHandle) {
    for dir in [output_dir(app), downloads_dir(app)].into_iter().flatten() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let is_ours = entry.file_name().to_string_lossy().starts_with(WORK_PREFIX);
            let paused = entry.path().join(PAUSED_MARK).exists();
            if is_ours && !paused && entry.file_type().is_ok_and(|t| t.is_dir()) {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// `Videos\Craftora\Downloads`: whole links downloaded to edit like files on this PC.
pub(crate) fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .video_dir()
        .map_err(|e| format!("Couldn't find your Videos folder: {e}"))?
        .join("Craftora")
        .join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// A whole link to download before editing ("Download first").
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaDownload {
    id: String,
    url: String,
    /// yt-dlp format selector, as chosen for the picture (or the sound for audio-only links).
    format: String,
    title: String,
    #[serde(default)]
    audio_only: bool,
}

/// Downloads a whole link into the Downloads folder; the UI then opens it like a local file.
#[tauri::command]
pub async fn download_media(app: AppHandle, spec: MediaDownload) -> Result<(), String> {
    if !is_web_link(&spec.url) || spec.format.is_empty() {
        return Err("Only web links can be downloaded.".into());
    }
    let task_app = app.clone();
    spawn_job(app, spec.id.clone(), async move {
        let dir = downloads_dir(&task_app)?;
        // A paused download continues here: yt-dlp picks up the parts it already saved.
        let work = work_dir(&dir, &spec.id)?;
        let _ = std::fs::remove_file(work.join(PAUSED_MARK));
        let request = Download {
            url: &spec.url,
            format: &spec.format,
            section: None,
            precise: false,
            // MP4 (or M4A) plays in the preview without a preview copy.
            target: if spec.audio_only { DownloadTarget::Audio("m4a") } else { DownloadTarget::Video("mp4") },
        };
        let mut downloaded = download(&task_app, &spec.id, &request, &work, "download").await;
        // After a restart Craftora no longer knows the site checks for bots: learn it again, once.
        if let Err(e) = &downloaded
            && crate::media::is_bot_check(e)
            && crate::signin::note_bot_check(&spec.url)
        {
            downloaded = download(&task_app, &spec.id, &request, &work, "download").await;
        }
        let result = match downloaded {
            Ok(file) => {
                let ext = file.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_else(|| "mp4".into());
                deliver(&file, &dir, &safe_stem(&spec.title), &ext)
            }
            // Signed links (a pass in the address) stop working after a while.
            Err(e) if e.contains("401") => Err("This link has expired. Fetch its page again in Craftora to download it.".into()),
            Err(e) => Err(e),
        };
        if task_app.state::<Jobs>().is_paused(&spec.id) {
            let _ = std::fs::write(work.join(PAUSED_MARK), b"");
        } else {
            let _ = std::fs::remove_dir_all(&work);
        }
        result
    })
}

/// Formats seconds for FFmpeg and yt-dlp arguments.
pub(crate) fn secs(t: f64) -> String {
    format!("{t:.3}")
}

async fn run_simple(app: &AppHandle, spec: &JobSpec) -> Result<PathBuf, String> {
    let dir = output_dir(app)?;
    let work = work_dir(&dir, &spec.id)?;
    let result = run_simple_in(app, spec, &dir, &work).await;
    let _ = std::fs::remove_dir_all(&work);
    result
}

async fn run_simple_in(app: &AppHandle, spec: &JobSpec, dir: &Path, work: &Path) -> Result<PathBuf, String> {
    let ext = spec.container.ext();
    let stem = safe_stem(&spec.file_name);
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
        let temp = work.join(format!("output.{ext}"));
        args.push(temp.to_string_lossy().into_owned());
        let clip = if whole { spec.duration } else { spec.end - spec.start };
        run_ffmpeg(app, &spec.id, args, clip, "cutting", None).await?;
        return deliver(&temp, dir, &stem, ext);
    }

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
    let downloaded = download(app, &spec.id, &request, work, "download").await?;
    // yt-dlp picks the final extension (e.g. after merging or converting).
    let downloaded_ext = downloaded.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_else(|| ext.to_string());
    deliver(&downloaded, dir, &stem, &downloaded_ext)
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
            // Exact cuts re-encode the section. FFmpeg's default (slow x264 on the processor) took
            // about 3x longer than the encoder exports use, the graphics card when there is one.
            if !matches!(request.target, DownloadTarget::Audio(_)) {
                let encoder = crate::encoders::for_render(app, crate::encoders::Quality::Fast).await;
                args.extend(["--downloader-args".into(), format!("ffmpeg_o:{}", encoder.args(crate::encoders::Quality::Fast).join(" "))]);
            }
        }
        // yt-dlp hands sections to FFmpeg and reports nothing until the end, so the queue
        // sat at 0%. FFmpeg's own progress (out_time_us=…) is read below instead.
        args.extend(["--downloader-args".into(), "ffmpeg_i:-progress pipe:1 -nostats".into()]);
    }
    let section_length = request.section.map(|(start, end)| (end - start).max(0.1));
    match request.target {
        DownloadTarget::Video(ext) => {
            args.extend(["--merge-output-format".into(), ext.into(), "--remux-video".into(), ext.into()]);
        }
        DownloadTarget::Audio(ext) => args.extend(["-x".into(), "--audio-format".into(), ext.into()]),
        DownloadTarget::Any => args.extend(["--merge-output-format".into(), "mkv".into()]),
    }
    let (link, _cookie_file) = crate::signin::link_args(app, request.url).await;
    args.extend(link);

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
        if let (Some(length), Some(micros)) = (section_length, line.strip_prefix("out_time_us=")) {
            let seconds = micros.trim().parse::<f64>().ok()? / 1_000_000.0;
            return Some(progress_event(job_id, "downloading", Some((seconds / length * 100.0).clamp(0.0, 100.0))));
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
pub(crate) async fn run_streaming(
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
    let mut command = crate::engine::command(app, program)?.args(args);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deliver_never_replaces_an_existing_export() {
        let dir = std::env::temp_dir().join(format!("craftora-deliver-{}", std::process::id()));
        let work = dir.join(".craftora-job");
        std::fs::create_dir_all(&work).unwrap();
        std::fs::write(dir.join("clip.mp4"), b"earlier export").unwrap();

        for expected in ["clip (2).mp4", "clip (3).mp4"] {
            let finished = work.join("output.mp4");
            std::fs::write(&finished, b"new export").unwrap();
            let path = deliver(&finished, &dir, "clip", "mp4").unwrap();
            assert_eq!(path.file_name().unwrap(), expected);
            assert_eq!(std::fs::read(&path).unwrap(), b"new export");
            assert!(!finished.exists());
        }
        assert_eq!(std::fs::read(dir.join("clip.mp4")).unwrap(), b"earlier export");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
