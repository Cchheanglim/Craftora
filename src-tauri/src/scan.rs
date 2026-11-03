//! Checks on every file Craftora keeps as a website sent it (downloads, and exports cut straight
//! from a link): it must really be a video or sound file, and the PC's antivirus scans it, as
//! browsers do. Files FFmpeg writes itself (rendered exports, live recordings) aren't the website's
//! bytes, so they aren't checked.

use std::path::Path;

use tauri::AppHandle;

/// Keeps `file` only if it's a real video or sound file that the PC's antivirus passes; otherwise
/// deletes it and says why.
pub(crate) async fn check_saved(app: &AppHandle, file: &Path) -> Result<(), String> {
    let media = crate::local::probe(app, file).await;
    if !media.is_ok_and(|m| m.has_video || m.has_audio) {
        let _ = std::fs::remove_file(file);
        return Err("What the website sent isn't a video or sound file, so Craftora deleted it.".into());
    }
    let path = file.to_path_buf();
    let scanned = tauri::async_runtime::spawn_blocking(move || antivirus_scan(&path)).await.unwrap_or(Ok(()));
    if scanned.is_err() {
        let _ = std::fs::remove_file(file);
    }
    scanned
}

/// Windows' Attachment Services: the installed antivirus (Microsoft Defender or another) scans the
/// file, and Windows marks it as coming from the internet. Err when the antivirus flags it or
/// Windows' settings block files from the internet.
#[cfg(windows)]
fn antivirus_scan(path: &Path) -> Result<(), String> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{AttachmentServices, IAttachmentExecute};
    use windows_core::{GUID, HSTRING};
    // Craftora's own id in Windows' attachment settings: any GUID, as long as it never changes.
    const CRAFTORA: GUID = GUID::from_u128(0x6f1d2c3a_8b4e_4f5a_9c7d_2e1b0a9f8c6d);
    let local = HSTRING::from(path.as_os_str());
    // A thread of its own: the scan needs a single-threaded COM apartment, which a shared worker
    // thread may already have set up differently.
    let saved = std::thread::spawn(move || {
        // SAFETY: COM is set up and torn down on this thread, around the only COM calls made on it.
        unsafe {
            let ready = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if ready.is_err() {
                return Err(ready.into());
            }
            let saved = CoCreateInstance::<_, IAttachmentExecute>(&AttachmentServices, None, CLSCTX_INPROC_SERVER).and_then(|attachment| {
                attachment.SetClientGuid(&CRAFTORA)?;
                attachment.SetLocalPath(&local)?;
                // "The internet" rather than the link, so the link isn't written into the file's mark.
                attachment.SetSource(&HSTRING::from("about:internet"))?;
                attachment.Save()
            });
            CoUninitialize();
            saved
        }
    })
    .join()
    .unwrap_or_else(|_| Err(windows_core::Error::empty()));
    let verdict = verdict(saved.as_ref().err().map(|e| e.code().0), path.exists());
    if verdict.is_ok()
        && let Err(e) = &saved
    {
        crate::diag::note(format!("antivirus scan couldn't run: {e}"));
    }
    verdict
}

#[cfg(not(windows))]
fn antivirus_scan(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// What a scan's answer means (`error`: its HRESULT, if it failed), as Chrome reads it. A scan that
/// couldn't run for another reason keeps the file: the download itself is fine.
fn verdict(error: Option<i32>, still_there: bool) -> Result<(), String> {
    const E_FAIL: i32 = 0x8000_4005_u32 as i32;
    const BLOCKED_BY_POLICY: i32 = 0x800C_000E_u32 as i32; // INET_E_SECURITY_PROBLEM
    match error {
        Some(BLOCKED_BY_POLICY) => Err("Windows' security settings block files from the internet, so Craftora deleted it.".into()),
        // E_FAIL is how the antivirus reports a threat; a file gone after the scan was removed by it.
        Some(E_FAIL) => Err("Your antivirus found a threat in it, so it was deleted.".into()),
        _ if !still_there => Err("Your antivirus found a threat in it, so it was deleted.".into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletes_only_what_the_antivirus_or_windows_refuses() {
        assert!(verdict(None, true).is_ok());
        assert!(verdict(Some(0x8000_4005_u32 as i32), true).unwrap_err().contains("threat"));
        assert!(verdict(None, false).unwrap_err().contains("threat"));
        assert!(verdict(Some(0x800C_000E_u32 as i32), true).unwrap_err().contains("block"));
        // Couldn't scan (here "access denied"): the file stays.
        assert!(verdict(Some(0x8007_0005_u32 as i32), true).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn the_antivirus_passes_a_clean_file() {
        let path = std::env::temp_dir().join(format!("craftora-scan-test-{}.mp4", std::process::id()));
        std::fs::write(&path, b"not a virus").unwrap();
        let scanned = antivirus_scan(&path);
        // Windows' mark that the file came from the internet (zone 3) shows the scan really ran.
        let mark = std::fs::read_to_string(format!("{}:Zone.Identifier", path.display())).unwrap_or_default();
        let _ = std::fs::remove_file(&path);
        assert_eq!(scanned, Ok(()));
        assert!(mark.contains("ZoneId=3"), "{mark}");
    }
}
