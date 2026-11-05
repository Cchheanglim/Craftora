//! Windows notifications when a download, export or recording ends while Craftora is in the
//! background. A click brings Craftora forward on the page the notification is about.

use tauri::{AppHandle, Emitter, Manager};

/// Shows a notification: `title`, then two lines. Clicking it brings the main window forward and
/// sends `notification-clicked` with `page` (the sidebar page to open).
#[tauri::command]
pub fn notify(app: AppHandle, title: String, line: String, detail: String, page: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let handle = app.clone();
        tauri_winrt_notification::Toast::new(&app_id(&app))
            .title(&title)
            .text1(&line)
            .text2(&detail)
            // Silent: Craftora plays its own sound when something finishes (App.tsx).
            .sound(None)
            .on_activated(move |_| {
                if let Some(main) = handle.get_webview_window("main") {
                    let _ = main.unminimize();
                    let _ = main.show();
                    let _ = main.set_focus();
                }
                let _ = handle.emit("notification-clicked", &page);
                Ok(())
            })
            .show()
            .map_err(|e| format!("Couldn't show the notification: {e}"))?;
    }
    #[cfg(not(windows))]
    let _ = (app, title, line, detail, page);
    Ok(())
}

/// Who the notification is from, so Windows shows "Craftora" and its icon: a Store copy's package
/// id, else the bundle identifier, which the installer gives the Start menu shortcut.
#[cfg(windows)]
fn app_id(app: &AppHandle) -> String {
    if let Some(id) = package_app_id() {
        return id;
    }
    let id = app.config().identifier.clone();
    // A dev run has no shortcut: without this Windows wouldn't know the name (the notification
    // plugin borrowed PowerShell's, so they said "Windows PowerShell").
    #[cfg(debug_assertions)]
    register_dev(&id);
    id
}

/// The app id of a packaged (MSIX, Store) copy; None when Craftora isn't packaged.
#[cfg(windows)]
fn package_app_id() -> Option<String> {
    use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentApplicationUserModelId;
    let mut buf = [0u16; 256];
    let mut len = buf.len() as u32;
    // SAFETY: `buf` holds `len` u16s; Windows writes at most that many.
    let error = unsafe { GetCurrentApplicationUserModelId(&mut len, buf.as_mut_ptr()) };
    (error == 0 && len > 1).then(|| String::from_utf16_lossy(&buf[..len as usize - 1]))
}

/// Tells Windows the dev build's name and icon (HKCU\Software\Classes\AppUserModelId\<id>).
#[cfg(all(windows, debug_assertions))]
fn register_dev(id: &str) {
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ};
    let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let icon = concat!(env!("CARGO_MANIFEST_DIR"), "\\icons\\128x128.png");
    let mut key: HKEY = std::ptr::null_mut();
    // SAFETY: plain registry calls on a key opened here; every string is NUL-terminated UTF-16
    // and its byte length includes the terminator.
    unsafe {
        let path = wide(&format!("Software\\Classes\\AppUserModelId\\{id}"));
        if RegCreateKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, std::ptr::null(), REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, std::ptr::null(), &mut key, std::ptr::null_mut()) != 0 {
            return;
        }
        for (name, value) in [("DisplayName", "Craftora"), ("IconUri", icon)] {
            let (name, value) = (wide(name), wide(value));
            RegSetValueExW(key, name.as_ptr(), 0, REG_SZ, value.as_ptr().cast(), (value.len() * 2) as u32);
        }
        RegCloseKey(key);
    }
}
