# Handoff: where Craftora stands

Rewritten 2026-10-16 for a fresh Claude Code session; it replaces the earlier session notes.
Read this first, then `README.md` (features, setup), `CHANGELOG.md` (what each version added),
`RELEASING.md` (how to ship) and, for UI work, `PRODUCT.md` and `DESIGN.md`.

## The owner

- New to desktop apps, React and Rust. Explain plainly and briefly, without jargon. Their
  messages are short and informal; work out what they mean and ask (AskUserQuestion with
  options works well) when it's really unclear.
- **Commits and merges themselves.** Don't commit unless asked. Work happens on the `Building`
  branch; they merge into `main` with GitHub pull requests.
- Wants Craftora to feel like a simple **CapCut**. Calls stacked media "tracks". Plain CSS, no
  Tailwind. Design rules: sharp near-square corners, no pill buttons, no purple or decorative
  gradients, no cursor or scroll effects, a dense dark utility look.
- PC: Windows 11 laptop, NVIDIA RTX 3050 Laptop GPU plus Intel UHD. Bun isn't always on `PATH`
  in old terminals: `C:\Users\chhea\AppData\Local\Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun-windows-x64\bun.exe`.
- They often have `bun tauri dev` running. It holds port 1420 (use that for the browser demo)
  and locks `src-tauri/target/debug/*.exe`; check Rust with
  `CARGO_TARGET_DIR=target/check cargo clippy` so the build doesn't fail with "Access is denied".

## Status (2026-10-16)

- **v0.1.0** is published on GitHub Releases. **v0.2.0** was built by GitHub Actions (green) as a
  **draft**; the owner was about to paste the 0.2.0 changelog and publish it. Then their
  installed 0.1.0 should offer "Update to v0.2.0": the first real auto-update test.
- **Microsoft Store:** 0.1.0 (MSIX) was submitted for certification on 2026-10-15 and is
  waiting. Identity: `Cchheanglim.Craftora` (`src-tauri/msix/store-identity.json`). When it
  passes, upload 0.2.0 built with `scripts/make-msix.ps1`. Risk: Store policy 11.2 (copyright
  complaints about YouTube downloading); fallback, a Store edition without link fetching.
- **Code signing:** SignPath Foundation turned the project down. GitHub installers are unsigned
  (SmartScreen warning). Options in `RELEASING.md` → "Code signing" (Store, or a Certum
  certificate at about $50 a year). Azure Artifact Signing is only for individuals in the US
  and Canada.
- Open GitHub issue **#15** ("Bugs") was addressed by 0.2.0; it could be closed with a comment
  once the owner confirms.
- **Not yet tried in the real app window:** the link cache (WebView2 plus the `cmedia` custom
  scheme), importing images, a real "Download first" swap to the local file, and the
  NVENC export run from the app (it was tested by hand with FFmpeg).

## What Craftora is (code map)

A Tauri 2 desktop video editor. React and TypeScript UI; Rust backend; bundled yt-dlp and
FFmpeg (GPL build from BtbN) run as sidecars.

**UI (`src/`)**
- `project/model.ts`: media, tracks, clips. Every track kind (video, audio, text) can be
  repeated; any track can be `magnetic` (clips back to back, needed for transitions).
  A video clip's `size` scales the "fit" size (1 = fills the frame as far as its shape allows);
  `x`/`y` are fractions of the free space. Images are media with `source.image` (no length
  limit, default 5 s). `upgradeProject` migrates old saves (old `main` track → magnetic).
- `project/actions.ts`: **every edit is a named action** (`applyEdit`), used by the UI and the
  AI. Includes `addTrack`, `removeTrack`, `setMagnetic`, `setTransition`, `setSpeed`.
  `useProject.ts` adds undo/redo plus `commit` (several AI edits as one undo step),
  `reset` and `refreshMedia`.
- `project/exportPlan.ts`: a single untouched clip uses the fast path (yt-dlp section or
  stream copy); anything else becomes a `RenderSpec` (clips with `layer`, transitions in/out,
  `quality`).
- `project/usePlayback.ts`: the timeline clock. It holds while any on-screen media is loading
  (`setLoading`; 8 s cap). `components/SyncedMedia.tsx` keeps each element on the clock
  without stacking seeks.
- `components/`: `Preview` (move and resize pictures and text on the preview), `TimelineEditor`
  (drag, trim, scrub, **+ Track**, per-track magnet and remove), `Inspector`, `ExportPanel`
  (Fast or Best quality, save folder), `AssistantPanel`, `FetchChoice` (after Fetch: edit now
  or download first), `ConfirmDialog` (`useConfirm`, only for actions that can't be undone),
  `Home` (projects, About and updates), `QueueDock`, `Sidebar` (media, download button).
- `assistant/`: Gemini editing assistant. `tools.ts` (timeline description with short ids
  c1/m1/t1, one tool per action), `conversation.ts` (`runTurn`, shared by the hook and tests),
  `reliable.ts` (retry on 503, fall back through stable Flash models, plain-language errors),
  `useAssistant.ts` (hook; `recommendedModels`, `fallbackModels`).
- `lib/engine.ts` (Rust bridge), `lib/storage.ts` (projects, history, save folder),
  `lib/updates.ts` (Tauri updater; off in the Store edition via `VITE_STORE_BUILD=1`).

**Rust (`src-tauri/src/`)**
- `project.rs`: timeline render in one FFmpeg pass. **One input per clip** (`-ss`/`-t`, or
  `-loop 1` for images); each picture is scaled, alpha-faded (fades and transitions are alpha
  ramps) and overlaid on a black base by `layer`; drawtext for text; sounds via
  `afade`/`adelay`/`amix`.
- `encoders.rs`: tests NVENC, then QSV, then AMF at startup; "Fast" uses hardware (falls back to
  x264 if it fails), "Best" uses x264 slow. The RTX 3050 encodes 1 min of 1080p in about 6 s.
- `jobs.rs`: queue plumbing, yt-dlp downloads (section progress comes from FFmpeg
  `out_time_us`), fast single cuts, **safe delivery** (`work_dir` `.craftora-<id>`, then
  `deliver` claims a free name with `create_new`; unit test), cancel kills the process tree,
  `download_media` ("Download first" → `Videos\Craftora\Downloads`).
- `media_cache.rs`: link previews play from `http://cmedia.localhost/<id>` (async URI scheme).
  Range requests are served from a sparse cache file, or fetched in 1 MB pieces;
  `prefetch_media` fills it (emits `media-cache` progress). Unit test, plus an ignored live test.
- `local.rs`: open files with ffprobe; preview copies for formats WebView2 can't play
  (`make_preview`); still-image detection.
- `media.rs` (fetch links), `store.rs` (projects, history, settings JSON in `%APPDATA%`),
  `assistant.rs` (Gemini key in Windows Credential Manager; `assistant_models`,
  `assistant_generate`; errors as `HTTP <code>: <message>`), `engine.rs` (sidecars).

## Running and checking

```powershell
bun tauri dev                    # the desktop app, with live reload
bun run dev                      # browser demo at http://localhost:1420 (simulated exports)
bun x tsc --noEmit -p .          # type check
cd src-tauri; $env:CARGO_TARGET_DIR="target/check"; cargo clippy; cargo test --lib
cargo test --lib -- --ignored live_cache   # live cache test against archive.org
```

- **FFmpeg filter graphs** are checked by hand: generate test media with `lavfi`
  (`testsrc2`, `smptebars`, `sine`), build the same graph strings `project.rs` makes, render
  with `src-tauri/target/release/ffmpeg.exe`, and look at frames.
- **AI live tests:** the owner's Gemini key is in `.env` as a single line, `gemini key = …`.
  `.env` is gitignored. A Bun script may read it and call the API, but **never print or copy
  the key** (copying credentials to the clipboard was blocked by a safety check). Free tier:
  Flash models work; `gemini-4-argon` has a free limit of 0; 503 "high demand" is common.
- **Browser tests:** Claude in Chrome works when the extension is connected. HTML5
  drag-and-drop needs JS-dispatched `DragEvent`s; pointer drags need dispatched `PointerEvent`s.
- **GitHub API** (no auth) allows 60 requests an hour, so poll slowly (about 2 minutes);
  `gh` isn't installed.
- **Shell quirk:** long `python - <<'EOF'` heredocs sometimes break in this Bash tool, and
  `\\` turns into `\`. Write patch scripts to the scratchpad and run them with `python file.py`.

## Releasing (summary of `RELEASING.md`)

1. Bump the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`,
   and add a `CHANGELOG.md` section.
2. The owner commits and merges into `main`. Tag `main` (`git tag -a vX.Y.Z origin/main`) and
   push the tag.
3. `.github/workflows/release.yml` checks the secrets, builds the NSIS installer, signs the
   update (with `--app-version`), writes `latest.json` (no BOM), attaches the FFmpeg source and
   creates a **draft**. The owner publishes it.
4. The update key is in `C:\Users\chhea\.tauri\` (never commit or print it); the GitHub
   secrets `TAURI_SIGNING_PRIVATE_KEY` and `..._PASSWORD` are set.

## Known limitations

- Reverse plays choppy and silent in the preview (browsers can't play backwards); the export
  is right.
- A spot in a link that isn't cached yet still waits for the internet once. The cache's map is
  lost on restart (the file is cleared).
- Preview copies of long, unusual local files (AVI, HEVC…) take a while to make.
- The AI can't see or hear the media (no "cut the silences").
- `DESIGN.md` doesn't describe the newer UI (track header buttons, dialogs, assistant panel,
  fetch window). Refresh it with `/impeccable document`.
- About 460 MB of leftovers from 0.1.0 sit in `Videos\Craftora` (`*.part` files and a hidden
  `.craftora-*` folder). The owner was asked whether to delete them and hasn't answered.

## Ideas the owner may ask for next

- Let the AI hear the media (find silences or highlights), probably with an audio-analysis
  step.
- Keep the link cache's map across restarts; show cached parts on the timeline.
- Code signing for GitHub downloads; the Store edition once certified.
- Close issue #15 after the owner confirms 0.2.0 works.
