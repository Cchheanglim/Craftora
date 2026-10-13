# Craftora Desktop Media Studio (yt-dlp & FFmpeg Utility)

A precision desktop media extraction, lossless trimming, and conversion utility built with React, TypeScript, and Tauri, bundling `yt-dlp` and `FFmpeg` sidecars. Designed with a utilitarian, Apple Music-inspired aesthetic featuring sharp geometry, high contrast, and zero visual clutter.

## User Review & Critical Decisions

> [!IMPORTANT]
> The architectural direction and UX decisions below reflect the confirmed user preferences from Phase 1. Review the proposed specifications and click **Proceed** to start implementation.

- **Confirmed Layout & Architecture**: Single-window desktop split pane combining URL stream ingestion, metadata inspection, integrated timeline trimmer, and active processing queue.
- **Confirmed Aesthetic & Palette**: Inspired by the desktop Apple Music application—monochromatic dark slate canvas (`#121212` / `#1C1C1E`), crisp hairline surface borders (`#2C2C2E`), clean rectangular geometry without pill-shaped capsules, and signature Apple Music coral-red accent (`#FA2D48`).
- **Confirmed Trimmer & Transform Engines**: Integrated visual range timeline with start/end timecode scrubbing, lossless audio/video extraction flags, and video transformation switches including **Horizontal Mirror (Flip)** and **Video Reverse**.

---

## 1. Overview & Core Concept

### What It Does
Craftora Desktop Media Studio is a native-grade desktop utility that allows creators, editors, and archivists to ingest streaming media URLs (via bundled `yt-dlp`), inspect streams, select exact video/audio formats, trim specific segments without re-encoding, apply mirror/reverse transforms (via bundled `FFmpeg`), and monitor multi-threaded batch download tasks in a unified workspace.

### Target Audience & Persona
- Video editors, sound designers, and content archivists who need instant, lossless extractions and conversions without bloat, web advertisements, or lossy re-compression.

### Key Value
- **Zero Lossless Degradation**: Quick clipping using stream copy (`-c copy`) avoids CPU-heavy re-encoding when cutting segments.
- **Native Desktop Utility Density**: Utilitarian, keyboard-friendly UI with high spatial density, tabular numerical timecodes, and persistent queue visibility.

---

## 2. User Experience & Visual Design

### Key User Flows

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Ingest URL          2. Inspect & Format     3. Trim & Transform    │
│ Paste stream link ───► Fetch media metadata ─► Set in/out points      │
│ (YouTube, Vimeo, etc)  Resolution & codecs     Mirror / Reverse toggle│
│                                                       │                │
│ 5. Queue & Local Save  4. Export Preset               ▼                │
│ Real-time progress ◄── Lossless cut / Extract ◄── Choose format        │
│ Reveal in folder       audio / MP4 / WAV       (Video vs Audio)        │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Stream Ingestion**: The user pastes a media URL into the persistent header search/input bar.
2. **Metadata Inspector & Format Selector**: The stream's title, uploader, channel, duration, available video streams (4K, 1080p, 60fps), audio tracks, and thumbnail render in the top inspector pane.
3. **Integrated Timeline Trimmer**:
   - Visual waveform/progress scrubber with draggable range handles.
   - Dual numeric timecode inputs (`Start [00:01:24.00]` → `End [00:03:45.50]`).
   - One-click duration stamp calculator (`Cut Duration: 02:21.50`).
   - **Video Mirror Toggle (`-vf hflip`)**: Flips footage horizontally.
   - **Video Reverse Toggle (`-vf reverse`)**: Reverses video sequence.
   - **Lossless Stream Copy Switch (`-c copy`)**: Trims keyframe-accurate cuts without re-encoding.
4. **Queue & Batch Processing**:
   - Downward split pane showing ongoing extractions, active download speed (`14.8 MB/s`), percentage progress bar, ETA, and completed jobs with instant "Open Folder" / "Play" actions.

### Visual Identity & Theme (Apple Music Inspiration)

- **Aesthetic Direction**: Apple Music Desktop (macOS Sonoma / Sequoia utility style). Sharp, rectangular surfaces with micro-radius corners (`rounded-md`, 4px–6px), high-contrast tabular typography, subtle hairline dividers, and zero ornamental gradients or pill badges.
- **Color Distribution (60-30-10 Rule)**:
  - **60% Canvas**: Deep matte obsidian `#121212` with sub-surface panels at `#1C1C1E`.
  - **30% Structure**: Hairline dividers (`#2C2C2E`), subtle hover fills (`#28282A`), muted secondary labels (`#8E8E93`), and primary text (`#F5F5F7`).
  - **10% Accent**: Apple Music Crimson `#FA2D48` used with discipline on primary action buttons, active timeline playheads, and active toggle markers.
- **Zero-Pill Discipline**:
  - Metadata (e.g. `1080p60 · 48kHz AAC · 142 MB · 03:45`) is displayed strictly as clean unboxed text separated by typographic middots (`·`).
  - No capsule buttons, floating candy chips, or blurry glowing drop shadows.
- **Typography**:
  - System sans (`Plus Jakarta Sans` or `Manrope`) with strict `tabular-nums` for all timecodes, file sizes, download speeds, and bitrates.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Single-Window Split Pane vs. Multi-Tab Flow
- **Chosen Approach**: Single-window split pane with an Inspector & Trimmer on top/left and a persistent Queue & Task Manager on the bottom/right.
- **Why**: Desktop power users prefer keeping context on their active download queue while simultaneously configuring the next URL or trimming an audio snippet.
- **Alternatives Considered**: Multi-tab navigation was rejected because it conceals download progress behind hidden tabs.

### Decision 2: Timeline Trimming with Lossless vs. Transcode Modes
- **Chosen Approach**: Two distinct export modes:
  1. *Lossless Cut (`-c copy`)*: Instantaneous export without quality loss when only trimming time boundaries.
  2. *Transformation Cut*: Automatically activated when applying "Mirror" (`hflip`) or "Reverse" (`reverse`), which inherently require FFmpeg re-encoding.
- **Why**: Educates the user transparently about why a mirror or reverse operation takes a few seconds of processing versus instantaneous stream copying.

### Decision 3: Desktop Native Simulation & Sidecar Bridge
- **Chosen Approach**: Complete Tauri/Rust IPC bridge architecture simulation in the React layer with realistic `yt-dlp` metadata parsing, command construction, and process lifecycle event emitters, enabling immediate browser preview while remaining 1:1 drop-in ready for the Tauri `invoke()` interface.

---

## 4. Technical Architecture & Component Hierarchy

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Craftora Desktop Window                         │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Top Bar: Traffic Lights · URL Input Bar · Quick Paste · Settings │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─────────────────────────────────┬────────────────────────────────┐  │
│  │ Left: Stream Inspector          │ Right: Integrated Trimmer      │  │
│  │                                 │                                │  │
│  │ • Thumbnail & Title             │ • Video Canvas / Scrub Bar     │  │
│  │ • Format Selection (MP4/MKV/MP3)│ • In/Out Range Slider          │  │
│  │ • Quality & Audio Bitrate       │ • Timecode Inputs (hh:mm:ss)   │  │
│  │ • Clean Unboxed Stream Specs    │ • Mirror & Reverse Switches    │  │
│  │                                 │ • Lossless Stream Copy Toggle  │  │
│  └─────────────────────────────────┴────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Bottom Split Pane: Batch Queue & Process Manager                 │  │
│  │                                                                  │  │
│  │ • Active Tasks with tabular speeds (MB/s), ETA, and progress bar │  │
│  │ • FFmpeg Conversion logs (toggleable console)                    │  │
│  │ • Completed Library with Reveal in Folder & Copy Command actions │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │   Tauri Core / IPC Bridge (Rust sidecar executor)      │
       │   • `yt-dlp --dump-json <URL>`                         │
       │   • `ffmpeg -ss <start> -to <end> -i ... -c copy`      │
       │   • `ffmpeg -i ... -vf "hflip,reverse" ...`            │
       └────────────────────────────────────────────────────────┘
```

### Key Data Entities & Types

```typescript
interface MediaStreamMetadata {
  id: string;
  url: string;
  title: string;
  uploader: string;
  duration: number; // in seconds
  thumbnail: string;
  formats: {
    formatId: string;
    resolution: string;
    fps: number;
    ext: 'mp4' | 'mkv' | 'webm' | 'mp3' | 'wav';
    filesize: number;
    hasVideo: boolean;
    hasAudio: boolean;
  }[];
}

interface TrimTransformConfig {
  startTime: number; // seconds
  endTime: number;   // seconds
  isLossless: boolean;
  mirrorVideo: boolean;
  reverseVideo: boolean;
  targetFormat: 'mp4' | 'mp3' | 'wav' | 'mkv';
  audioOnly: boolean;
}

interface QueueTask {
  id: string;
  title: string;
  sourceUrl: string;
  status: 'queued' | 'fetching' | 'processing' | 'completed' | 'error';
  progress: number; // 0 - 100
  downloadSpeed: string; // e.g. "18.4 MB/s"
  eta: string; // e.g. "00:14"
  outputPath: string;
  commandSnippet: string; // generated yt-dlp / ffmpeg CLI string
}
```

---

## 5. Implementation Steps (Planned for Execution)

1. **Design System & Apple Music Theme Setup**: Configure Tailwind theme tokens for `#121212` background, `#1C1C1E` surfaces, `#2C2C2E` hairline borders, and `#FA2D48` Apple Music red accent.
2. **Top Bar & Window Chrome**: Build desktop titlebar with traffic light mockups, clean URL ingestion input, and quick paste button.
3. **Stream Inspector Component**: Ingest sample URLs and live inputs; parse title, uploader, format dropdown, and resolution specs.
4. **Interactive Timeline Trimmer**: Build precision dual-handle scrubber, timestamp inputs, video mirror (`hflip`), video reverse, and lossless cut toggles.
5. **Queue & Batch Processing Panel**: Build active task table with tabular speed metrics, progress bars, pause/cancel controls, and completed task file reveals.
6. **Command Inspector Drawer**: Provide a slide-up view displaying the exact compiled `yt-dlp` and `FFmpeg` command line strings.
