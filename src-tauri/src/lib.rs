mod engine;
mod jobs;
mod local;
mod media;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(jobs::Jobs::default())
        .manage(local::OpenedFiles::default())
        .invoke_handler(tauri::generate_handler![
            engine::engine_status,
            media::fetch_media,
            local::open_local,
            jobs::start_job,
            jobs::cancel_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
