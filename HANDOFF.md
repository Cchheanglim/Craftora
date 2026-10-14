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

## What's built (all committed, up to `1f5a62f`, plus the second session below)

- **Toolchain** on this PC: Bun, Rust, MSVC Build Tools, WebView2. yt-dlp 2026.08.19 and
  FFmpeg 9.0.2 GPL are in `src-tauri/bin/`, fetched with `scripts/fetch-sidecars.ps1` and
  gitignored.
- **CapCut-style editor:**
  - Home screen with a saved-projects list.
  - Media library: import files (also offline) or fetch links.
  - Timeline with Video 1 (main, clips back to back), Video 2+ (picture-in-picture), Audio
    and Text tracks.
  - Move, trim, split, delete, undo/redo, snapping, zoom, a draggable playhead.
  - Inspector: crop, speed, fades, volume, mirror, reverse, size and place, text and
    colour, source quality.
  - Synced live preview, with separate sound streams for YouTube. Picture-in-picture and
    text are moved and resized directly on the preview.
  - Full-screen preview, collapsible side panels, export queue, keyboard shortcuts.
- **Export:**
  - A single untouched clip takes the fast path in `src-tauri/src/jobs.rs`: a yt-dlp
    section download, or an FFmpeg stream copy.
  - Anything else is one FFmpeg render in `src-tauri/src/project.rs`.
- **Built for the AI assistant:** every edit is a named action in `src/project/actions.ts`,
  applied through `useProject` with undo/redo. An AI assistant should dispatch these same
  actions.

## Second session (2026-10-14)

The owner reported that Video 2 couldn't be moved or cropped and that the playhead couldn't
be dragged. Fixed, along with the known issues and next steps 2–4:

- **Preview editing** (`Preview.tsx`): select a picture-in-picture or text on the preview,
  drag it to move it (snaps to centre and edges), and drag a corner to resize it. Positions
  are now free `x`/`y` fractions of the free space; `POSITIONS` are presets.
- **Crop** for any picture clip (four Inspector sliders), previewed and rendered alike.
- **Playhead**: a wide grab strip, plus drag-to-scrub on the ruler and on empty track space.
  Drags follow the pointer on `window`, so they survive clips changing track.
- **Video 1 reorder without jumps**: the dragged clip follows the pointer and its neighbours
  open a gap. The project changes only on release (`moveClip` with `mainSlot`).
- **Speed** 0.25–4× (`setSpeed`; `setpts` and chained `atempo`) and **fades** in/out
  (`fade`, `afade`, alpha fades for picture-in-picture, an alpha expression for text).
  `clipLength` is now `(out − in) / speed`. Trim and split handle speed and reversed clips.
- **Reverse preview**: steps backwards by seeking (choppy, silent). The export is smooth.
- **Preview copies** (`local.rs` `make_preview`): AC-3/DTS sound gets an AAC copy. AVI,
  HEVC and others get a 720p H.264 copy. They're made in the background and cached in the
  app cache folder.
- **Saving** (`store.rs`, `src/lib/storage.ts`): projects autosave to
  `%APPDATA%\com.cchheanglim.craftora\projects\<id>.json`. Export history goes to
  `history.json`, and the chosen save folder to `settings.json`. Reopening re-opens local
  files (marking missing ones) and re-fetches links, whose preview URLs expire.
  `upgradeProject` fills in fields older saves lack.
- **Save folder**: "Change" next to Save to in the Export panel.
- **Checked:** `tsc` and `cargo clippy` are clean. A render with crop, speed, reverse,
  fades, alpha overlay and text fade was run by hand on generated files, and so were both
  preview-copy commands. In the browser demo, these were driven: playhead drag,
  picture-in-picture move, resize and crop, Video 1 reorder, text move, speed, fades, and
  autosave with reopen. **Not yet run in the real app window.**

## Third session (2026-10-14)

- **Transitions** on Video 1: Crossfade or Dip to black into a clip (Inspector, "Transition from
  the clip before"). The clips overlap by the transition (`transitionLength` caps it at half
  of either clip). The preview mixes them live (`transitionMix`); the export chains
  `xfade`/`acrossfade` (straight cuts use pairwise `concat`), with every main segment padded
  or trimmed to its exact length. Tested by hand: crossfade + dip render, 10.0 s exactly.
- **AI editing assistant** (right panel, "Assistant" tab), using **Gemini** (the owner's choice)
  through the **Interactions API** (`POST v1beta/interactions`, stateful with
  `previous_interaction_id`). Models: `gemini-3.8-flash` (default), `gemini-4-argon`.
  - `src-tauri/src/assistant.rs`: the API key lives in Windows Credential Manager (`keyring`)
    and Rust makes the HTTPS call (`reqwest`), so the key never reaches the web page.
  - `src/assistant/tools.ts`: the timeline description sent with each message (short ids
    c1/m1/t1) and one tool per edit action; `useAssistant.ts` runs the tool-call loop (at most
    8 rounds) and commits each message's edits as one undo step (`useProject.commit`).
  - Checked: the tools on a sample project in Bun, and the keyring round trip. **Not yet run
    against the real Gemini API** (no key here); errors from Gemini are shown in the chat.
- A "Loading video…" note while a preview video's first frame loads.

## Fourth session (2026-10-14), not committed yet: releases

The owner chose: **keep the GPL FFmpeg build**, and **release through GitHub with free
SignPath Foundation signing**. They'll do the sign-ups themselves.

- `.github/workflows/release.yml`: on a `v*` tag, builds the NSIS installer from source and
  signs it with SignPath. Signing runs only once the `SIGNPATH_*` variables exist; until then
  the installer is unsigned. It then re-signs the update with `--app-version`
  (`requireSignedVersion` is on) and writes `latest.json`. It attaches the exact FFmpeg source
  and BtbN build scripts, and creates a **draft** release. Running it by hand makes a test
  build only.
- Auto-updates: `tauri-plugin-updater` and `tauri-plugin-process`. The endpoint is
  `releases/latest/download/latest.json`. `src/lib/updates.ts` checks once at startup
  (installed builds only; can be turned off on Home > About), and the toolbar shows
  "Update to vX".
- The update key was generated in `C:/Users/chhea/.tauri/` (private key, password file,
  public key). The public key is in `tauri.conf.json`. The owner must add two GitHub secrets
  (see `RELEASING.md`).
- GPL and SignPath paperwork: `THIRD_PARTY_NOTICES.md`; `CODE_SIGNING.md` (SignPath's
  required line, team roles, privacy policy covering links, the assistant and update checks);
  licence files bundled into the installer under `licenses/`. The README has a Download
  section and an up-to-date roadmap.
- `RELEASING.md`: one-time setup (secrets, two-factor authentication, the SignPath
  application, the artifact configuration XML, variables) and the steps for each release.

## Known limitations

- The reverse preview is choppy and silent while playing (browsers can't play backwards).
- Preview copies of long videos take a while; the clip shows nothing until its copy is ready.
- The owner saw local imports take 4–11 s to appear in the preview. No preview copy was made,
  so the cause isn't known yet (debug build, file size or format?). Investigate with the file.
- The assistant can't see or hear the media (no "cut the silences" yet).
- Text resizing on the preview scales the font roughly with the box.
- `DESIGN.md` doesn't yet document the clip colours, Home layout, preview handles or the
  assistant panel. Run `/impeccable document` to refresh it.

## Next steps

1. Owner tests transitions and the assistant (needs a Gemini API key from Google AI Studio).
2. Find why local imports are slow to appear in the preview.
3. Owner: add the GitHub secrets, publish v0.1.0 (unsigned), apply to SignPath Foundation,
   then set the SignPath variables (all in `RELEASING.md`).

## Running it

```powershell
bun tauri dev        # desktop app with live reload (needs a new terminal after installs)
bun run dev          # browser demo mode at http://localhost:1420 (simulated exports)
```

If `bun` isn't found in an old terminal, its full path is
`C:\Users\chhea\AppData\Local\Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun-windows-x64\bun.exe`.
