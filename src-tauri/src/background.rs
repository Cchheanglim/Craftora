//! Downloads that go on after the window is closed. Closing Craftora while downloads run hands them over here
//! (`hand_over`): the window closes (freeing its few hundred MB) and Craftora stays in the tray, running them two at
//! a time like the queue does, pausing and resuming them from the tray's menu, and saying when they end. Opening
//! Craftora again (tray, notification, Start menu) makes a new window, which takes back how each one ended
//! (`take_background`): the queue (useQueue.ts) carries on from there, and a download still running is joined,
//! never started twice (jobs.rs `spawn_job`).

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager, Wry};

/// Downloads running at once, as the queue's `MAX_RUNNING`.
const MAX_RUNNING: usize = 2;
/// How each handed-over download ended, kept on disk too: quitting from the tray before the window is opened again
/// must not make the next start download a finished file again.
const ENDED_FILE: &str = "background-downloads.json";

/// A download from the queue, as the window handed it over.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Handed {
    id: String,
    title: String,
    /// "running", "waiting" or "paused".
    status: String,
    /// What `jobs::download_media` takes (a download for editing)…
    media: Option<Value>,
    /// …or `jobs::start_job` (a link saved to the Downloads folder).
    job: Option<Value>,
}

#[derive(Default)]
struct Background {
    /// The window is closed and these downloads run from here.
    on: bool,
    downloads: Vec<Handed>,
    /// How downloads ended while the window was closed, as the job events the queue takes (by id).
    ended: BTreeMap<String, Value>,
    /// Ended while the window was closed, for "All downloads finished".
    finished: usize,
    /// The page the new window opens on (a notification's).
    open_on: Option<String>,
}

static STATE: Mutex<Option<Background>> = Mutex::new(None);

/// Downloads running now, window open or not, each with its line in the tray's menu ("Title · 45%").
struct Downloading {
    id: String,
    title: String,
    /// Whole percent shown, so the line changes only when the number does.
    percent: Option<u32>,
    item: Option<MenuItem<Wry>>,
}

static DOWNLOADING: Mutex<Vec<Downloading>> = Mutex::new(Vec::new());

/// A download starting (jobs.rs): it gets a line in the tray's menu until it ends.
pub fn track(app: &AppHandle, id: &str, title: &str) {
    {
        let mut list = DOWNLOADING.lock().unwrap();
        if list.iter().any(|d| d.id == id) {
            return;
        }
        list.push(Downloading { id: id.to_string(), title: title.to_string(), percent: None, item: None });
    }
    rebuild_menu(app);
}

/// "VisionQuest (2026) Episode 8 · 45%", short enough for a menu.
fn line(d: &Downloading) -> String {
    let title: String = if d.title.chars().count() > 42 { d.title.chars().take(40).collect::<String>() + "…" } else { d.title.clone() };
    match d.percent {
        Some(p) => format!("{title} · {p}%"),
        None => format!("{title} · starting"),
    }
}

/// Progress and ends of downloads, for their lines in the tray's menu.
fn follow(app: &AppHandle, event: &Value) {
    let Some(id) = event["id"].as_str() else { return };
    match event["kind"].as_str() {
        Some("progress") => {
            let Some(percent) = event["percent"].as_f64().map(|p| p.clamp(0.0, 100.0) as u32) else { return };
            // Changed outside the lock: menu changes run on the window's thread, which may be waiting for it.
            let changed = {
                let mut list = DOWNLOADING.lock().unwrap();
                list.iter_mut().find(|d| d.id == id && d.percent != Some(percent)).and_then(|d| {
                    d.percent = Some(percent);
                    Some((d.item.clone()?, line(d)))
                })
            };
            if let Some((item, text)) = changed {
                let _ = item.set_text(text);
            }
        }
        Some("done" | "failed" | "paused" | "cancelled") => {
            let removed = {
                let mut list = DOWNLOADING.lock().unwrap();
                let before = list.len();
                list.retain(|d| d.id != id);
                list.len() != before
            };
            if removed {
                rebuild_menu(app);
            }
        }
        _ => {}
    }
}

fn with<T>(f: impl FnOnce(&mut Background) -> T) -> T {
    f(STATE.lock().unwrap().get_or_insert_with(Background::default))
}

/// The window is closed and downloads run from the tray.
pub fn active() -> bool {
    with(|b| b.on)
}

/// Called by the window just before it closes with downloads running or waiting.
#[tauri::command]
pub fn hand_over(app: AppHandle, downloads: Vec<Handed>) {
    with(|b| {
        b.on = true;
        b.downloads = downloads;
        b.finished = 0;
    });
    fill(&app);
}

/// What the new window takes back: how handed-over downloads ended (as job events) and the page to open.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakenBack {
    events: Vec<Value>,
    open_on: Option<String>,
}

#[tauri::command]
pub fn take_background(app: AppHandle) -> TakenBack {
    let saved = saved_ended(&app);
    let taken = with(|b| {
        b.on = false;
        b.downloads.clear();
        let mut events: Vec<Value> = saved.into_values().collect();
        events.extend(std::mem::take(&mut b.ended).into_values());
        TakenBack { events, open_on: b.open_on.take() }
    });
    if let Some(file) = ended_file(&app) {
        let _ = std::fs::remove_file(file);
    }
    taken
}

/// Starts waiting downloads while fewer than `MAX_RUNNING` run.
fn fill(app: &AppHandle) {
    let start: Vec<Handed> = with(|b| {
        if !b.on {
            return Vec::new();
        }
        let running = b.downloads.iter().filter(|d| d.status == "running").count();
        let next: Vec<usize> = (0..b.downloads.len()).filter(|&i| b.downloads[i].status == "waiting").take(MAX_RUNNING.saturating_sub(running)).collect();
        next.into_iter()
            .map(|i| {
                b.downloads[i].status = "running".into();
                b.downloads[i].clone()
            })
            .collect()
    });
    for download in start {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let started = match (download.media.clone(), download.job.clone()) {
                (Some(spec), _) => match serde_json::from_value(spec) {
                    Ok(spec) => crate::jobs::download_media(app.clone(), spec).await,
                    Err(e) => Err(e.to_string()),
                },
                (None, Some(spec)) => match serde_json::from_value(spec) {
                    Ok(spec) => crate::jobs::start_job(app.clone(), spec).await,
                    Err(e) => Err(e.to_string()),
                },
                (None, None) => Err("Nothing to download.".into()),
            };
            if let Err(message) = started {
                ended(&app, &download.id, serde_json::json!({ "kind": "failed", "id": download.id, "message": message }));
            }
        });
    }
    update_tray(app);
}

/// A job event while the window is closed: notes how a handed-over download ended, says so, starts the next.
fn on_job_event(app: &AppHandle, event: Value) {
    let Some(id) = event["id"].as_str().map(str::to_string) else { return };
    if !active() || !with(|b| b.downloads.iter().any(|d| d.id == id)) {
        return;
    }
    match event["kind"].as_str() {
        Some("done" | "failed" | "paused" | "cancelled") => ended(app, &id, event),
        _ => {}
    }
}

fn ended(app: &AppHandle, id: &str, event: Value) {
    let kind = event["kind"].as_str().unwrap_or_default().to_string();
    let (title, all_done) = with(|b| {
        let title = b.downloads.iter().find(|d| d.id == id).map(|d| d.title.clone()).unwrap_or_default();
        if let Some(d) = b.downloads.iter_mut().find(|d| d.id == id) {
            d.status = if kind == "paused" { "paused".into() } else { "ended".into() };
        }
        if kind == "done" || kind == "failed" {
            b.finished += 1;
        }
        b.ended.insert(id.to_string(), event.clone());
        let all_done = b.downloads.iter().all(|d| d.status == "ended") && b.finished >= 2;
        (title, all_done)
    });
    save_ended(app);
    // Paused or cancelled ones say nothing: that was asked for. "Interrupted" downloads end as failed.
    match kind.as_str() {
        "done" => tell(app, "Download finished", &title, "Click to open Downloads."),
        "failed" => {
            let why = event["message"].as_str().unwrap_or("It stopped");
            tell(app, "Download failed", &title, &format!("{}. Click to open Downloads.", why.trim_end_matches('.')));
        }
        _ => {}
    }
    if all_done {
        let count = with(|b| b.finished);
        tell(app, "All downloads finished", &format!("{count} downloads"), "Click to open Downloads.");
    }
    fill(app);
}

fn tell(app: &AppHandle, title: &str, line: &str, detail: &str) {
    let _ = crate::notify::notify(app.clone(), title.into(), line.into(), detail.into(), "downloads".into());
}

fn ended_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join(ENDED_FILE))
}

fn save_ended(app: &AppHandle) {
    let ended = with(|b| serde_json::to_string(&b.ended).unwrap_or_default());
    if let Some(file) = ended_file(app) {
        let _ = std::fs::write(file, ended);
    }
}

fn saved_ended(app: &AppHandle) -> BTreeMap<String, Value> {
    ended_file(app).and_then(|f| std::fs::read_to_string(f).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// The tray's Pause all / Resume all. With the window open, its queue does it (App.tsx `tray-queue`).
fn pause_all(app: &AppHandle) {
    let running: Vec<String> = with(|b| {
        for d in b.downloads.iter_mut().filter(|d| d.status == "waiting") {
            d.status = "paused".into();
        }
        b.downloads.iter().filter(|d| d.status == "running").map(|d| d.id.clone()).collect()
    });
    // Each says `paused` when it has stopped (`on_job_event`).
    for id in running {
        crate::jobs::pause_job(app.state(), id);
    }
    update_tray(app);
}

fn resume_all(app: &AppHandle) {
    with(|b| {
        for d in b.downloads.iter_mut().filter(|d| d.status == "paused") {
            d.status = "waiting".into();
            b.ended.remove(&d.id);
        }
    });
    save_ended(app);
    fill(app);
}

/// Brings Craftora's window back, making it again when it was closed; `page` is the sidebar page to show.
pub fn open_main(app: &AppHandle, page: Option<&str>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        if let Some(page) = page {
            let _ = app.emit("notification-clicked", page);
        }
        return;
    }
    with(|b| b.open_on = page.map(str::to_string));
    let Some(config) = app.config().app.windows.first().cloned() else { return };
    match tauri::WebviewWindowBuilder::from_config(app, &config).and_then(|builder| builder.build()) {
        Ok(main) => crate::prepare_main(app, &main),
        Err(e) => crate::diag::note(format!("couldn't open the window again: {e}")),
    }
}

/// The tray's menu: a line per running download (clicking one opens Downloads), then Craftora's own items.
fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let menu = Menu::new(app)?;
    // Made outside the lock (see `follow`), then kept with their downloads.
    let lines: Vec<(String, String)> = DOWNLOADING.lock().unwrap().iter().map(|d| (d.id.clone(), line(d))).collect();
    for (id, text) in &lines {
        let entry = MenuItem::with_id(app, format!("download:{id}"), text, true, None::<&str>)?;
        menu.append(&entry)?;
        if let Some(d) = DOWNLOADING.lock().unwrap().iter_mut().find(|d| &d.id == id) {
            d.item = Some(entry);
        }
    }
    if !lines.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append_items(&[
        &item("open", "Open Craftora")?,
        &item("downloads", "Downloads")?,
        &PredefinedMenuItem::separator(app)?,
        &item("pause", "Pause all")?,
        &item("resume", "Resume all")?,
        &PredefinedMenuItem::separator(app)?,
        &item("quit", "Quit Craftora")?,
    ])?;
    Ok(menu)
}

/// Downloads started or ended: the tray's menu lists the ones running now.
fn rebuild_menu(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("craftora") else { return };
    if let Ok(menu) = menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
    update_tray(app);
}

/// The tray icon, there from the start: click it to bring Craftora forward, right-click for its menu.
pub fn tray(app: &AppHandle) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id("craftora").tooltip("Craftora").menu(&menu(app)?).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        "open" => open_main(app, None),
        "downloads" => open_main(app, Some("downloads")),
        "pause" if active() => pause_all(app),
        "resume" if active() => resume_all(app),
        // The window's queue pauses and resumes its own downloads.
        "pause" => {
            let _ = app.emit("tray-queue", "pauseAll");
        }
        "resume" => {
            let _ = app.emit("tray-queue", "resumeAll");
        }
        "quit" => quit(app),
        id if id.starts_with("download:") => open_main(app, Some("downloads")),
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            open_main(tray.app_handle(), None);
        }
    })
    .build(app)?;
    let handle = app.clone();
    app.listen_any("job-event", move |event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            follow(&handle, &value);
            on_job_event(&handle, value);
        }
    });
    Ok(())
}

/// Quit Craftora (tray). With the window open, it asks first when an export or captions would stop (App.tsx
/// `tray-quit`); from the tray alone, downloads stop where they are and go on by themselves next time.
fn quit(app: &AppHandle) {
    if app.get_webview_window("main").is_some() {
        let _ = app.emit("tray-quit", ());
    } else {
        app.exit(0);
    }
}

/// Quits Craftora: every window closes, and every program it started ends with it (engine.rs `tie`).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// The tray's tooltip says how many downloads run.
fn update_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("craftora") else { return };
    let running = DOWNLOADING.lock().unwrap().len();
    let tip = match running {
        0 => "Craftora".to_string(),
        1 => "Craftora · 1 download running".to_string(),
        n => format!("Craftora · {n} downloads running"),
    };
    let _ = tray.set_tooltip(Some(tip));
}
