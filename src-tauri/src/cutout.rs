//! Remove background: an AI model that finds a photo's subject (ISNet "general use", Apache-2.0, as the rembg project
//! publishes it), shipped with Craftora (with an app-data download fallback) and run here via ONNX Runtime + DirectML
//! (or CPU when no DirectX 12 card is usable). The cut-out comes back as a PNG with see-through pixels, saved in the
//! app's data folder and opened like any picture.

use std::hash::{Hash, Hasher};
use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use image::{DynamicImage, GrayImage, ImageDecoder, ImageFormat, ImageReader};
use ndarray::Array4;
use ort::environment::Environment;
use ort::ep::{DirectML, CPU};
use ort::session::Session;
use ort::value::Tensor;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager};

const URL: &str = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx";
const FILE: &str = "isnet-general-use.onnx";
const BYTES: u64 = 178_648_008;
/// Its SHA-256 (rembg lists md5 fc16ebd8b0c10d971d3513d564d01e29 for the same file; both checked on 2026-11-12).
const SHA256: &str = "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a";
/// GitHub answers with a redirect to its file host; nothing else is followed.
const HOSTS: [&str; 2] = ["github.com", "release-assets.githubusercontent.com"];
/// Bigger than any photo's PNG Craftora makes (8192 × 8192 with see-through pixels).
const MAX_PNG: usize = 300_000_000;
const MODEL_SIZE: u32 = 1024;
const MODEL_PLANE: usize = (MODEL_SIZE * MODEL_SIZE) as usize;

static ORT_ENV: OnceLock<Environment> = OnceLock::new();
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

#[derive(Serialize, Clone)]
struct Progress {
    percent: f64,
}

/// Path to the ISNet model: the shipped resource when present, else the app-data copy (downloaded if missing).
async fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled = res_dir.join("models").join(FILE);
        if std::fs::metadata(&bundled).is_ok_and(|m| m.len() == BYTES) {
            return Ok(bundled);
        }
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    let path = dir.join(FILE);
    if !std::fs::metadata(&path).is_ok_and(|m| m.len() == BYTES) {
        download(app, &dir, &path).await?;
    }
    Ok(path)
}

/// The model's bytes, downloading it the first time (with `cutout-progress` events) when not bundled.
#[tauri::command]
pub async fn cutout_model(app: AppHandle) -> Result<Response, String> {
    let path = model_path(&app).await?;
    std::fs::read(&path).map(Response::new).map_err(|e| format!("Couldn't read the AI model: {e}"))
}

/// A photo opened in Craftora (only those), for the editor to cut out: its pixels can't be read through the preview's address.
#[tauri::command]
pub fn cutout_source(app: AppHandle, path: String) -> Result<Response, String> {
    let path = PathBuf::from(path);
    if !app.asset_protocol_scope().is_allowed(&path) || std::fs::metadata(&path).map_or(true, |m| m.len() > MAX_PNG as u64) {
        return Err("Only a picture opened in Craftora can be cut out.".into());
    }
    std::fs::read(&path).map(Response::new).map_err(|e| format!("Couldn't read the picture: {e}"))
}

async fn download(app: &AppHandle, dir: &std::path::Path, path: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't make a folder for the AI model: {e}"))?;
    // No overall time limit: 170 MB can take minutes on a slow connection.
    let client = crate::privacy::client_builder()
        .connect_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && attempt.url().scheme() == "https" && attempt.url().host_str().is_some_and(|h| HOSTS.contains(&h)) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(URL).send().await.map_err(|e| format!("Couldn't download the AI model: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't download the AI model: its server answered {}.", response.status()));
    }
    let part = dir.join(format!("{FILE}.part"));
    let mut file = std::fs::File::create(&part).map_err(|e| format!("Couldn't save the AI model: {e}"))?;
    let (mut done, mut shown, mut hash) = (0u64, -1.0, Sha256::new());
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("The AI model stopped downloading: {e}"))? {
        done += chunk.len() as u64;
        if done > BYTES {
            break;
        }
        file.write_all(&chunk).map_err(|e| format!("Couldn't save the AI model: {e}"))?;
        hash.update(&chunk);
        let percent = (done as f64 / BYTES as f64 * 100.0).floor();
        if percent != shown {
            shown = percent;
            let _ = app.emit("cutout-progress", Progress { percent });
        }
    }
    drop(file);
    if !genuine(done, &format!("{:x}", hash.finalize())) {
        let _ = std::fs::remove_file(&part);
        return Err("The AI model didn't download properly. Try again.".into());
    }
    std::fs::rename(&part, path).map_err(|e| format!("Couldn't save the AI model: {e}"))
}

/// The whole file, and the very one checked.
fn genuine(bytes: u64, sha256: &str) -> bool {
    bytes == BYTES && sha256 == SHA256
}

/// Saves PNG bytes in `app_data_dir()/cutouts` named by content hash and returns its path.
fn save_png_bytes(app: &AppHandle, png: &[u8]) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("cutouts");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make a folder for cut-outs: {e}"))?;
    // Named by its content: the same cut-out twice is one file.
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    png.hash(&mut hasher);
    let path: PathBuf = dir.join(format!("cutout-{:016x}.png", hasher.finish()));
    std::fs::write(&path, png).map_err(|e| format!("Couldn't save the cut-out: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Saves a cut-out the editor made (the request's body: a PNG) and returns its path, for `open_local`.
#[tauri::command]
pub fn save_cutout(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(png) = request.body() else {
        return Err("The cut-out didn't arrive.".into());
    };
    if png.len() > MAX_PNG || !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("The cut-out isn't a picture Craftora made.".into());
    }
    save_png_bytes(&app, png)
}

fn ensure_ort_loaded(app: &AppHandle) -> Result<(), String> {
    if ORT_ENV.get().is_some() {
        return Ok(());
    }
    let dll = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Couldn't load the AI model: {e}"))?
        .join("onnxruntime")
        .join("onnxruntime.dll");
    if !dll.is_file() {
        return Err("Couldn't load the AI model: ONNX Runtime isn't bundled.".into());
    }
    let env = ort::init_from(&dll)
        .map_err(|e| format!("Couldn't load the AI model: {e}"))?
        .build()
        .map_err(|e| format!("Couldn't load the AI model: {e}"))?;
    let _ = ORT_ENV.set(env);
    Ok(())
}

fn build_session(model: &std::path::Path) -> Result<Session, String> {
    let env = ORT_ENV.get().ok_or("Couldn't load the AI model: ONNX Runtime isn't loaded.")?;
    let dml = Session::builder(env)
        .map_err(|e| e.to_string())
        .and_then(|b| b.with_execution_providers([DirectML::default().build().error_on_failure(), CPU::default().build()]).map_err(|e| e.to_string()))
        .and_then(|mut b| b.commit_from_file(model).map_err(|e| e.to_string()));
    match dml {
        Ok(session) => {
            crate::diag::note("cutout: loaded ISNet on DirectML");
            Ok(session)
        }
        Err(dml_err) => {
            let cpu = Session::builder(env)
                .map_err(|e| e.to_string())
                .and_then(|b| b.with_execution_providers([CPU::default().build()]).map_err(|e| e.to_string()))
                .and_then(|mut b| b.commit_from_file(model).map_err(|e| e.to_string()))
                .map_err(|e| format!("Couldn't load the AI model: {e}"))?;
            crate::diag::note(format!("cutout: DirectML unavailable ({dml_err}), using CPU"));
            Ok(cpu)
        }
    }
}

/// rembg's ISNet normalisation: premultiplied RGB in NCHW `[1, 3, size, size]`, divided by brightest value, minus 0.5.
fn prepare_input(rgba_raw: &[u8], plane: usize, size: usize) -> Result<Array4<f32>, String> {
    let mut rgb = vec![0u8; 3 * plane];
    let mut max_val = 0u8;
    for p in 0..plane {
        let a = rgba_raw[p * 4 + 3] as u16;
        for c in 0..3 {
            let v = if a == 255 { rgba_raw[p * 4 + c] } else { ((rgba_raw[p * 4 + c] as u16 * a + 127) / 255) as u8 };
            rgb[p * 3 + c] = v;
            if v > max_val {
                max_val = v;
            }
        }
    }
    let brightest = (max_val as f32).max(1e-6);
    let mut input = vec![0.0f32; 3 * plane];
    for p in 0..plane {
        for c in 0..3 {
            input[c * plane + p] = rgb[p * 3 + c] as f32 / brightest - 0.5;
        }
    }
    Array4::from_shape_vec((1, 3, size, size), input).map_err(|e| format!("Couldn't prepare the picture: {e}"))
}

/// Spreads model output values over `0..=255`.
fn logits_to_mask(pred: &[f32]) -> Vec<u8> {
    let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
    for &v in pred {
        if v < lo {
            lo = v;
        }
        if v > hi {
            hi = v;
        }
    }
    let span = if hi - lo == 0.0 { 1.0 } else { hi - lo };
    pred.iter()
        .map(|&v| (((v - lo) / span) * 255.0).round().clamp(0.0, 255.0) as u8)
        .collect()
}

fn run_cutout_blocking(app: &AppHandle, src_path: &std::path::Path, model: &std::path::Path) -> Result<String, String> {
    let mut decoder = ImageReader::open(src_path)
        .map_err(|e| format!("Couldn't read the picture: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("Couldn't read the picture: {e}"))?
        .into_decoder()
        .map_err(|e| format!("Couldn't read the picture: {e}"))?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| format!("Couldn't read the picture: {e}"))?;
    img.apply_orientation(orientation);
    let (orig_w, orig_h) = (img.width(), img.height());
    if orig_w == 0 || orig_h == 0 {
        return Err("Couldn't read the picture: it has no pixels.".into());
    }

    // Before any tensor: ort's first call would otherwise load Windows' own older onnxruntime.dll by name.
    ensure_ort_loaded(app)?;
    let small = img.resize_exact(MODEL_SIZE, MODEL_SIZE, image::imageops::FilterType::Triangle).to_rgba8();
    let array = prepare_input(small.as_raw(), MODEL_PLANE, MODEL_SIZE as usize)?;
    let tensor = Tensor::from_array(array).map_err(|e| format!("Couldn't prepare the picture: {e}"))?;

    let mask_bytes = {
        let mut guard = SESSION.lock().map_err(|_| "Couldn't load the AI model: session lock failed.".to_string())?;
        if guard.is_none() {
            ensure_ort_loaded(app)?;
            *guard = Some(build_session(model)?);
        }
        let session = guard.as_mut().expect("session just initialized");
        let outputs = session.run(ort::inputs![tensor]).map_err(|e| format!("Couldn't run the AI model: {e}"))?;
        let out_arr = outputs[0].try_extract_array::<f32>().map_err(|e| format!("Couldn't read the AI model output: {e}"))?;
        let pred = out_arr.as_slice().ok_or_else(|| "Couldn't read the AI model output.".to_string())?;
        if pred.len() < MODEL_PLANE {
            return Err("Couldn't read the AI model output: unexpected mask size.".into());
        }
        logits_to_mask(&pred[..MODEL_PLANE])
    };

    let mask_small = GrayImage::from_raw(MODEL_SIZE, MODEL_SIZE, mask_bytes).ok_or_else(|| "Couldn't build the cut-out mask.".to_string())?;
    let mask_full = image::imageops::resize(&mask_small, orig_w, orig_h, image::imageops::FilterType::CatmullRom);
    let mut rgba = img.into_rgba8();
    for (pixel, mask_luma) in rgba.pixels_mut().zip(mask_full.pixels()) {
        let a = pixel[3] as u32 * mask_luma[0] as u32;
        pixel[3] = ((a + 127) / 255) as u8;
    }
    let mut png = Vec::new();
    DynamicImage::ImageRgba8(rgba)
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| format!("Couldn't make the cut-out: {e}"))?;
    save_png_bytes(app, &png)
}

/// Cuts the subject out of the picture at `path` (opened in Craftora) offline with ISNet; returns the saved PNG path.
#[tauri::command]
pub async fn cutout_run(app: AppHandle, path: String) -> Result<String, String> {
    let src_path = PathBuf::from(&path);
    if !app.asset_protocol_scope().is_allowed(&src_path) || std::fs::metadata(&src_path).map_or(true, |m| m.len() > MAX_PNG as u64) {
        return Err("Only a picture opened in Craftora can be cut out.".into());
    }
    let model = model_path(&app).await.map_err(|e| format!("Couldn't load the AI model: {e}"))?;
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || run_cutout_blocking(&app_clone, &src_path, &model))
        .await
        .map_err(|e| format!("Couldn't make the cut-out: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::{genuine, logits_to_mask, prepare_input, BYTES, SHA256};

    #[test]
    fn only_the_checked_model_is_kept() {
        assert!(genuine(BYTES, SHA256));
        assert!(!genuine(BYTES - 1, SHA256));
        assert!(!genuine(BYTES, "0000"));
    }

    #[test]
    fn normalisation_matches_rembg_math() {
        // 2x2 RGBA: brightest channel is 200, transparent pixel premultiplies to 0.
        let rgba = [
            200, 100, 0, 255,
            0, 0, 0, 255,
            100, 100, 100, 0,
            50, 150, 200, 255,
        ];
        let arr = prepare_input(&rgba, 4, 2).unwrap();
        assert!((arr[[0, 0, 0, 0]] - 0.5).abs() < 1e-6);
        assert!((arr[[0, 1, 0, 0]] - 0.0).abs() < 1e-6);
        assert!((arr[[0, 2, 0, 0]] + 0.5).abs() < 1e-6);
        assert!((arr[[0, 0, 1, 0]] + 0.5).abs() < 1e-6);
        assert_eq!(logits_to_mask(&[-1.0, 0.0, 1.0]), vec![0, 128, 255]);
        assert_eq!(logits_to_mask(&[0.5, 0.5]), vec![0, 0]);
    }
}
