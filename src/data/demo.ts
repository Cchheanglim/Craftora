/**
 * Demo content for running the UI before the Tauri/yt-dlp backend exists.
 * The videos are Blender Foundation open movies (CC BY) hosted on archive.org;
 * stream sizes are illustrative.
 * Replace with real `yt-dlp --dump-json` results once the engine is connected.
 */
import type { Job, MediaSource } from "../types";

const BUNNY = "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4";
const ELEPHANTS = "https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4";
const SINTEL = "https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4";

export const DEMO_SOURCES: MediaSource[] = [
  {
    url: BUNNY,
    title: "Big Buck Bunny",
    uploader: "Blender Foundation",
    duration: 596.5,
    previewUrl: BUNNY,
    streams: [
      { id: "2160p", kind: "video", label: "2160p · 60 fps", detail: "AV1 + AAC", sizeMb: 640 },
      { id: "1080p", kind: "video", label: "1080p · 60 fps", detail: "H.264 + AAC", sizeMb: 185 },
      { id: "720p", kind: "video", label: "720p · 30 fps", detail: "H.264 + AAC", sizeMb: 92 },
      { id: "audio-wav", kind: "audio", label: "Studio master", detail: "PCM 24-bit", sizeMb: 78 },
      { id: "audio-mp3", kind: "audio", label: "320 kbps", detail: "MP3", sizeMb: 22 },
    ],
  },
  {
    url: ELEPHANTS,
    title: "Elephants Dream",
    uploader: "Orange Open Movie Project",
    duration: 653.8,
    previewUrl: ELEPHANTS,
    streams: [
      { id: "1080p", kind: "video", label: "1080p · 24 fps", detail: "VP9 + Opus", sizeMb: 210 },
      { id: "720p", kind: "video", label: "720p · 24 fps", detail: "H.264 + AAC", sizeMb: 110 },
      { id: "audio-flac", kind: "audio", label: "Lossless", detail: "FLAC", sizeMb: 62 },
    ],
  },
  {
    url: SINTEL,
    title: "Sintel",
    uploader: "Blender Foundation",
    duration: 888,
    previewUrl: SINTEL,
    streams: [
      { id: "1080p", kind: "video", label: "1080p · 24 fps", detail: "H.264 + AAC", sizeMb: 260 },
      { id: "720p", kind: "video", label: "720p · 24 fps", detail: "H.264 + AAC", sizeMb: 130 },
      { id: "audio-mp3", kind: "audio", label: "320 kbps", detail: "MP3", sizeMb: 34 },
    ],
  },
];

export const DEMO_JOBS: Job[] = [
  {
    id: "demo-1",
    title: "Big Buck Bunny",
    summary: "00:15 → 01:45 · MP4 · Fast cut",
    kind: "video",
    status: "downloading",
    progress: 41,
    needsEncode: false,
    sizeMb: 28,
    fileName: "BigBuckBunny_0015-0145.mp4",
    command: `yt-dlp -f "1080p+bestaudio" --download-sections "*00:00:15.00-00:01:45.00" --merge-output-format mp4 -o "BigBuckBunny_0015-0145.mp4" "${BUNNY}"`,
  },
  {
    id: "demo-2",
    title: "Sintel",
    summary: "06:10 → 06:25 · MP4 · Precise cut · Mirror · Reverse",
    kind: "video",
    status: "waiting",
    progress: 0,
    needsEncode: true,
    sizeMb: 4.4,
    fileName: "Sintel_0610-0625.mp4",
    command: `yt-dlp -f "1080p+bestaudio" --download-sections "*00:06:10.00-00:06:25.00" --force-keyframes-at-cuts --postprocessor-args "ffmpeg:-vf hflip,reverse -af areverse" --merge-output-format mp4 -o "Sintel_0610-0625.mp4" "${SINTEL}"`,
  },
  {
    id: "demo-3",
    title: "Elephants Dream",
    summary: "Full length · FLAC · Audio only",
    kind: "audio",
    status: "finished",
    progress: 100,
    needsEncode: false,
    sizeMb: 62,
    fileName: "ElephantsDream.flac",
    command: `yt-dlp -f "audio-flac" -x --audio-format flac -o "ElephantsDream.flac" "${ELEPHANTS}"`,
    finishedAt: Date.now() - 4 * 60_000,
  },
];
