mod agents;
mod assistant;
mod background;
mod captions;
mod diag;
mod drop;
mod encoders;
mod engine;
mod cutout;
mod fonts;
mod jobs;
mod live;
mod local;
mod media_cache;
mod media;
mod notify;
mod page_fetch;
mod privacy;
mod project;
mod scan;
mod signin;
mod speech;
mod store;
mod upscale;
mod virustotal;

/// WebView2's memory target: low gives back its caches (for a window nobody sees), normal is for use.
#[cfg(windows)]
fn memory_target(window: &tauri::WebviewWindow, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;
    let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
    let _ = window.with_webview(move |webview| {
        // SAFETY: `with_webview` runs on the window's own thread.
        let _ = unsafe { webview.controller().CoreWebView2().and_then(|core| core.cast::<ICoreWebView2_19>()).and_then(|core| core.SetMemoryUsageTargetLevel(level)) };
    });
}

/// The main window's setup, at start and when it's made again after closing to the tray (background.rs).
pub(crate) fn prepare_main(app: &tauri::AppHandle, main: &tauri::WebviewWindow) {
    // Everything a little larger than 100%: text, pictures and controls alike.
    let _ = main.set_zoom(1.1);
    // No "Saved info" list under the link box and other fields (the sign-in window keeps it). A touchpad
    // pinch reaches the page (as Ctrl + wheel) only with pinch zoom on: the page keeps the window from
    // zooming (main.tsx) and zooms the timeline with it instead.
    #[cfg(windows)]
    drop::register(main);
    #[cfg(windows)]
    let _ = main.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Settings4, ICoreWebView2Settings5};
        use windows_core::Interface;
        // SAFETY: `with_webview` runs on the window's own thread.
        let _ = unsafe {
            webview.controller().CoreWebView2().and_then(|core| core.Settings()).and_then(|s| {
                let fields = s.cast::<ICoreWebView2Settings4>()?;
                fields.SetIsGeneralAutofillEnabled(false)?;
                fields.SetIsPasswordAutosaveEnabled(false)?;
                s.cast::<ICoreWebView2Settings5>()?.SetIsPinchZoomEnabled(true)
            })
        };
    });
    // Before any website is opened, so the sign-in window has it from its first page.
    privacy::block_ads(app, store::get_ad_block(app.clone()));
    // Minimized, WebView2 lets go of what it can (about 40 MB of picture memory); shown again, back to normal.
    #[cfg(windows)]
    {
        let window = main.clone();
        main.on_window_event(move |event| {
            if let tauri::WindowEvent::Resized(_) = event {
                memory_target(&window, window.is_minimized().unwrap_or(false));
            }
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before any window: WebView2 only takes a proxy when it starts.
    privacy::prepare();
    let builder = tauri::Builder::default();
    // Release builds run once: opening Craftora again brings back the one running (maybe only in the tray), so no
    // second copy resumes the same downloads. Not dev builds, so `tauri dev` runs beside an installed Craftora.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| background::open_main(app, None)));
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(jobs::Jobs::default())
        .manage(local::OpenedFiles::default())
        .manage(media_cache::MediaCache::default())
        .manage(live::Recordings::default())
        // The voice-over recorder: the microphone without a question window, for Craftora's own window only (never
        // the sign-in window's websites).
        .on_permission_request(|webview, kind| match kind {
            tauri::webview::PermissionKind::Microphone if webview.label() == "main" => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        })
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
            fonts::init(app.handle());
            // Exports interrupted by closing the app leave working folders behind.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                jobs::clean_work_dirs(&handle);
                jobs::clean_sources(&handle);
                local::clean_voice_tracks(&handle);
            });
            // Find the fastest encoder now, so the first export doesn't wait for it.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                encoders::hardware(&handle).await;
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                engine::warm_up(&handle).await;
            });
            if let Some(main) = tauri::Manager::get_webview_window(app, "main") {
                prepare_main(app.handle(), &main);
            }
            background::tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::engine_status,
            engine::update_yt_dlp,
            media::fetch_media,
            diag::diagnostics,
            diag::note_diagnostic,
            live::record_live,
            live::stop_recording,
            local::allow_local,
            local::open_local,
            local::make_preview,
            local::local_thumbnail,
            local::audio_peaks,
            local::voice_track,
            local::link_peaks,
            local::detect_silences,
            jobs::start_job,
            project::start_render,
            jobs::cancel_job,
            jobs::pause_job,
            jobs::discard_download,
            jobs::list_downloads,
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
            store::get_downloads_dir,
            store::set_downloads_dir,
            store::open_file,
            store::delete_file,
            store::deleted_files,
            store::get_proxy,
            store::set_proxy,
            store::get_ad_block,
            store::set_ad_block,
            privacy::check_address,
            jobs::rename_download,
            captions::load_captions,
            captions::save_srt,
            captions::open_captions,
            notify::notify,
            speech::make_captions,
            fonts::font_file,
            cutout::cutout_model,
            cutout::save_cutout,
            cutout::cutout_source,
            cutout::cutout_run,
            upscale::upscale_picture,
            speech::cancel_captions,
            store::save_snapshot,
            store::save_image,
            store::save_voice,
            virustotal::site_check_available,
            virustotal::set_site_check_key,
            virustotal::check_site,
            media::fetch_thumbnail,
            signin::open_sign_in,
            signin::close_sign_in_preload,
            signin::sign_out_everywhere,
            signin::signed_in_sites,
            signin::sign_out_of,
            signin::tell_sign_in,
            assistant::assistant_has_key,
            assistant::assistant_set_key,
            encoders::export_encoder,
            assistant::assistant_models,
            assistant::assistant_generate,
            agents::agents_scan,
            agents::agent_run,
            agents::local_models,
            agents::local_generate,
            drop::save_gif_from,
            drop::save_sound_from,
            background::hand_over,
            background::take_background,
            background::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // The window closed. With downloads handed over (background.rs) Craftora stays in the tray, and the
            // sign-in window goes too (its pages hold memory); otherwise Craftora quits. Before, a sign-in window
            // (even the hidden one loading a page) kept Craftora running with no window to close.
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "main" => {
                if !background::active() {
                    app.exit(0);
                } else if let Some(signin) = tauri::Manager::get_webview_window(app, signin::WINDOW) {
                    let _ = signin.destroy();
                }
            }
            // The last window closing doesn't end Craftora while downloads run from the tray.
            tauri::RunEvent::ExitRequested { code: None, api, .. } if background::active() => api.prevent_exit(),
            _ => {}
        });
}
