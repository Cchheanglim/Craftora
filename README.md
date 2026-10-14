# Craftora

A Windows desktop video editor for quick, clean cuts. Bring in video and sound from your
PC or from a link, arrange them on a timeline, add text, and export a new file. Everything
runs locally: no account, no uploads.

Craftora is a [Tauri 2](https://tauri.app) app. The interface is React and TypeScript.
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org) ship inside the
app and do the downloading, cutting and rendering.

> **Status:** early development (v0.1). Things change quickly.

## Features

- **Import** video and audio files from your PC (button, `Ctrl+O`, or drag them onto the
  window). Imported files work offline.
- **Fetch links** from YouTube and the many other sites yt-dlp supports, and choose the
  source quality.
- **Timeline tracks**, as in CapCut:
  - **Video 1** is the main track. Its clips play back to back.
  - **Video 2 and up** hold picture-in-picture clips, with a size and position.
  - **Audio** tracks hold music and voice-overs.
  - **Text** holds titles and captions, with size, colour and position.
- **Edit:** drag clips to move them, drag their edges to trim, split at the playhead (`S`),
  delete, and undo/redo. Edges snap to the playhead and to other clips.
- **Per clip:** volume, mirror and reverse.
- **Live preview** of the whole timeline, including picture-in-picture and text, with sound
  in sync, plus a full-screen view (`F`).
- **Export** to MP4 or MKV, or audio only (MP3, WAV, FLAC), in 16:9, 9:16 (Shorts/Reels),
  1:1 or 4:3. Exports run in a queue at the bottom, so you can keep editing.
- **Collapsible side panels** (`Ctrl+B` for the left, `Ctrl+Alt+B` for the right).

### How export works

- **One clip, untouched:** Craftora uses the fast path.
  - Links: yt-dlp downloads only that section.
  - Files on your PC: FFmpeg copies the section without re-encoding.

  **Fast** keeps the original quality, but the start snaps to a keyframe. **Precise** is
  frame-accurate and re-encodes.
- **Anything more** (several clips, tracks, text, volume, mirror or reverse): Craftora
  renders the whole timeline in a single FFmpeg pass. For links, yt-dlp first downloads just
  the parts the timeline uses.

Open **Command that will run** in the Export panel to see the exact commands.

## Requirements (Windows)

| Tool | Why | Install |
|---|---|---|
| [Bun](https://bun.sh) | Installs packages and runs scripts | `winget install Oven-sh.Bun` |
| [Rust](https://rustup.rs) | Builds the Tauri backend | `winget install Rustlang.Rustup` |
| Visual Studio Build Tools, with **Desktop development with C++** | The C++ compiler and Windows SDK that Rust needs | `winget install Microsoft.VisualStudio.2022.BuildTools` (tick the C++ workload) |
| WebView2 | Draws the interface | Already part of Windows 10/11 |

Open a **new** terminal after installing so it picks up the new tools.

## Getting started

```powershell
git clone https://github.com/Cchheanglim/Craftora.git
cd Craftora
bun install

# Download yt-dlp and FFmpeg (≈ 200 MB, checksum-verified) into src-tauri/bin/
powershell -ExecutionPolicy Bypass -File scripts/fetch-sidecars.ps1

# Run the desktop app with live reload
bun tauri dev
```

The first `bun tauri dev` compiles the Rust side, which takes a few minutes. Later runs
are quick.

To update yt-dlp (sites change often), run `scripts/fetch-sidecars.ps1 -Force`.

### Browser preview

`bun run dev` serves the interface at <http://localhost:1420> for working on the UI in a
normal browser. That mode has no access to your files or the engines, so it runs a demo
project and simulates exports.

### Building an installer

```powershell
bun tauri build
```

The `.exe` (NSIS) and `.msi` installers end up in
`src-tauri/target/release/bundle/`. Exported videos are saved to `Videos\Craftora`.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Space` | Play / pause |
| `S` | Split at the playhead |
| `Delete` | Delete the selected clip |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `I` / `O` | Trim the selected clip's start / end to the playhead |
| `T` | Add text at the playhead |
| `←` / `→` | Step one frame (`Shift`: one second) |
| `F` | Full-screen preview (`Esc` to leave) |
| `Ctrl+O` | Import files |
| `Ctrl+Enter` | Add to the export queue |
| `Ctrl+B` / `Ctrl+Alt+B` | Collapse the left / right panel |

## Project structure

```
src/                      React + TypeScript interface (plain CSS)
  project/                The editing model
    model.ts              Media, tracks, clips
    actions.ts            Every edit as a named action (add, move, trim, split, delete…)
    useProject.ts         Project state with undo/redo
    usePlayback.ts        The timeline clock
    exportPlan.ts         Fast cut vs full render, sizes and command preview
  components/             Toolbar, Sidebar (media), Preview, TimelineEditor,
                          Inspector, ExportPanel, QueueDock, Home, Library
  lib/engine.ts           Bridge to the Rust commands
  state/useQueue.ts       The export queue
  styles/                 Design tokens and shared controls (see DESIGN.md)
src-tauri/                Rust (Tauri 2)
  src/media.rs            Fetch: yt-dlp --dump-json → formats and preview
  src/local.rs            Open files: ffprobe, offline
  src/jobs.rs             Queue plumbing, progress, cancelling, fast single cuts
  src/project.rs          Timeline render: one FFmpeg filter graph
  bin/                    yt-dlp and FFmpeg (downloaded, not committed)
scripts/fetch-sidecars.ps1
PRODUCT.md                What Craftora is for and its principles
DESIGN.md                 The visual system
```

**Security:** the interface never builds command lines. It sends structured requests, and
Rust checks them and builds every yt-dlp and FFmpeg argument itself. FFmpeg only reads
files you have opened in Craftora.

## Roadmap

- **AI editing assistant.** It describes an edit in words and applies it through the same
  named actions you use, with undo. The action layer in `src/project/actions.ts` is
  designed for this.
- Save and reopen projects, and keep export history between sessions.
- Choose the save folder.
- Clip speed, fades and transitions.
- Before a public release: code signing, auto-updates and the licence review below.

## Licences

Craftora is [MIT-licensed](LICENSE). The bundled engines have their own licences:

- **yt-dlp:** [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE) (public domain).
- **FFmpeg:** the default download is a **GPL** build from
  [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), which includes libx264. If
  you distribute Craftora with it, you must follow the GPL for FFmpeg, including providing
  or linking its source. `FFMPEG-LICENSE.txt` is copied next to the binaries. An LGPL build
  can be fetched with `-FfmpegBuild ffmpeg-n9.0-latest-win64-lgpl-9.0`, but it has no
  libx264.

Only download content you have the right to. Respect each site's terms of service.
