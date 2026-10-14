mod engine;
mod jobs;
mod local;
mod media;
mod project;
mod store;

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
            local::make_preview,
            jobs::start_job,
            project::start_render,
            jobs::cancel_job,
            store::list_projects,
            store::load_project,
            store::save_project,
            store::delete_project,
            store::load_history,
            store::save_history,
            store::get_output_dir,
            store::set_output_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
