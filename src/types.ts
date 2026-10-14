export type OutputKind = "video" | "audio";
export type VideoContainer = "mp4" | "mkv";
export type AudioContainer = "mp3" | "wav" | "flac";
export type CutMode = "fast" | "precise";

/** One downloadable stream that yt-dlp reported for a source. */
export interface StreamOption {
  id: string;
  kind: OutputKind;
  label: string;
  detail: string;
  sizeMb: number;
}

/** A fetched link: what the editor previews and trims. */
export interface MediaSource {
  url: string;
  title: string;
  uploader: string;
  /** Length in seconds. */
  duration: number;
  /** A file on this PC (url is its path); handled by FFmpeg alone, no network. */
  local?: boolean;
  /** A directly playable file used for the in-app preview; empty when there is none. */
  previewUrl: string;
  /** False when the preview is a silent video-only stream. Absent means it has sound. */
  previewHasAudio?: boolean;
  streams: StreamOption[];
}

export interface Range {
  /** Seconds. */
  start: number;
  /** Seconds. */
  end: number;
}

export interface ExportSettings {
  output: OutputKind;
  videoStreamId: string;
  audioStreamId: string;
  videoContainer: VideoContainer;
  audioContainer: AudioContainer;
  mirror: boolean;
  reverse: boolean;
  cutMode: CutMode;
}

export type JobStatus =
  | "waiting"
  | "downloading"
  | "encoding"
  | "paused"
  | "finished"
  | "failed";

/** What the Rust backend needs to run a job (mirrors `JobSpec` in src-tauri/src/jobs.rs). */
export interface JobSpec {
  id: string;
  url: string;
  /** yt-dlp format selector from the chosen stream. */
  format: string;
  output: OutputKind;
  container: VideoContainer | AudioContainer;
  start: number;
  end: number;
  duration: number;
  cutMode: CutMode;
  mirror: boolean;
  reverse: boolean;
  fileName: string;
  /** url is a file opened from this PC. */
  local: boolean;
}

export interface Job {
  id: string;
  title: string;
  /** One-line description: range, container, transforms. */
  summary: string;
  kind: OutputKind;
  status: JobStatus;
  /** 0–100, or null while the total is unknown. */
  progress: number | null;
  /** Whether this job needs an FFmpeg re-encode after downloading. */
  needsEncode: boolean;
  /** Estimated before the job runs, exact once it has finished. */
  sizeMb: number;
  fileName: string;
  command: string;
  /** Present for jobs the real engines run; absent for simulated demo jobs. */
  spec?: JobSpec;
  /** "processing" while yt-dlp merges or converts after downloading. */
  phase?: "downloading" | "processing" | "cutting" | "encoding";
  downloadedBytes?: number;
  totalBytes?: number;
  speedBps?: number;
  etaSeconds?: number;
  outputPath?: string;
  finishedAt?: number;
  error?: string;
}
