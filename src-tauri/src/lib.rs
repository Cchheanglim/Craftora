mod assistant;
mod encoders;
mod engine;
mod jobs;
mod local;
mod media_cache;
mod media;
mod project;
mod signin;
mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(jobs::Jobs::default())
        .manage(local::OpenedFiles::default())
        .manage(media_cache::MediaCache::default())
        // Link previews play through a disk cache, so scrubbing what's fetched is instant.
        .register_asynchronous_uri_scheme_protocol("cmedia", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(media_cache::serve(&app, request).await);
            });
        })
        .setup(|app| {
            // Exports interrupted by closing the app leave working folders behind.
            let handle = app.handle().clone();
            std::thread::spawn(move || jobs::clean_work_dirs(&handle));
            // Find the fastest encoder now, so the first export doesn't wait for it.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                encoders::hardware(&handle).await;
            });
            // Everything a little larger than 100%: text, pictures and controls alike.
            if let Some(main) = tauri::Manager::get_webview_window(app, "main") {
                let _ = main.set_zoom(1.1);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::engine_status,
            engine::update_yt_dlp,
            media::fetch_media,
            local::open_local,
            local::make_preview,
            jobs::start_job,
            project::start_render,
            jobs::cancel_job,
            jobs::download_media,
            media_cache::cache_media,
            media_cache::prefetch_media,
            store::list_projects,
            store::load_project,
            store::save_project,
            store::delete_project,
            store::load_history,
            store::save_history,
            store::get_output_dir,
            store::set_output_dir,
            store::get_cookie_file,
            store::set_cookie_file,
            signin::open_sign_in,
            signin::sign_out_everywhere,
            assistant::assistant_has_key,
            assistant::assistant_set_key,
            encoders::export_encoder,
            assistant::assistant_models,
            assistant::assistant_generate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
