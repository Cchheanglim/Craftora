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
mod virustotal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(jobs::Jobs::default())
        .manage(local::OpenedFiles::default())
        .manage(media_cache::MediaCache::default())
        // Link previews play through a disk cache, so scrubbing what's fetched is instant.
        .register_asynchronous_uri_scheme_protocol("cmedia", |ctx, request, responder| {
            // Only Craftora's own window. Every window gets every custom scheme, and a website in
            // the sign-in window could otherwise use the HLS relay (which fetches any address) to
            // read the user's local network and localhost services.
            if ctx.webview_label() != "main" {
                let refused = tauri::http::Response::builder().status(403).body(Vec::new()).unwrap_or_default();
                responder.respond(refused);
                return;
            }
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
            store::open_file,
            virustotal::site_check_available,
            virustotal::check_site,
            media::fetch_thumbnail,
            signin::open_sign_in,
            signin::sign_out_everywhere,
            signin::tell_sign_in,
            assistant::assistant_has_key,
            assistant::assistant_set_key,
            encoders::export_encoder,
            assistant::assistant_models,
            assistant::assistant_generate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
