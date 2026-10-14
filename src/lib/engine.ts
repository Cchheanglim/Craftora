/**
 * Bridge to the Rust backend (src-tauri/src). Only meaningful inside the desktop app;
 * in a plain browser tab `inDesktopApp` is false and the UI runs its demo mode.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { JobSpec, MediaSource, RenderSpec } from "../types";

export const inDesktopApp = "__TAURI_INTERNALS__" in window;

export interface EngineStatus {
  ytDlp: string | null;
  ffmpeg: string | null;
}

export type JobEvent =
  | {
      kind: "progress";
      id: string;
      phase: "downloading" | "processing" | "cutting" | "encoding";
      percent: number | null;
      downloadedBytes: number | null;
      totalBytes: number | null;
      speedBps: number | null;
      etaSeconds: number | null;
    }
  | { kind: "done"; id: string; path: string; sizeBytes: number }
  | { kind: "failed"; id: string; message: string }
  | { kind: "cancelled"; id: string };

/** Rust commands reject with a plain message string. */
const message = (err: unknown) => (typeof err === "string" ? err : err instanceof Error ? err.message : String(err));

export const engineStatus = () => invoke<EngineStatus>("engine_status");

export async function fetchMedia(url: string): Promise<MediaSource> {
  try {
    return await invoke<MediaSource>("fetch_media", { url });
  } catch (err) {
    throw new Error(message(err));
  }
}

/** File types offered in the Open dialog; FFmpeg reads many more if dropped. */
const MEDIA_EXTENSIONS = ["mp4", "mkv", "webm", "mov", "avi", "m4v", "wmv", "flv", "ts", "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma"];

/** Reads a file on this PC with ffprobe. Works offline. */
export async function openLocal(path: string): Promise<MediaSource> {
  try {
    const source = await invoke<MediaSource>("open_local", { path });
    // The preview plays the file straight from disk through Tauri's asset protocol.
    return { ...source, previewUrl: convertFileSrc(source.url) };
  } catch (err) {
    throw new Error(message(err));
  }
}

/** Shows the Windows Open dialog; null when the user cancels. */
/** Shows the Windows Open dialog; empty when the user cancels. */
export async function pickMediaFiles(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    directory: false,
    title: "Import video or audio files",
    filters: [{ name: "Video and audio", extensions: MEDIA_EXTENSIONS }],
  });
  return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
}

export async function pickMediaFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: "Open a video or audio file",
    filters: [{ name: "Video and audio", extensions: MEDIA_EXTENSIONS }],
  });
  return typeof picked === "string" ? picked : null;
}

export type DropState = "over" | "left" | { dropped: string[] };

/** Files dragged onto the window. */
export const onFileDrop = (handler: (state: DropState) => void): Promise<UnlistenFn> =>
  getCurrentWebview().onDragDropEvent((event) => {
    const { type } = event.payload;
    if (type === "enter" || type === "over") handler("over");
    else if (type === "leave") handler("left");
    else if (type === "drop") handler({ dropped: event.payload.paths });
  });

export async function startJob(spec: JobSpec): Promise<void> {
  try {
    await invoke("start_job", { spec });
  } catch (err) {
    throw new Error(message(err));
  }
}

/** Renders a whole timeline in one FFmpeg pass. */
export async function startRender(spec: RenderSpec): Promise<void> {
  try {
    await invoke("start_render", { spec });
  } catch (err) {
    throw new Error(message(err));
  }
}

export const cancelJob = (id: string) => invoke<boolean>("cancel_job", { id });

export const onJobEvent = (handler: (event: JobEvent) => void): Promise<UnlistenFn> =>
  listen<JobEvent>("job-event", (e) => handler(e.payload));

export const revealFile = (path: string) => revealItemInDir(path);

/** Makes the app window fill the screen (desktop app only). */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  if (!inDesktopApp) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setFullscreen(on);
}
