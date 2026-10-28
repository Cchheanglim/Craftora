export type OutputKind = "video" | "audio";
export type VideoContainer = "mp4" | "mkv";
export type AudioContainer = "mp3" | "wav" | "flac";
export type CutMode = "fast" | "precise";

/** One downloadable stream that yt-dlp reported for a source. */
export interface StreamOption {
  /** yt-dlp format selector (or `local:video` / `local:audio` for files on this PC). */
  id: string;
  kind: OutputKind;
  label: string;
  detail: string;
  sizeMb: number;
}

/** A fetched link or an opened file: what can be previewed and placed on the timeline. */
export interface MediaSource {
  /** The link, or the absolute path for files on this PC. */
  url: string;
  title: string;
  uploader: string;
  /** Length in seconds. */
  duration: number;
  /** A file on this PC; handled by FFmpeg alone, no network. */
  local?: boolean;
  /** A directly playable file used for the in-app preview; empty when there is none. */
  previewUrl: string;
  /** False when the preview is a silent video-only stream. Absent means it has sound. */
  previewHasAudio?: boolean;
  /** Separate sound stream to play in sync with a video-only preview (common on YouTube). */
  previewAudioUrl?: string;
  /** `previewUrl` is a stream playlist (HLS): played by the WebView itself or, through the relay, by hls.js. */
  previewHls?: boolean;
  /**
   * Files on this PC the preview player can't open as they are (AC-3 sound, AVI, HEVC…):
   * which preview copy is still being made. Absent once the preview is ready.
   */
  previewProxy?: "audio" | "video" | "";
  /** A still picture (PNG, JPEG…): no sound, shown for as long as its clip lasts. */
  image?: boolean;
  /** A small picture: the site's picture for a link, or a JPEG data URL of a file's first frame. */
  thumbnail?: string;
  /** Links: the preview streams' ids in the disk cache (src-tauri/src/media_cache.rs). */
  previewCacheIds?: string[];
  /** ~240 loudness bars (0–100) across the audio, for the radio wave under the video and on clips. */
  peaks?: number[];
  /** Chapters from yt-dlp (e.g. YouTube chapters), in media seconds. */
  chapters?: { title: string; start: number; end: number }[];
  /** Links: the captions that come with the video, read with `loadCaptions`. */
  captions?: { url: string; label: string };
  streams: StreamOption[];
  /** Live now: no length yet. Recorded while it plays (src-tauri/src/live.rs); `duration` grows. */
  live?: boolean;
  /** Download the whole video before exporting (its site's bot check blocks FFmpeg); it still previews. */
  downloadFirst?: boolean;
}

/** The output frame for timeline renders. */
export interface Frame {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface ExportSettings {
  output: OutputKind;
  videoContainer: VideoContainer;
  audioContainer: AudioContainer;
  /** Only used for a single untouched clip; everything else is re-encoded. */
  cutMode: CutMode;
  frameId: string;
  /** Timeline renders: "fast" uses the graphics card when there is one; "best" is slower and smaller. */
  quality: RenderQuality;
}

export type RenderQuality = "fast" | "best";

export type JobStatus = "waiting" | "downloading" | "encoding" | "paused" | "finished" | "failed";

/** A single untouched cut (mirrors `JobSpec` in src-tauri/src/jobs.rs). */
export interface JobSpec {
  id: string;
  url: string;
  /** yt-dlp format selector. */
  format: string;
  output: OutputKind;
  container: VideoContainer | AudioContainer;
  start: number;
  end: number;
  duration: number;
  cutMode: CutMode;
  fileName: string;
  /** url is a file opened from this PC. */
  local: boolean;
}

/** A whole timeline (mirrors `RenderSpec` in src-tauri/src/project.rs). */
export interface RenderSpec {
  id: string;
  media: { id: string; local: boolean; image: boolean; src: string; format: string }[];
  clips: RenderClip[];
  width: number;
  height: number;
  fps: number;
  output: OutputKind;
  container: VideoContainer | AudioContainer;
  fileName: string;
  quality: RenderQuality;
}

export type TransitionKind = "crossfade" | "dip";

export interface RenderClip {
  role: "video" | "audio" | "text";
  /** Drawing order for pictures and text: higher is on top. */
  layer: number;
  mediaId?: string;
  start: number;
  in: number;
  out: number;
  speed: number;
  volume: number;
  mirror: boolean;
  reverse: boolean;
  /** Cover the frame instead of fitting inside it. */
  fill: boolean;
  fadeIn: number;
  fadeOut: number;
  /** Fractions cut off each side: left, top, right, bottom. */
  crop: [number, number, number, number];
  /** Seconds this clip overlaps the clip before it on its track (0 = straight cut), and how. */
  transitionIn: number;
  transitionInKind: TransitionKind;
  /** The same for the clip after it, which overlaps this clip's end. */
  transitionOut: number;
  transitionOutKind: TransitionKind;
  /** Video: scale where 1 fills the frame as far as the shape allows. Text: height / frame height. */
  size: number;
  x: number;
  y: number;
  text: string;
  color: string;
}

export interface Job {
  id: string;
  title: string;
  /** One-line description: length, format, what's in it. */
  summary: string;
  kind: OutputKind;
  status: JobStatus;
  /** 0–100, or null while the total is unknown. */
  progress: number | null;
  /** Whether this job re-encodes after downloading (demo simulation only). */
  needsEncode: boolean;
  /** Estimated before the job runs, exact once it has finished. */
  sizeMb: number;
  fileName: string;
  command: string;
  /** A single cut the real engines run. */
  spec?: JobSpec;
  /** A timeline the real engines render. Absent (with `spec`) for simulated demo jobs. */
  render?: RenderSpec;
  /** A whole link downloaded so it can be edited like a file on this PC ("Download first"). */
  prefetch?: { mediaId: string; url: string; format: string; title: string; audioOnly: boolean };
  /** A live link being recorded into this media item; Stop keeps the recording. */
  record?: { mediaId: string };
  /** "processing" while yt-dlp merges or converts after downloading. */
  phase?: "downloading" | "processing" | "cutting" | "encoding" | "recording";
  downloadedBytes?: number;
  totalBytes?: number;
  speedBps?: number;
  etaSeconds?: number;
  outputPath?: string;
  /** The project's picture when it was queued, shown in the export lists. */
  thumbnail?: string;
  finishedAt?: number;
  error?: string;
  /** Hidden by the user from Exports' main list and Home's recent exports; the file stays. */
  hidden?: boolean;
}

/** A line of captions, in media seconds (`Caption` in captions.rs). */
export interface Caption {
  start: number;
  end: number;
  text: string;
}
