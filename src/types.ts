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
  /** A directly playable file used for the in-app preview. */
  previewUrl: string;
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

export interface Job {
  id: string;
  title: string;
  /** One-line description: range, container, transforms. */
  summary: string;
  kind: OutputKind;
  status: JobStatus;
  /** 0–100. */
  progress: number;
  /** Whether this job needs an FFmpeg re-encode after downloading. */
  needsEncode: boolean;
  sizeMb: number;
  fileName: string;
  command: string;
  finishedAt?: number;
  error?: string;
}
