//! The bundled yt-dlp and FFmpeg sidecars: where they live and how to run them.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use std::process::Output;
use tauri_plugin_shell::{process::Command, ShellExt};

pub const YT_DLP: &str = "yt-dlp";
pub const FFMPEG: &str = "ffmpeg";
/// whisper.cpp's command-line tool (speech to text), bundled as the `whisper` resource folder.
pub const WHISPER: &str = "whisper";

/// The bundled FFmpeg: ffmpeg.exe and ffprobe.exe with the libraries they share, as the `ffmpeg`
/// resource folder (one copy of the libraries instead of one built into each, 127 MB less).
pub fn ffmpeg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().resource_dir().map_err(|e| e.to_string())?.join("ffmpeg"))
}

/// The command that runs an engine. yt-dlp is its unpacked build, bundled as the `yt-dlp`
/// resource folder: the one-file build unpacks itself on every run, and with the virus scanner
/// checking those files each time it took about 4 s to start (28 s on the first run), against
/// under 1 s unpacked. FFmpeg and FFprobe run from `ffmpeg_dir`.
pub fn command(app: &AppHandle, name: &str) -> Result<Command, String> {
    if name == YT_DLP {
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        let exe = resources.join("yt-dlp").join("yt-dlp.exe");
        if !exe.is_file() {
            return Err("yt-dlp is not bundled. Run scripts/fetch-sidecars.ps1, then restart Craftora.".into());
        }
        // YouTube's JavaScript challenges (signed-in fetches find no formats without them).
        let deno = resources.join("deno").join("deno.exe");
        let command = app.shell().command(exe);
        let command = if deno.is_file() { command.args(["--js-runtimes".to_string(), format!("deno:{}", deno.display())]) } else { command };
        // The proxy, for yt-dlp and for the FFmpeg it runs itself.
        return Ok(match crate::privacy::proxy() {
            Some(proxy) => command.args(["--proxy", &proxy]).env("http_proxy", &proxy).env("https_proxy", &proxy),
            None => command,
        });
    }
    if name == WHISPER {
        let exe = app.path().resource_dir().map_err(|e| e.to_string())?.join("whisper").join("whisper-cli.exe");
        if !exe.is_file() {
            return Err("whisper is not bundled. Run scripts/fetch-sidecars.ps1, then restart Craftora.".into());
        }
        return Ok(app.shell().command(exe));
    }
    let exe = ffmpeg_dir(app)?.join(format!("{name}.exe"));
    if !exe.is_file() {
        return Err(format!("{name} is not bundled. Run scripts/fetch-sidecars.ps1, then restart Craftora."));
    }
    let command = app.shell().command(exe);
    // FFmpeg and FFprobe read http_proxy for web addresses (https ones too, tunnelled through it).
    Ok(match crate::privacy::proxy() {
        Some(proxy) => command.env("http_proxy", proxy),
        None => command,
    })
}

/// Runs an engine to completion and collects its output.
pub async fn run_to_end(app: &AppHandle, name: &str, args: &[&str]) -> Result<Output, String> {
    let mut command: std::process::Command = command(app, name)?.args(args).into();
    command.stdin(std::process::Stdio::null());
    let child = command.spawn().map_err(|e| format!("Could not start {name}: {e}"))?;
    let tied = tie(child.id());
    let output = tauri::async_runtime::spawn_blocking(move || {
        let output = child.wait_with_output();
        drop(tied);
        output
    });
    output.await.map_err(|e| e.to_string())?.map_err(|e| format!("Could not start {name}: {e}"))
}

/// Keeps a started engine, and whatever it starts (yt-dlp runs FFmpeg), from outliving Craftora:
/// Windows ends them when this is dropped or when Craftora closes, even by a crash. Without it
/// they kept downloading and encoding in the background after the window was closed.
#[cfg(windows)]
pub(crate) struct Tied(windows_sys::Win32::Foundation::HANDLE);

// SAFETY: a job object handle can be used and closed from any thread.
#[cfg(windows)]
unsafe impl Send for Tied {}

#[cfg(windows)]
impl Drop for Tied {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: the handle is ours and closed once.
            unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
        }
    }
}

/// Puts the process `pid` in a job of its own that ends everything in it when the job is closed.
/// One job each: a single shared one could fail when Craftora itself runs inside a job (MSIX).
#[cfg(windows)]
pub(crate) fn tie(pid: u32) -> Tied {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        },
    };
    // SAFETY: plain Win32 calls on handles created here; `info` outlives the call that reads it.
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Tied(job);
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = std::mem::size_of_val(&info) as u32;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, (&raw const info).cast(), size);
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if !process.is_null() {
            AssignProcessToJobObject(job, process);
            CloseHandle(process);
        }
        Tied(job)
    }
}

#[cfg(not(windows))]
pub(crate) fn tie(_pid: u32) {}

/// The last `ERROR:` line yt-dlp printed, without the prefix, as a user-facing message.
pub fn last_error(stderr: &str) -> Option<String> {
    stderr
        .lines()
        .rev()
        .find_map(|l| l.trim().strip_prefix("ERROR:").map(|m| m.trim().to_string()))
}

/// Updates the bundled yt-dlp to its newest release (sites change often, and old versions stop
/// working on them). Returns yt-dlp's own one-line answer, e.g. "Updated yt-dlp to stable@…".
#[tauri::command]
pub async fn update_yt_dlp(app: AppHandle) -> Result<String, String> {
    let output = run_to_end(&app, YT_DLP, &["-U"]).await?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(last_error(&stderr).unwrap_or_else(|| "yt-dlp couldn't update itself.".into()));
    }
    Ok(stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("yt-dlp is up to date.").trim().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    yt_dlp: Option<String>,
    ffmpeg: Option<String>,
}

/// Versions of the bundled engines, or `None` for an engine that is missing or broken.
#[tauri::command]
pub async fn engine_status(app: AppHandle) -> EngineStatus {
    let yt_dlp = run_to_end(&app, YT_DLP, &["--version"])
        .await
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    // First line looks like "ffmpeg version n9.0-12-gabc123-20261013 Copyright ...".
    let ffmpeg = run_to_end(&app, FFMPEG, &["-version"])
        .await
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            let version = text.lines().next()?.split_whitespace().nth(2)?;
            Some(version.split('-').next().unwrap_or(version).trim_start_matches('n').to_string())
        });

    EngineStatus { yt_dlp, ffmpeg }
}
