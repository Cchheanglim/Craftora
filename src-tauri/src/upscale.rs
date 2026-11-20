//! AI sharpen (Export picture): Real-ESRGAN x4plus (BSD-3-Clause, Xintao Wang et al.; ONNX build by Qualcomm AI Hub),
//! shipped with Craftora in bin/models (the graph and, beside it, its weights). The model takes 128 × 128 pieces and
//! gives them back 4× bigger with detail redrawn; the picture goes through piece by piece with an overlap so the seams
//! don't show, then each piece comes down to the size asked for. DirectML when it works, else the processor.

use std::sync::Mutex;

use ndarray::Array4;
use ort::ep::{directml::PerformancePreference, DirectML};
use ort::session::Session;
use ort::value::Tensor;
use serde::Deserialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager};

const FILE: &str = "real_esrgan_x4plus.onnx";
/// The model's fixed piece size (in) and its 4× (out).
const TILE: usize = 128;
const OUT: usize = TILE * 4;
/// Pixels of each piece overlapping its neighbours, dropped from the result (the model is unsure near a piece's edge).
const PAD: usize = 8;
const CORE: usize = TILE - 2 * PAD;
/// About 8900 × 8900: the largest picture Craftora saves.
const MAX_OUT_PIXELS: usize = 80_000_000;

struct Cached {
    session: Session,
    directml: bool,
}

static SESSION: Mutex<Option<Cached>> = Mutex::new(None);

#[derive(Deserialize)]
struct Head {
    /// The queue job it's for (its progress shows there), or "" for the Export window's before/after.
    id: String,
    width: usize,
    height: usize,
    /// How much bigger the result is: 1, 2 or 4 (1 and 2 are the 4× result brought down, sharper than the picture).
    factor: usize,
}

fn model_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let path = app.path().resource_dir().map_err(|e| e.to_string())?.join("models").join(FILE);
    if path.is_file() {
        Ok(path)
    } else {
        Err("AI sharpen isn't installed with this copy of Craftora.".into())
    }
}

fn build_session(model: &std::path::Path) -> Result<Cached, String> {
    let env = crate::cutout::ORT_ENV.get().ok_or("Couldn't load the AI model: ONNX Runtime isn't loaded.")?;
    let dml = Session::builder(env).map_err(|e| e.to_string()).and_then(|b| {
        b.with_execution_providers([DirectML::default().with_performance_preference(PerformancePreference::HighPerformance).build().error_on_failure()])
            .map_err(|e| e.to_string())
            .and_then(|mut b| b.commit_from_file(model).map_err(|e| e.to_string()))
    });
    match dml {
        Ok(session) => {
            crate::diag::note("upscale: loaded Real-ESRGAN on DirectML");
            Ok(Cached { session, directml: true })
        }
        Err(e) => {
            crate::diag::note(format!("upscale: DirectML unavailable ({e}), using CPU"));
            Ok(Cached { session: crate::cutout::build_cpu_session(env, model)?, directml: false })
        }
    }
}

/// The piece whose kept part starts at (`x0`, `y0`), as the model's input: RGB 0..1 in NCHW, edges repeated past the picture.
fn piece(rgba: &[u8], w: usize, h: usize, x0: usize, y0: usize) -> Array4<f32> {
    let plane = TILE * TILE;
    let mut input = vec![0.0f32; 3 * plane];
    for ty in 0..TILE {
        let sy = (y0 + ty).saturating_sub(PAD).min(h - 1);
        for tx in 0..TILE {
            let sx = (x0 + tx).saturating_sub(PAD).min(w - 1);
            let p = (sy * w + sx) * 4;
            for c in 0..3 {
                input[c * plane + ty * TILE + tx] = rgba[p + c] as f32 / 255.0;
            }
        }
    }
    Array4::from_shape_vec((1, 3, TILE, TILE), input).expect("piece shape")
}

/// Writes the kept part (`cw` × `ch` input pixels) of a piece's 4× result into `out` at (`x0`, `y0`) × `factor`,
/// each out pixel the average of its (4 / `factor`)² block of the result.
#[allow(clippy::too_many_arguments)]
fn place(result: &[f32], out: &mut [u8], ow: usize, x0: usize, y0: usize, cw: usize, ch: usize, factor: usize) {
    let plane = OUT * OUT;
    let step = 4 / factor;
    let norm = (step * step) as f32;
    for oy in 0..ch * factor {
        for ox in 0..cw * factor {
            let o = ((y0 * factor + oy) * ow + x0 * factor + ox) * 4;
            for c in 0..3 {
                let mut sum = 0.0;
                for dy in 0..step {
                    let ry = PAD * 4 + oy * step + dy;
                    for dx in 0..step {
                        let rx = PAD * 4 + ox * step + dx;
                        sum += result[c * plane + ry * OUT + rx];
                    }
                }
                out[o + c] = (sum / norm * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

fn run_piece(cached: &mut Cached, input: &Array4<f32>) -> Result<Vec<f32>, String> {
    let tensor = Tensor::from_array(input.clone()).map_err(|e| format!("Couldn't prepare the picture: {e}"))?;
    let outputs = cached.session.run(ort::inputs!["image" => &tensor]).map_err(|e| e.to_string())?;
    let arr = outputs[0].try_extract_array::<f32>().map_err(|e| format!("Couldn't read the AI model output: {e}"))?;
    let data = arr.as_slice().ok_or("Couldn't read the AI model output.")?;
    if data.len() < 3 * OUT * OUT {
        return Err("Couldn't read the AI model output: unexpected size.".into());
    }
    Ok(data[..3 * OUT * OUT].to_vec())
}

fn sharpen_blocking(app: &AppHandle, head: &Head, rgba: &[u8], model: &std::path::Path) -> Result<Vec<u8>, String> {
    let (w, h, factor) = (head.width, head.height, head.factor);
    let (ow, oh) = (w * factor, h * factor);
    let mut out = vec![255u8; ow * oh * 4];
    let (across, down) = (w.div_ceil(CORE), h.div_ceil(CORE));
    let total = across * down;
    let mut shown = -1i64;

    // Before any tensor: ort's first call would otherwise load Windows' own older onnxruntime.dll by name.
    crate::cutout::ensure_ort_loaded(app)?;
    let mut guard = SESSION.lock().map_err(|_| "Couldn't load the AI model: session lock failed.".to_string())?;
    for (i, (ty, tx)) in (0..down).flat_map(|ty| (0..across).map(move |tx| (ty, tx))).enumerate() {
        let (x0, y0) = (tx * CORE, ty * CORE);
        let (cw, ch) = (CORE.min(w - x0), CORE.min(h - y0));
        let input = piece(rgba, w, h, x0, y0);
        if guard.is_none() {
            *guard = Some(build_session(model)?);
        }
        let cached = guard.as_mut().expect("session just made");
        let result = match run_piece(cached, &input) {
            Ok(r) => r,
            Err(e) if cached.directml => {
                // DirectML gave up (out of graphics memory): the processor takes over from here.
                crate::diag::note(format!("upscale: DirectML run failed ({e}), using CPU"));
                *guard = None;
                let env = crate::cutout::ORT_ENV.get().ok_or("Couldn't load the AI model: ONNX Runtime isn't loaded.")?;
                let cpu = guard.insert(Cached { session: crate::cutout::build_cpu_session(env, model)?, directml: false });
                run_piece(cpu, &input).map_err(|e| format!("Couldn't run the AI model: {e}"))?
            }
            Err(e) => return Err(format!("Couldn't run the AI model: {e}")),
        };
        place(&result, &mut out, ow, x0, y0, cw, ch, factor);
        let percent = ((i + 1) * 100 / total) as i64;
        if !head.id.is_empty() && percent != shown {
            shown = percent;
            let _ = app.emit("job-event", crate::jobs::progress_event(&head.id, "sharpening", Some(percent as f64)));
        }
    }
    drop(guard);

    // See-through parts: the picture's own transparency, enlarged smoothly (the model only redraws colour).
    if rgba.as_chunks::<4>().0.iter().any(|p| p[3] < 255) {
        let alpha = image::GrayImage::from_raw(w as u32, h as u32, rgba.as_chunks::<4>().0.iter().map(|p| p[3]).collect()).ok_or("Couldn't read the picture.")?;
        let big = if factor == 1 { alpha } else { image::imageops::resize(&alpha, ow as u32, oh as u32, image::imageops::FilterType::CatmullRom) };
        for (o, a) in out.as_chunks_mut::<4>().0.iter_mut().zip(big.as_raw()) {
            o[3] = *a;
        }
    }
    Ok(out)
}

/// AI sharpen: the raw body is a little-endian u32 length, that many bytes of JSON (`Head`), then the picture's RGBA
/// pixels; returns the sharpened picture's RGBA pixels (`width` × `factor` by `height` × `factor`). Progress goes to the
/// queue job named `id` as `job-event`s in the "sharpening" phase.
#[tauri::command]
pub async fn upscale_picture(app: AppHandle, request: Request<'_>) -> Result<Response, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("Couldn't read the picture.".into());
    };
    let size = body.get(..4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).unwrap_or(usize::MAX);
    let (Some(head), Some(rgba)) = (body.get(4..4usize.saturating_add(size)), body.get(4usize.saturating_add(size)..)) else {
        return Err("Couldn't read the picture.".into());
    };
    let head: Head = serde_json::from_slice(head).map_err(|_| "Couldn't read the picture.".to_string())?;
    check(&head, rgba.len())?;
    let model = model_path(&app)?;
    let rgba = rgba.to_vec();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || sharpen_blocking(&app2, &head, &rgba, &model))
        .await
        .map_err(|e| format!("AI sharpen stopped: {e}"))?
        .map(Response::new)
}

fn check(head: &Head, len: usize) -> Result<(), String> {
    if !matches!(head.factor, 1 | 2 | 4) || head.width == 0 || head.height == 0 || len != head.width * head.height * 4 {
        return Err("Couldn't read the picture.".into());
    }
    if head.width * head.height * head.factor * head.factor > MAX_OUT_PIXELS {
        return Err("The picture is too big for AI sharpen at this size: pick a smaller size.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pieces_repeat_the_edges_and_keep_rgb_in_0_to_1() {
        // A 2 × 1 picture: red, then white. The piece starting at (0, 0) reaches PAD pixels before it: red repeated.
        let rgba = [255, 0, 0, 255, 255, 255, 255, 255];
        let p = piece(&rgba, 2, 1, 0, 0);
        assert_eq!(p[[0, 0, 0, 0]], 1.0);
        assert_eq!(p[[0, 1, 0, 0]], 0.0);
        // Column PAD + 1 is the white pixel, and everything after it repeats white.
        assert_eq!(p[[0, 1, 0, PAD + 1]], 1.0);
        assert_eq!(p[[0, 2, TILE - 1, TILE - 1]], 1.0);
    }

    #[test]
    fn placing_averages_the_4x_result_down_to_the_factor() {
        // A flat 4× result of 0.5 everywhere, but 1.0 on the first out pixel of the kept part in red.
        let mut result = vec![0.5f32; 3 * OUT * OUT];
        result[(PAD * 4) * OUT + PAD * 4] = 1.0;
        let mut out = vec![0u8; 4 * 4];
        place(&result, &mut out, 2, 0, 0, 1, 1, 2);
        // factor 2 from 4×: each out pixel is a 2 × 2 average; the first holds the bright one: (1 + 0.5 × 3) / 4.
        assert_eq!(out[0], (0.625f32 * 255.0).round() as u8);
        assert_eq!(out[4], 128);
        assert_eq!(out[1], 128);
    }

    #[test]
    fn sizes_are_checked() {
        let ok = Head { id: String::new(), width: 10, height: 10, factor: 2 };
        assert!(check(&ok, 400).is_ok());
        assert!(check(&ok, 399).is_err());
        assert!(check(&Head { factor: 3, ..ok }, 400).is_err());
        let huge = Head { id: String::new(), width: 4000, height: 4000, factor: 4 };
        assert!(check(&huge, 4000 * 4000 * 4).is_err());
    }
}
