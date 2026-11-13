/**
 * Remove background (Background tab): an AI model (cutout.rs) finds a photo's subject and everything else turns
 * see-through. It runs in this window, on the graphics card when it can (WebGPU), else on the processor. The maths is
 * rembg's for this model: the photo stretched to 1024 × 1024, its values over its brightest one, minus 0.5; the mask's
 * lowest..highest spread over 0..1, then stretched back to the photo's own size.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { InferenceSession } from "onnxruntime-web";
// The engine's own files, shipped with the app (by default it would fetch them from a website).
import wasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import mjs from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";

const SIZE = 1024;
let session: Promise<InferenceSession> | undefined;

const canvas = (width: number, height: number) => Object.assign(document.createElement("canvas"), { width, height });

function picture(src: string): Promise<HTMLImageElement> {
  return new Promise((done, fail) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => fail(new Error("Couldn't read the picture."));
    img.src = src;
  });
}

/** Cuts the subject out of the picture at `path` (a file opened in Craftora); `onStatus` says what's happening. Returns
 * the PNG's path on this PC. */
export async function removeBackground(path: string, onStatus: (text: string) => void): Promise<string> {
  const ort = await import("onnxruntime-web/webgpu");
  ort.env.wasm.wasmPaths = { wasm, mjs };
  session ??= (async () => {
    onStatus("Getting the AI model ready…");
    const stop = await listen<{ percent: number }>("cutout-progress", (e) => onStatus(`Getting the cut-out tool (170 MB, once)… ${e.payload.percent}%`));
    const model = new Uint8Array(await invoke<ArrayBuffer>("cutout_model").finally(stop));
    onStatus("Starting the AI…");
    return ort.InferenceSession.create(model, { executionProviders: "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"] });
  })();
  const ai = await session.catch((err) => {
    session = undefined;
    throw err;
  });

  onStatus("Removing the background…");
  const bytes = await invoke<ArrayBuffer>("cutout_source", { path });
  const src = URL.createObjectURL(new Blob([bytes]));
  const img = await picture(src).finally(() => URL.revokeObjectURL(src));
  const [w, h] = [img.naturalWidth, img.naturalHeight];
  const small = canvas(SIZE, SIZE);
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let brightest = 1e-6;
  for (let i = 0; i < px.length; i += 4) brightest = Math.max(brightest, px[i], px[i + 1], px[i + 2]);
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) for (let c = 0; c < 3; c++) input[c * plane + p] = px[p * 4 + c] / brightest - 0.5;
  const out = await ai.run({ [ai.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
  const pred = out[ai.outputNames[0]].data as Float32Array;
  let [lo, hi] = [Infinity, -Infinity];
  for (let i = 0; i < plane; i++) [lo, hi] = [Math.min(lo, pred[i]), Math.max(hi, pred[i])];
  const mask = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < plane; i++) mask.data[i * 4 + 3] = Math.round(((pred[i] - lo) / (hi - lo || 1)) * 255);
  ctx.putImageData(mask, 0, 0);

  // The photo at its own size, kept only where the mask is.
  const full = canvas(w, h);
  const f = full.getContext("2d")!;
  f.drawImage(img, 0, 0);
  f.globalCompositeOperation = "destination-in";
  f.imageSmoothingQuality = "high";
  f.drawImage(small, 0, 0, w, h);
  const png = await new Promise<Blob>((done, fail) => full.toBlob((b) => (b ? done(b) : fail(new Error("Couldn't make the cut-out."))), "image/png"));
  return invoke<string>("save_cutout", new Uint8Array(await png.arrayBuffer()));
}
