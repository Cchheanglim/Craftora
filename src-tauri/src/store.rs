//! What Craftora keeps between runs, as JSON files in the app's data folder
//! (`%APPDATA%\com.cchheanglim.craftora`): one file per project, the export history, and
//! settings such as the save folder.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Larger than any real project; stops a runaway write from filling the disk.
const MAX_FILE_BYTES: usize = 20_000_000;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("Couldn't find the app data folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("projects");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Project ids become file names, so only letters, digits and `-` are allowed.
fn project_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let valid = (1..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err("Invalid project id.".into());
    }
    Ok(projects_dir(app)?.join(format!("{id}.json")))
}

/// Writes through a temporary file, so a crash mid-save never leaves half a file.
fn write_json(path: &Path, contents: &str) -> Result<(), String> {
    if contents.len() > MAX_FILE_BYTES {
        return Err("That's too much to save.".into());
    }
    serde_json::from_str::<serde_json::Value>(contents).map_err(|e| format!("Not valid JSON: {e}"))?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("Couldn't save: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Couldn't save: {e}"))
}

fn read_text(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Couldn't read {}: {e}", path.display())),
    }
}

/// The part of a saved project file the project list needs (the UI writes these fields).
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    /// Milliseconds since 1970.
    #[serde(default)]
    saved_at: f64,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    clips: u32,
    /// A small picture of the project's first video (a link's picture or a JPEG data URL).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thumbnail: Option<String>,
    /// Made in the Image editor.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    image: bool,
}

/// Saved projects, most recently saved first.
#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<ProjectEntry>, String> {
    let dir = projects_dir(&app)?;
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Couldn't list projects: {e}"))?;
    let mut projects: Vec<ProjectEntry> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .filter_map(|path| {
            let text = std::fs::read_to_string(&path).ok()?;
            let mut entry: ProjectEntry = serde_json::from_str(&text).ok()?;
            entry.id = path.file_stem()?.to_string_lossy().into_owned();
            Some(entry)
        })
        .collect();
    projects.sort_by(|a, b| b.saved_at.total_cmp(&a.saved_at));
    Ok(projects)
}

#[tauri::command]
pub fn load_project(app: AppHandle, id: String) -> Result<String, String> {
    read_text(&project_path(&app, &id)?)?.ok_or_else(|| "That project isn't there any more.".into())
}

#[tauri::command]
pub fn save_project(app: AppHandle, id: String, contents: String) -> Result<(), String> {
    write_json(&project_path(&app, &id)?, &contents)
}

#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    match std::fs::remove_file(project_path(&app, &id)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Couldn't delete the project: {e}")),
        _ => Ok(()),
    }
}

/// Finished exports, as the UI wrote them; `[]` before the first one.
#[tauri::command]
pub fn load_history(app: AppHandle) -> Result<String, String> {
    Ok(read_text(&data_dir(&app)?.join("history.json"))?.unwrap_or_else(|| "[]".into()))
}

#[tauri::command]
pub fn save_history(app: AppHandle, contents: String) -> Result<(), String> {
    write_json(&data_dir(&app)?.join("history.json"), &contents)
}

/// Every saved project file (and `history.json`), to check which files in `sources` are still used;
/// `None` if the folder or any file in it couldn't be read, so nothing is deleted on a guess.
pub(crate) fn project_texts(app: &AppHandle) -> Option<Vec<String>> {
    let mut texts = Vec::new();
    for entry in std::fs::read_dir(projects_dir(app).ok()?).ok()? {
        let entry = entry.ok()?;
        if entry.file_type().ok()?.is_file() {
            texts.push(std::fs::read_to_string(entry.path()).ok()?);
        }
    }
    if let Some(history) = read_text(&data_dir(app).ok()?.join("history.json")).ok()? {
        texts.push(history);
    }
    Some(texts)
}

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Settings {
    /// Where exports are saved; the default is Videos\Craftora.
    #[serde(default)]
    output_dir: Option<String>,
    /// Where downloads and live recordings are saved; the default is Downloads in the export folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    downloads_dir: Option<String>,
    /// The proxy Craftora's connections go through (privacy.rs); none for a direct connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    proxy: Option<String>,
    /// Ads and trackers blocked (privacy.rs `block_ads`); only `false` is stored, on otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    block_ads: Option<bool>,
}

fn write_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    write_json(&data_dir(app)?.join("settings.json"), &text)
}

fn read_settings(app: &AppHandle) -> Settings {
    data_dir(app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("settings.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// When each website was last used (ms since 1970), shown in Settings → Links. Its own file, so
/// page loads in the sign-in window never rewrite settings.json.
pub(crate) type SitesUsed = std::collections::BTreeMap<String, i64>;
static SITES_USED: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn sites_used(app: &AppHandle) -> SitesUsed {
    data_dir(app)
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("sites-used.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Changes the record one caller at a time, so two pages loading at once don't lose a time.
pub(crate) fn change_sites_used(app: &AppHandle, change: impl FnOnce(&mut SitesUsed)) {
    let _one_at_a_time = SITES_USED.lock().unwrap_or_else(|e| e.into_inner());
    let before = sites_used(app);
    let mut used = before.clone();
    change(&mut used);
    if used != before
        && let (Ok(dir), Ok(text)) = (data_dir(app), serde_json::to_string(&used))
    {
        let _ = write_json(&dir.join("sites-used.json"), &text);
    }
}

/// The save folder the user chose, if it still exists.
pub(crate) fn chosen_output_dir(app: &AppHandle) -> Option<PathBuf> {
    read_settings(app).output_dir.map(PathBuf::from).filter(|dir| dir.is_dir())
}

/// The downloads folder the user chose, if it still exists.
pub(crate) fn chosen_downloads_dir(app: &AppHandle) -> Option<PathBuf> {
    read_settings(app).downloads_dir.map(PathBuf::from).filter(|dir| dir.is_dir())
}

/// Whether ads and trackers are blocked (Settings → Privacy); on unless turned off.
#[tauri::command]
pub fn get_ad_block(app: AppHandle) -> bool {
    read_settings(&app).block_ads != Some(false)
}

/// Turns blocking ads and trackers on or off, saved and used from the next page on.
#[tauri::command]
pub fn set_ad_block(app: AppHandle, on: bool) -> Result<(), String> {
    let mut settings = read_settings(&app);
    settings.block_ads = (!on).then_some(false);
    write_settings(&app, &settings)?;
    crate::privacy::block_ads(&app, on);
    Ok(())
}

/// The proxy now, and the one Craftora's window started with.
#[tauri::command]
pub fn get_proxy() -> crate::privacy::ProxyState {
    crate::privacy::state()
}

/// Sets the proxy (empty or `None` for a direct connection), checked, saved and used from now on.
#[tauri::command]
pub fn set_proxy(app: AppHandle, proxy: Option<String>) -> Result<crate::privacy::ProxyState, String> {
    let proxy = proxy.filter(|p| !p.trim().is_empty()).map(|p| crate::privacy::checked(&p)).transpose()?;
    let mut settings = read_settings(&app);
    settings.proxy = proxy.clone();
    write_settings(&app, &settings)?;
    crate::privacy::set(proxy);
    Ok(crate::privacy::state())
}

/// Where exports go now.
#[tauri::command]
pub fn get_output_dir(app: AppHandle) -> Result<String, String> {
    crate::jobs::output_dir(&app).map(|dir| dir.to_string_lossy().into_owned())
}

/// Sets the save folder (`None` goes back to Videos\Craftora) and returns where exports go now.
#[tauri::command]
pub fn set_output_dir(app: AppHandle, path: Option<String>) -> Result<String, String> {
    if path.as_ref().is_some_and(|dir| !Path::new(dir).is_dir()) {
        return Err("That folder doesn't exist.".into());
    }
    let mut settings = read_settings(&app);
    settings.output_dir = path;
    write_settings(&app, &settings)?;
    get_output_dir(app)
}

/// Where downloads and live recordings go now.
#[tauri::command]
pub fn get_downloads_dir(app: AppHandle) -> Result<String, String> {
    crate::jobs::downloads_dir(&app).map(|dir| dir.to_string_lossy().into_owned())
}

/// Sets the downloads folder (`None` goes back to Downloads in the export folder) and returns where downloads go now.
#[tauri::command]
pub fn set_downloads_dir(app: AppHandle, path: Option<String>) -> Result<String, String> {
    if path.as_ref().is_some_and(|dir| !Path::new(dir).is_dir()) {
        return Err("That folder doesn't exist.".into());
    }
    let mut settings = read_settings(&app);
    settings.downloads_dir = path;
    write_settings(&app, &settings)?;
    get_downloads_dir(app)
}

/// Exports are only ever these kinds of file: Play and Delete refuse anything else.
fn is_media(file: &Path) -> bool {
    file.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "mp4" | "mkv" | "webm" | "mov" | "mp3" | "m4a" | "wav" | "flac" | "opus"))
}

/// Opens an exported media file in the PC's default player.
#[tauri::command]
pub fn open_file(app: AppHandle, path: String) -> Result<(), String> {
    let file = Path::new(&path);
    if !is_media(file) || !file.is_file() {
        return Err("That exported file isn't there any more.".into());
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(&path, None::<&str>)
        .map_err(|e| format!("Couldn't open the file: {e}"))
}

/// Moves an exported or downloaded media file to the Recycle Bin, so a wrong click can be undone there. A file
/// that's already gone counts as done.
#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.exists() {
        return Ok(());
    }
    if !is_media(&file) || !file.is_file() {
        return Err("Only video and sound files can be deleted here.".into());
    }
    // The path reaches PowerShell through the environment, never inside the script text.
    let mut command = std::process::Command::new("powershell");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:CRAFTORA_RECYCLE, 'OnlyErrorDialogs', 'SendToRecycleBin')",
        ])
        .env("CRAFTORA_RECYCLE", &file);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    tauri::async_runtime::spawn_blocking(move || command.output())
        .await
        .map_err(|e| format!("Couldn't delete the file: {e}"))?
        .map_err(|e| format!("Couldn't delete the file: {e}"))?;
    if file.exists() {
        return Err("Couldn't delete the file. Close it in any player that has it open, then try again.".into());
    }
    Ok(())
}

/// Of `paths`, the files deleted outside Craftora (in File Explorer): gone from a folder that is
/// still there. A file on an unplugged drive (its folder is gone too) doesn't count as deleted.
#[tauri::command]
pub fn deleted_files(paths: Vec<String>) -> Vec<String> {
    paths.into_iter().filter(|p| !Path::new(p).exists() && Path::new(p).parent().is_some_and(Path::is_dir)).collect()
}

/// Saves a PNG snapshot of the preview into the export folder and opens it for the editor.
#[tauri::command]
pub fn save_snapshot(
    app: AppHandle,
    opened: tauri::State<'_, crate::local::OpenedFiles>,
    bytes: Vec<u8>,
    title: String,
) -> Result<String, String> {
    if bytes.len() < 8 || bytes.len() > MAX_FILE_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Couldn't save the snapshot.".into());
    }
    let dir = crate::jobs::output_dir(&app)?;
    let tmp = dir.join(format!(".craftora-snap-{}.png", std::process::id()));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("Couldn't save the snapshot: {e}"))?;
    let stem = format!("{}_snapshot", crate::jobs::safe_stem(&title));
    let saved = crate::jobs::deliver(&tmp, &dir, &stem, "png").inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    let normalized = crate::local::normalize(&saved)?;
    crate::local::allow_preview(&app, &normalized)?;
    opened.allow(normalized.clone());
    Ok(normalized.to_string_lossy().into_owned())
}

/// The longest voice-over take accepted: about 5 hours at the recorder's 128 kbit/s.
const MAX_VOICE_BYTES: usize = 300_000_000;

/// Saves a voice-over take into the export folder as an .m4a and opens it for the editor. The take is the window's
/// recorder output (WebM/Opus) sent as the raw request body; that WebM has no length written in it, so FFmpeg makes a
/// plain AAC file that every player (and the editor) reads.
#[tauri::command]
pub async fn save_voice(
    app: AppHandle,
    opened: tauri::State<'_, crate::local::OpenedFiles>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(take) = request.body() else {
        return Err("Couldn't save the recording.".into());
    };
    // WebM starts with the EBML header.
    if take.len() > MAX_VOICE_BYTES || !take.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Err("Couldn't save the recording.".into());
    }
    let dir = crate::jobs::output_dir(&app)?;
    let id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let raw = dir.join(format!(".craftora-voice-{id}.webm"));
    let made = dir.join(format!(".craftora-voice-{id}.m4a"));
    std::fs::write(&raw, take).map_err(|e| format!("Couldn't save the recording: {e}"))?;
    let (input, output) = (raw.to_string_lossy().into_owned(), made.to_string_lossy().into_owned());
    let args = ["-hide_banner", "-loglevel", "error", "-y", "-i", &input, "-vn", "-c:a", "aac", "-b:a", "192k", &output];
    let result = crate::engine::run_to_end(&app, crate::engine::FFMPEG, &args).await;
    let _ = std::fs::remove_file(&raw);
    if !result.is_ok_and(|out| out.status.success()) {
        let _ = std::fs::remove_file(&made);
        return Err("Couldn't save the recording.".into());
    }
    let saved = crate::jobs::deliver(&made, &dir, "Voice-over", "m4a").inspect_err(|_| {
        let _ = std::fs::remove_file(&made);
    })?;
    let normalized = crate::local::normalize(&saved)?;
    crate::local::allow_preview(&app, &normalized)?;
    opened.allow(normalized.clone());
    Ok(normalized.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::deleted_files;

    #[test]
    fn counts_only_files_gone_from_a_folder_still_there() {
        let dir = std::env::temp_dir().join(format!("craftora-deleted-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let kept = dir.join("kept.mp4");
        std::fs::write(&kept, b"x").unwrap();
        let gone = dir.join("gone.mp4");
        let unplugged = dir.join("no-such-drive").join("clip.mp4");
        let paths = [&kept, &gone, &unplugged].map(|p| p.to_string_lossy().into_owned());
        let deleted = deleted_files(paths.to_vec());
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(deleted, [paths[1].clone()]);
    }
}
