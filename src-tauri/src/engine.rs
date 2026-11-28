//! The bundled yt-dlp and FFmpeg sidecars: where they live and how to run them.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{process::Command, ShellExt};

const YT_DLP_RELEASES: &str = "https://github.com/yt-dlp/yt-dlp/releases";
const MAX_ZIP_BYTES: u64 = 100 * 1024 * 1024;
const CHECK_INTERVAL: Duration = Duration::from_secs(7 * 24 * 60 * 60);

static UPDATING: AtomicBool = AtomicBool::new(false);

pub const YT_DLP: &str = "yt-dlp";
pub const FFMPEG: &str = "ffmpeg";
/// whisper.cpp's command-line tool (speech to text), bundled as the `whisper` resource folder.
pub const WHISPER: &str = "whisper";
/// Craftora's own fetch engine, for links yt-dlp can't read (bundled as the `craftora-observer`
/// resource folder). It takes yt-dlp's arguments and answers like `--dump-single-json`.
pub const OBSERVER: &str = "craftora-observer";

/// The bundled FFmpeg: ffmpeg.exe and ffprobe.exe with the libraries they share, as the `ffmpeg`
/// resource folder (one copy of the libraries instead of one built into each, 127 MB less).
pub fn ffmpeg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().resource_dir().map_err(|e| e.to_string())?.join("ffmpeg"))
}

/// Folder in local app data where Craftora keeps self-updated unpacked yt-dlp builds.
fn yt_dlp_home(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join("yt-dlp"))
}

/// Parses a dotted numeric version like "2026.11.23" or "2026.11.23.123456" for ordering.
fn version_parts(v: &str) -> Option<Vec<u32>> {
    let v = v.trim();
    if v.is_empty() {
        return None;
    }
    v.split('.')
        .map(|part| {
            if !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()) {
                part.parse::<u32>().ok()
            } else {
                None
            }
        })
        .collect()
}

/// Highest-version unpacked yt-dlp folder under `home` that has a `yt-dlp.exe` file.
fn newest_in(home: &Path) -> Option<(Vec<u32>, PathBuf)> {
    std::fs::read_dir(home)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            if name.ends_with(".part") {
                return None;
            }
            let version = version_parts(name)?;
            let exe = entry.path().join("yt-dlp.exe");
            exe.is_file().then_some((version, exe))
        })
        .max_by(|(a, _), (b, _)| a.cmp(b))
}

/// The newest self-updated yt-dlp copy in local app data, if one is installed.
fn updated_yt_dlp(app: &AppHandle) -> Option<(Vec<u32>, PathBuf)> {
    newest_in(&yt_dlp_home(app)?)
}

/// The command that runs an engine. yt-dlp is its unpacked build, bundled as the `yt-dlp`
/// resource folder (or a newer unpacked self-update in local app data): the one-file build
/// unpacks itself on every run, and with the virus scanner checking those files each time it
/// took about 4 s to start (28 s on the first run), against under 1 s unpacked. FFmpeg and
/// FFprobe run from `ffmpeg_dir`.
pub fn command(app: &AppHandle, name: &str) -> Result<Command, String> {
    if name == YT_DLP {
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        let exe = match updated_yt_dlp(app) {
            Some((_, exe)) => exe,
            None => {
                let bundled = resources.join("yt-dlp").join("yt-dlp.exe");
                if !bundled.is_file() {
                    return Err("yt-dlp is not bundled. Run scripts/fetch-sidecars.ps1, then restart Craftora.".into());
                }
                bundled
            }
        };
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
    if name == OBSERVER {
        let exe = app.path().resource_dir().map_err(|e| e.to_string())?.join(OBSERVER).join("craftora-observer.exe");
        if !exe.is_file() {
            return Err("The fetch engine is not bundled.".into());
        }
        let command = app.shell().command(exe);
        return Ok(match crate::privacy::proxy() {
            Some(proxy) => command.args(["--proxy", &proxy]),
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
    // Held here, not in the waiting thread: a caller that stops waiting (Cancel) ends the program too.
    let _tied = tie(child.id());
    let output = tauri::async_runtime::spawn_blocking(move || child.wait_with_output());
    output.await.map_err(|e| e.to_string())?.map_err(|e| format!("Could not start {name}: {e}"))
}

/// Runs yt-dlp and Deno once, a moment after start-up, so the virus scanner checks their files then and not on
/// the first fetch after an install or update (fresh files: first fetch 5.4 s without this, 4.0 s with it).
/// Also drops self-updated copies that an app update superseded, and checks for a new release once a week.
pub async fn warm_up(app: &AppHandle) {
    tokio::time::sleep(Duration::from_secs(3)).await;
    let _ = run_to_end(app, YT_DLP, &["--version"]).await;
    if let Ok(dir) = app.path().resource_dir() {
        let deno = dir.join("deno").join("deno.exe");
        if deno.is_file() {
            let mut command: std::process::Command = app.shell().command(deno).args(["--version"]).into();
            command.stdin(std::process::Stdio::null());
            let _ = tauri::async_runtime::spawn_blocking(move || command.output()).await;
        }
    }
    let Some(home) = yt_dlp_home(app) else { return };
    let has_versions = std::fs::read_dir(&home).ok().is_some_and(|entries| {
        entries
            .filter_map(Result::ok)
            .any(|e| e.file_name().to_str().and_then(version_parts).is_some())
    });
    if has_versions && let Ok((bundled_parts, _)) = bundled_yt_dlp_version(app).await {
        drop_old_versions(&home, &bundled_parts, true);
    }
    let checked = home.join("checked");
    let due = std::fs::metadata(&checked)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|mtime| mtime.elapsed().ok())
        .map_or(true, |age| age > CHECK_INTERVAL);
    if due && install_latest(app).await.is_ok() {
        let _ = std::fs::create_dir_all(&home);
        if let Err(e) = std::fs::write(&checked, b"") {
            crate::diag::note(format!("yt-dlp update: couldn't record check time: {e}"));
        }
    }
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

/// GitHub releases redirect to `.githubusercontent.com` CDNs; nothing else is followed.
fn allowed_download_host(host: &str) -> bool {
    host == "github.com" || host.ends_with(".githubusercontent.com")
}

/// Finds the SHA-256 hex digest for `yt-dlp_win.zip` in yt-dlp's `SHA2-256SUMS` file.
fn expected_sha256(sums: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        if name == "yt-dlp_win.zip" && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            Some(hash.to_ascii_lowercase())
        } else {
            None
        }
    })
}

/// Best-effort removal of versioned yt-dlp folders older than (or matching, when `or_equal`) `cutoff`.
fn drop_old_versions(home: &Path, cutoff: &[u32], or_equal: bool) {
    let Ok(entries) = std::fs::read_dir(home) else { return };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        if let Some(parts) = name.to_str().and_then(version_parts)
            && (parts.as_slice() < cutoff || (or_equal && parts.as_slice() == cutoff))
        {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Runs the bundled yt-dlp directly (never through `command()`) so we can tell its own version.
async fn bundled_yt_dlp_version(app: &AppHandle) -> Result<(Vec<u32>, String), String> {
    let exe = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("yt-dlp")
        .join("yt-dlp.exe");
    if !exe.is_file() {
        return Err("yt-dlp is not bundled. Run scripts/fetch-sidecars.ps1, then restart Craftora.".into());
    }
    let mut command: std::process::Command = app.shell().command(exe).args(["--version"]).into();
    command.stdin(std::process::Stdio::null());
    let output = tauri::async_runtime::spawn_blocking(move || command.output())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Could not start yt-dlp: {e}"))?;
    if !output.status.success() {
        return Err("Couldn't check the bundled yt-dlp version.".into());
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts = version_parts(&text).ok_or_else(|| format!("Unexpected yt-dlp version: {text}"))?;
    Ok((parts, text))
}

struct UpdatingGuard;

impl Drop for UpdatingGuard {
    fn drop(&mut self) {
        UPDATING.store(false, Ordering::SeqCst);
    }
}

struct TempCleanup {
    zip: PathBuf,
    part: Option<PathBuf>,
}

impl Drop for TempCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.zip);
        if let Some(part) = &self.part {
            let _ = std::fs::remove_dir_all(part);
        }
    }
}

/// Downloads yt-dlp's latest unpacked Windows build (`yt-dlp_win.zip`) into local app data,
/// keeping the fast 0.7 s startup and avoiding the read-only resource folder in Store installs.
async fn install_latest(app: &AppHandle) -> Result<String, String> {
    if UPDATING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        let msg = "yt-dlp is already updating.".to_string();
        crate::diag::note(format!("yt-dlp update: {msg}"));
        return Err(msg);
    }
    let _guard = UpdatingGuard;
    let res = install_latest_inner(app).await;
    if let Err(ref e) = res {
        crate::diag::note(format!("yt-dlp update: {e}"));
    }
    res
}

async fn install_latest_inner(app: &AppHandle) -> Result<String, String> {
    let probe = crate::privacy::client_builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let resp = probe
        .get(format!("{YT_DLP_RELEASES}/latest"))
        .send()
        .await
        .map_err(|e| format!("Couldn't check for yt-dlp updates: {e}"))?;
    let status = resp.status();
    let location = resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("Couldn't check for yt-dlp updates (server answered {status})."))?;
    let latest_str = location
        .rsplit_once("/tag/")
        .and_then(|(_, tag)| tag.split(['/', '?', '#']).next())
        .map(str::trim)
        .filter(|tag| version_parts(tag).is_some())
        .ok_or_else(|| "Couldn't read the newest yt-dlp version.".to_string())?
        .to_string();
    let latest_parts = version_parts(&latest_str).expect("validated above");

    let (current_parts, current_str) = match updated_yt_dlp(app) {
        Some((parts, exe)) => {
            let name = exe.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()).unwrap_or("").to_string();
            (parts, name)
        }
        None => bundled_yt_dlp_version(app).await?,
    };
    if latest_parts <= current_parts {
        return Ok(format!("yt-dlp is up to date ({current_str})."));
    }

    let client = crate::privacy::client_builder()
        .connect_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5
                && attempt.url().scheme() == "https"
                && attempt.url().host_str().is_some_and(allowed_download_host)
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;

    let base = format!("{YT_DLP_RELEASES}/download/{latest_str}");
    let sums_resp = client
        .get(format!("{base}/SHA2-256SUMS"))
        .send()
        .await
        .map_err(|e| format!("Couldn't download the yt-dlp checksums: {e}"))?;
    if !sums_resp.status().is_success() {
        return Err(format!("Couldn't download the yt-dlp checksums (server answered {}).", sums_resp.status()));
    }
    let sums_text = sums_resp.text().await.map_err(|e| format!("Couldn't read the yt-dlp checksums: {e}"))?;
    let expected = expected_sha256(&sums_text).ok_or_else(|| "Couldn't find the yt-dlp checksum.".to_string())?;

    let mut zip_resp = client
        .get(format!("{base}/yt-dlp_win.zip"))
        .send()
        .await
        .map_err(|e| format!("Couldn't download yt-dlp: {e}"))?;
    if !zip_resp.status().is_success() {
        return Err(format!("Couldn't download yt-dlp (server answered {}).", zip_resp.status()));
    }
    if zip_resp.content_length().is_some_and(|len| len > MAX_ZIP_BYTES) {
        return Err("The yt-dlp update was over 100 MB.".into());
    }

    let home = yt_dlp_home(app).ok_or_else(|| "Couldn't find Craftora's local data folder.".to_string())?;
    std::fs::create_dir_all(&home).map_err(|e| format!("Couldn't make the yt-dlp folder: {e}"))?;
    let zip_path = home.join(format!("{latest_str}.zip"));
    let part_dir = home.join(format!("{latest_str}.part"));
    let final_dir = home.join(&latest_str);
    let _ = std::fs::remove_dir_all(&part_dir);
    let mut cleanup = TempCleanup { zip: zip_path.clone(), part: Some(part_dir.clone()) };

    let mut file = std::fs::File::create(&zip_path).map_err(|e| format!("Couldn't save the yt-dlp update: {e}"))?;
    let (mut done, mut hash) = (0u64, Sha256::new());
    while let Some(chunk) = zip_resp.chunk().await.map_err(|e| format!("yt-dlp stopped downloading: {e}"))? {
        done += chunk.len() as u64;
        if done > MAX_ZIP_BYTES {
            return Err("The yt-dlp update was over 100 MB.".into());
        }
        file.write_all(&chunk).map_err(|e| format!("Couldn't save the yt-dlp update: {e}"))?;
        hash.update(&chunk);
    }
    drop(file);

    if format!("{:x}", hash.finalize()) != expected {
        return Err("The yt-dlp update didn't download properly. Try again.".into());
    }

    std::fs::create_dir_all(&part_dir).map_err(|e| format!("Couldn't prepare the yt-dlp folder: {e}"))?;
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let tar = PathBuf::from(system_root).join("System32").join("tar.exe");
    let zip_arg = zip_path.to_string_lossy().into_owned();
    let part_arg = part_dir.to_string_lossy().into_owned();
    // Spawn through shell().command like deno in warm_up so no console window flashes.
    let mut command: std::process::Command = app.shell().command(tar).args(["-xf", &zip_arg, "-C", &part_arg]).into();
    command.stdin(std::process::Stdio::null());
    let output = tauri::async_runtime::spawn_blocking(move || command.output())
        .await
        .map_err(|e| format!("Couldn't unpack the yt-dlp update: {e}"))?
        .map_err(|e| format!("Couldn't unpack the yt-dlp update: {e}"))?;
    if !output.status.success() {
        return Err("Couldn't unpack the yt-dlp update.".into());
    }
    if !part_dir.join("yt-dlp.exe").is_file() {
        return Err("The yt-dlp update didn't contain yt-dlp.exe.".into());
    }

    if final_dir.exists() {
        let _ = std::fs::remove_dir_all(&final_dir);
    }
    std::fs::rename(&part_dir, &final_dir).map_err(|e| format!("Couldn't install the yt-dlp update: {e}"))?;
    cleanup.part = None;
    drop(cleanup);

    drop_old_versions(&home, &latest_parts, false);
    Ok(format!("Updated yt-dlp to {latest_str}."))
}

/// Updates yt-dlp to its newest unpacked release (sites change often, and old versions stop
/// working on them). Returns a one-line status message, e.g. "Updated yt-dlp to 2026.11.23.".
#[tauri::command]
pub async fn update_yt_dlp(app: AppHandle) -> Result<String, String> {
    install_latest(&app).await
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

#[cfg(test)]
mod tests {
    use super::{allowed_download_host, expected_sha256, newest_in, version_parts};

    #[cfg(windows)]
    #[test]
    fn dropping_the_tie_ends_the_process() {
        let mut child = std::process::Command::new("ping").args(["-n", "30", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
        let tied = super::tie(child.id());
        assert!(child.try_wait().unwrap().is_none());
        drop(tied);
        std::thread::sleep(std::time::Duration::from_millis(500));
        assert!(child.try_wait().unwrap().is_some(), "still running after its job was closed");
    }

    #[test]
    fn parses_and_orders_yt_dlp_versions() {
        assert!(version_parts("2026.11.23").unwrap() > version_parts("2026.10.26").unwrap());
        assert!(version_parts("2026.11.23.1").unwrap() > version_parts("2026.11.23").unwrap());
        assert_eq!(version_parts("2026.11.23.123456"), Some(vec![2026, 11, 23, 123456]));
        assert_eq!(version_parts("abc"), None);
        assert_eq!(version_parts(""), None);
        assert_eq!(version_parts("2026.11."), None);
        assert_eq!(version_parts("+2026.11.23"), None);
    }

    #[test]
    fn picks_newest_valid_folder_ignoring_incomplete_and_part_dirs() {
        let dir = std::env::temp_dir().join(format!("craftora-ytdlp-newest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(newest_in(&dir), None);

        // Ignored: .part folder, missing yt-dlp.exe, non-version name, plain file.
        for folder in ["2026.12.05.part", "2026.12.04", "latest"] {
            std::fs::create_dir_all(dir.join(folder)).unwrap();
        }
        std::fs::write(dir.join("2026.12.05.part").join("yt-dlp.exe"), b"x").unwrap();
        std::fs::write(dir.join("latest").join("yt-dlp.exe"), b"x").unwrap();
        std::fs::write(dir.join("checked"), b"").unwrap();

        for ver in ["2026.10.26", "2026.11.23", "2026.11.23.1"] {
            let folder = dir.join(ver);
            std::fs::create_dir_all(&folder).unwrap();
            std::fs::write(folder.join("yt-dlp.exe"), b"x").unwrap();
        }

        let picked = newest_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(picked, Some((vec![2026, 11, 23, 1], dir.join("2026.11.23.1").join("yt-dlp.exe"))));
    }

    #[test]
    fn verifies_github_hosts_and_checksum_lines() {
        assert!(allowed_download_host("github.com"));
        assert!(allowed_download_host("objects.githubusercontent.com"));
        assert!(!allowed_download_host("evilgithub.com"));
        assert!(!allowed_download_host("githubusercontent.com.evil.com"));

        let sum = "A".repeat(64);
        let text = format!("{0}  yt-dlp.exe\n{sum}  yt-dlp_win.zip\n", "b".repeat(64));
        assert_eq!(expected_sha256(&text), Some("a".repeat(64)));
        assert_eq!(expected_sha256("short  yt-dlp_win.zip"), None);
    }
}
