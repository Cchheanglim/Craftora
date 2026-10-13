export interface StreamFormatOption {
  formatId: string;
  resolution: string;
  fps: number;
  ext: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'wav' | 'aac' | 'flac';
  filesizeApprox: string;
  vcodec: string;
  acodec: string;
  isAudioOnly?: boolean;
}

export interface MediaMetadata {
  id: string;
  url: string;
  title: string;
  uploader: string;
  uploaderUrl?: string;
  duration: number; // in seconds
  thumbnail: string;
  mediaSourceUrl: string; // direct playable stream for preview
  viewCount: string;
  uploadDate: string;
  formats: StreamFormatOption[];
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface TrimConfig {
  startTime: number; // in seconds
  endTime: number;   // in seconds
  isLossless: boolean;
  mirror: boolean;
  reverse: boolean;
  playbackSpeed: number; // 0.5 to 2.0
  selectedFormatId: string;
  audioOnly: boolean;
  outputExt: 'mp4' | 'mkv' | 'mp3' | 'wav' | 'aac';
  audioBitrate: string; // e.g. "320k"
}

export interface QueueTask {
  id: string;
  title: string;
  sourceUrl: string;
  status: 'queued' | 'downloading' | 'processing' | 'completed' | 'paused' | 'error';
  progress: number; // 0 to 100
  downloadSpeed: string; // e.g. "18.4 MB/s"
  eta: string; // e.g. "00:12"
  downloadedBytes: string;
  totalBytes: string;
  outputPath: string;
  outputExt: string;
  isTrimmed: boolean;
  trimRangeText?: string;
  startTime?: number;
  endTime?: number;
  isMirrored?: boolean;
  isReversed?: boolean;
  isLossless?: boolean;
  commandSnippet: string;
  startedAt: string;
  errorMessage?: string;
}

export interface HistoryLogEntry {
  id: string;
  title: string;
  sourceUrl: string;
  outputPath: string;
  outputExt: string;
  fileSize: string;
  durationText: string;
  isTrimmed: boolean;
  startTime?: number;
  endTime?: number;
  isMirrored?: boolean;
  isReversed?: boolean;
  isLossless?: boolean;
  audioOnly?: boolean;
  commandSnippet: string;
  completedAt: string;
  timestamp: number;
  rerunCount: number;
}

