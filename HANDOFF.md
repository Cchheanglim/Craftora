# Handoff: where Craftora stands

Written 2026-10-14 to start a fresh Claude Code session. Read this first, then `README.md`
(features, setup, structure), `PRODUCT.md` (purpose and principles) and `DESIGN.md` (visual
system).

## About the owner

- New to desktop apps, React and Rust. Explain things plainly and briefly.
- Commits to git themselves. Don't commit unless asked.
- Wants Craftora to work like a simple **CapCut**: calls stacked media **"tracks"**, not
  layers. Uses plain CSS, not Tailwind.
- Plans to add an **AI editing assistant** later.

## What's built (all committed, up to `1f5a62f`)

- **Toolchain** on this PC: Bun, Rust, MSVC Build Tools, WebView2. yt-dlp 2026.08.19 and
  FFmpeg 9.0.2 GPL are in `src-tauri/bin/`, fetched with `scripts/fetch-sidecars.ps1` and
  gitignored.
- **CapCut-style editor:**
  - Home screen.
  - Media library: import files (also offline) or fetch links.
  - Timeline with Video 1 (main, clips back to back), Video 2+ (picture-in-picture), Audio
    and Text tracks.
  - Move, trim, split, delete, undo/redo, snapping, zoom.
  - Inspector: volume, mirror, reverse, size and position, text and colour, source quality.
  - Synced live preview, with separate sound streams for YouTube.
  - Full-screen preview, collapsible side panels, export queue, keyboard shortcuts.
- **Export:**
  - A single untouched clip takes the fast path in `src-tauri/src/jobs.rs`: a yt-dlp
    section download, or an FFmpeg stream copy.
  - Anything else is one FFmpeg render in `src-tauri/src/project.rs`.
- **Built for the AI assistant:** every edit is a named action in `src/project/actions.ts`,
  applied through `useProject` with undo/redo. An AI assistant should dispatch these same
  actions.

## Not verified yet (do this first)

- **The new editor has not been used in the real app window.** The checks so far:
  - TypeScript and Rust compile cleanly, and the design detector is clean.
  - The browser demo mode was screenshotted at 1440×900 and 1100×700.
  - The FFmpeg filter graphs were tested by hand on generated files: join, overlay,
    drawtext, amix, mirror, local cut and MP3.
- **Not tested end to end:**
  - `start_render` from the app.
  - Rendering a timeline that uses a **link**, which goes through yt-dlp `DownloadTarget::Any`
    with `--force-keyframes-at-cuts`.
  - Dragging clips between tracks.
  - Drag-and-drop import.
  - Full-screen via `setWindowFullscreen`.
  - `Ctrl+B` panel toggles.
- **Owner's test list:**
  1. Import two videos and a song.
  2. Drop one video on Video 2 and set it to Small, Top right.
  3. Press `T` for a title and change its text and colour.
  4. Press `S` to split and `Delete` to remove, then `Ctrl+Z`.
  5. Press `F`, then `Esc`.
  6. Add to queue and open the result.

## Known limitations and bugs

- **Reverse** isn't previewed: it plays forward with a badge. The export is reversed.
- Previews of local files whose audio is AC-3, E-AC-3 or DTS may be silent in WebView2. This
  isn't handled yet; the export is unaffected.
- **Not saved anywhere yet:** projects, export history (in memory only) and the
  panel-collapse state (in localStorage).
- **The output folder is fixed** at `Videos\Craftora`.
- Main-track clips reorder by dragging, but the clip jumps as it passes its neighbours.
- `DESIGN.md` doesn't yet document the timeline clip colours (`--clip-*` tokens) or the
  Home layout. Run `/impeccable document` (or the documenter) to refresh it.

## Next steps the owner asked for, or that are planned

1. Have the owner test, then fix what they report.
2. Save and reopen projects, and keep export history (Tauri store plugin).
3. Let the owner choose the save folder (dialog plugin is already installed).
4. Clip speed, fades and transitions.
5. AI editing assistant, built on `actions.ts`.
6. Before a public release: code signing, auto-updates, an FFmpeg licence decision
   (GPL or LGPL), and user terms.

## Running it

```powershell
bun tauri dev        # desktop app with live reload (needs a new terminal after installs)
bun run dev          # browser demo mode at http://localhost:1420 (simulated exports)
```

If `bun` isn't found in an old terminal, its full path is
`C:\Users\chhea\AppData\Local\Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun-windows-x64\bun.exe`.
