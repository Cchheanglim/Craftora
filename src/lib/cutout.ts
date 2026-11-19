/**
 * Remove background (Background tab): an AI model (BiRefNet lite fp16, ~115 MB, usually run offline in cutout.rs)
 * finds a photo's subject and everything else turns see-through. The in-page fallback runs in this window, on the
 * graphics card when it can (WebGPU), else on the processor. The maths: the photo resized to 1024 × 1024, ImageNet-
 * normalised `(pixel / 255 - mean) / std`; logits passed through sigmoid, spread over 0..1, then stretched back to
 * the photo's own size.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { allowLocal } from "./engine";
import type { InferenceSession } from "onnxruntime-web";
// The engine's own files, shipped with the app (by default it would fetch them from a website).
import wasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import mjs from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";

const SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
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
  onStatus("Removing the background… this can take up to 20 seconds");
  // A project reopened after a restart hasn't let this file be read yet.
  await allowLocal(path);
  try {
    return await invoke<string>("cutout_run", { path });
  } catch (err) {
    const msg = typeof err === "string" ? err : err instanceof Error ? err.message : "";
    if (!/couldn't load the ai (?:model|runtime)/i.test(msg)) throw err;
  }

  const ort = await import("onnxruntime-web/webgpu");
  ort.env.wasm.wasmPaths = { wasm, mjs };
  session ??= (async () => {
    onStatus("Getting the AI model ready…");
    const stop = await listen<{ percent: number }>("cutout-progress", (e) => onStatus(`Getting the cut-out tool (115 MB, once)… ${e.payload.percent}%`));
    const model = new Uint8Array(await invoke<ArrayBuffer>("cutout_model").finally(stop));
    onStatus("Starting the AI…");
    return ort.InferenceSession.create(model, { executionProviders: "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"] });
  })();
  const ai = await session.catch((err) => {
    session = undefined;
    throw err;
  });

  onStatus("Removing the background… this can take up to 20 seconds");
  // A project reopened after a restart hasn't let this file be read yet.
  await allowLocal(path);
  const bytes = await invoke<ArrayBuffer>("cutout_source", { path });
  const src = URL.createObjectURL(new Blob([bytes]));
  const img = await picture(src).finally(() => URL.revokeObjectURL(src));
  const [w, h] = [img.naturalWidth, img.naturalHeight];
  const small = canvas(SIZE, SIZE);
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) {
      input[c * plane + p] = (px[p * 4 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  const out = await ai.run({ [ai.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
  const pred = out[ai.outputNames[0]].data as Float32Array;
  const prob = new Float32Array(plane);
  let [lo, hi] = [Infinity, -Infinity];
  for (let i = 0; i < plane; i++) {
    const s = 1 / (1 + Math.exp(-pred[i]));
    prob[i] = s;
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  const span = hi - lo || 1;
  const mask = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < plane; i++) mask.data[i * 4 + 3] = Math.round(((prob[i] - lo) / span) * 255);
  ctx.putImageData(mask, 0, 0);

  // The photo at its own size, kept only where the mask is.
  const full = canvas(w, h);
  const f = full.getContext("2d")!;
  f.drawImage(img, 0, 0);
  f.globalCompositeOperation = "destination-in";
  f.imageSmoothingQuality = "high";
  f.drawImage(small, 0, 0, w, h);
  const png = await new Promise<Blob>((done, fail) => full.toBlob((b) => (b ? done(b) : fail(new Error("Couldn't make the cut-out."))), "image/png"));
  return savePicture(png);
}

/** Keeps a PNG Craftora made (a cut-out, a painted or new layer) in its own folder; the file's path. */
export const savePicture = async (png: Blob) => invoke<string>("save_cutout", new Uint8Array(await png.arrayBuffer()));
