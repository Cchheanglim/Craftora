# Handoff: where Craftora stands

Updated 2026-10-22 for a fresh Claude Code session. Read this first, then `README.md`
(features, setup), `CHANGELOG.md` (what each version added), `RELEASING.md` (how to ship) and,
for UI work, `PRODUCT.md` and `DESIGN.md`.

## The owner

- New to desktop apps, React and Rust. Explain plainly and briefly, without jargon. Their
  messages are short and informal; work out what they mean and ask (AskUserQuestion with
  options works well) when it's really unclear. They call downloading "installing" and
  exporting "encoding".
- **Commits and merges themselves**, often mid-session. Don't commit unless asked. Work happens
  on the `Building` branch; they merge into `main` with GitHub pull requests.
- Wants Craftora to feel like a simple **CapCut**. Calls stacked media "tracks". Plain CSS, no
  Tailwind. Design rules: sharp near-square corners, no pill buttons, no purple or decorative
  gradients, no cursor or scroll effects, a dense dark utility look. Exceptions they chose:
  icon-only buttons are round glass circles (`.btn--icon`), and the logo is a glossy black cat
  with a red collar biting a pen (masters `docs/logo.svg` and `docs/logo.png`, regenerate the app
  icons with `bun tauri icon docs/logo.png`; style references in
  `Refer/`, gitignored). The app opens at 110% zoom (`set_zoom` in `lib.rs`).
- **Hates friction**: anything that makes them close their browser, answer a question window or
  click an extra button is a dealbreaker ("I will stop using it"). Prefer automatic behaviour.
- They tested fetching against an unlicensed drama-streaming site and an adult video site. We
  declined to test against or tune Craftora for those sites, and built general features instead
  (verified with a local "strict" test server, see below). Keep doing that.
- PC: Windows 11 laptop, NVIDIA RTX 3050 Laptop GPU plus Intel UHD, Edge/WebView2 155. Bun isn't
  always on `PATH` in old terminals:
  `C:\Users\chhea\AppData\Local\Microsoft\WinGet\Packages\Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe\bun-windows-x64\bun.exe`.
- They often have `bun tauri dev` running. It holds port 1420 and locks
  `src-tauri/target/debug/*.exe`; check Rust with `CARGO_TARGET_DIR=target/check cargo clippy`.
  **After `bun add`, their running dev server answers 504 "Outdated Optimize Dep" for the new
  package and the app window goes blank: tell them to restart `bun tauri dev`.**

## Status (2026-10-22)

- **v0.3.0 is prepared, not released:** version bumped in `package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `Cargo.lock`; `CHANGELOG.md`,
  `README.md`, `PRIVACY.md` (sign-in window, pictures, Update yt-dlp, IP) and
  `THIRD_PARTY_NOTICES.md` (hls.js, Apache-2.0) updated. A production `vite build` was checked:
  no test or private links ship; demo data (three archive.org Blender films) is only used by the
  browser preview (`inDesktopApp` gates every use in `App.tsx`). Next: the owner commits, merges,
  tags `v0.3.0`, and **publishes the workflow's draft** (see Releasing). Not yet done: a full
  release build and test install with the new yt-dlp folder and hls.js.
- **GitHub releases:** v0.1.0 and v0.2.0 are published. The first v0.2.0 release was made by hand
  with no files; the owner was told to delete it and publish the build's draft instead. A stray
  tag **v1.0.0** points at an old commit; suggest deleting it. Not confirmed either was done.
- **Microsoft Store:** 0.1.0 (MSIX) was submitted on 2026-10-15. Identity `Cchheanglim.Craftora`
  (`src-tauri/msix/store-identity.json`). `scripts/make-msix.ps1` now copies the `yt-dlp` folder
  (untested). Risk: Store policy 11.2 (copyright complaints about downloading).
- **Code signing:** none (SignPath declined). Options in `RELEASING.md` → "Code signing".
- **Open questions:** "two videos together play no sound" was never reproduced (may have been the
  old 8 s give-up in the clock); DASH (`.mpd`) links fail ("no known length") and can't preview.

### Done on 2026-10-21/22 (all committed except the release prep)
- **Fetching:** a fetched link goes straight onto the timeline (the edit-or-download window was
  removed); if nothing previews (`previewUrl` empty) it also downloads. Fetch **History** in the
  sidebar (localStorage `craftora.fetchHistory`), thumbnails everywhere (`Thumb`,
  `lib/thumbnail.ts`; site picture, or a JPEG of a local file's frame). Paste button, sample
  links and Home's shortcuts list removed. "Update yt-dlp" button (hidden in the Store edition).
- **Logins** (`signin.rs`): Craftora's own sign-in window (label `sign-in`, shares the app's
  WebView2 cookie store). Its menu bar **Fetch this video** reads the page with `FIND_MEDIA`
  (video elements, `.m3u8/.mpd/.mp4` resources, iframes, og:image) and sends `fetch-page`;
  `tell_sign_in` shows a "Sent to Craftora" banner. Each yt-dlp run gets the cookies as a
  temporary cookies.txt (`link_args`, deleted after). A user-picked cookie file was removed
  (confusing). Borrowing a
  browser's logins was removed (Brave/Chrome lock their cookie DB while open). Errors offer
  "Sign in to <site>" / "Find the video on the page" (`pageAction` in `App.tsx`).
- **Pages that need their Referer:** a link can carry `#craftora-referer=<page>`
  (`REFERER_MARK`); `link_args` turns it into `--referer`, `media_cache` sends it, and
  `fetch_media` also takes the Referer yt-dlp reports in `http_headers`.
- **Stream previews:** HLS-only links preview (`preview_hls`, master playlist). WebView2 plays HLS
  natively from its real address but **refuses it from the `cmedia` scheme**, so streams that need
  a Referer play with **hls.js** through the relay (`http://cmedia.localhost/hls?u=…`, rewrites
  every playlist address). `probe_length` asks FFprobe when yt-dlp reports no length.
- **Speed:** yt-dlp ships as its **unpacked build** (`bin/yt-dlp/` folder, a Tauri resource, run
  via `engine::command`): ~1 s per run instead of ~4 s (28 s first run); a YouTube fetch went
  12.4 s → 3.4 s. Precise section downloads re-encode with the hardware encoder (60 s of 1080p:
  57 s → 19 s). One reused HTTP client in `media_cache`. (`--concurrent-fragments 4` was tried and
  removed: servers refused it intermittently.)
- **Editing:** Media → timeline drag rewritten with pointer events (`mediaDrag`,
  `beginMediaDrag`): Tauri on Windows swallows HTML5 drag-and-drop in the app. Videos can go on
  audio tracks (`fitsTrack`, tested in `tests/actions.test.ts`). The clock now waits for loading
  media with no cap, reports `slow` after 8 s, and media that fails (`onFailed`) is dropped with a
  "can't play in the preview" message.
- **Security review:** the `cmedia` scheme answered every window, so a website in the sign-in
  window could use the relay to read the user's LAN/localhost (confirmed with a dummy secret, then
  fixed: only `webview_label() == "main"`). FFprobe's Referer header strips line breaks. Safe as
  checked: `--` before every link, `safe_stem` file names, IPC limited to `main`, key in Credential
  Manager, signed updates, no telemetry.

## What Craftora is (code map)

A Tauri 2 desktop video editor. React and TypeScript UI; Rust backend; bundled yt-dlp (unpacked
folder, resource) and FFmpeg/FFprobe (GPL build from BtbN, sidecars).

**UI (`src/`)**
- `project/model.ts`: media, tracks, clips. Every track kind (video, audio, text) can be
  repeated; any track can be `magnetic`. Images are media with `source.image`.
  `upgradeProject` migrates old saves.
- `project/actions.ts`: **every edit is a named action** (`applyEdit`), used by the UI and the AI.
  `fitsTrack` says which clips may sit on which tracks. `useProject.ts` adds undo/redo, `commit`,
  `reset` and `refreshMedia`.
- `project/exportPlan.ts`: one untouched clip uses the fast path; anything else is a `RenderSpec`.
  Clips on audio tracks are sound only (`role: "audio"`).
- `project/usePlayback.ts`: the timeline clock; holds while on-screen media loads; `slow` flag.
  `components/SyncedMedia.tsx` keeps each element on the clock, runs hls.js for relay URLs and
  reports `onFailed`.
- `components/`: `Preview`, `TimelineEditor` (drag, trim, scrub, + Track; `mediaDrag`),
  `Inspector`, `ExportPanel`, `AssistantPanel`, `ConfirmDialog` (`useConfirm`: delete project,
  cancel export, clear history, sign out of all, AI key), `Home` (projects, recent exports,
  Links: sign-in, "Is this link safe?", Update yt-dlp; About; Recent exports can be hidden),
  `QueueDock`, `Sidebar` (media, History),
  `Thumb`, `Toolbar` (link box, Fetch, error action button).
- `assistant/`: Gemini editing assistant (`tools.ts`, `conversation.ts`, `reliable.ts`,
  `useAssistant.ts`).
- `lib/engine.ts` (Rust bridge; `fetchMedia` turns previews into cache, relay or direct URLs),
  `lib/storage.ts` (projects, export history, fetch history, save folder), `lib/thumbnail.ts`,
  `lib/updates.ts` (Tauri updater; off in the Store edition via `VITE_STORE_BUILD=1`).

**Rust (`src-tauri/src/`)**
- `project.rs`: timeline render in one FFmpeg pass (one input per clip, alpha fades, overlay by
  `layer`, drawtext, `amix`).
- `encoders.rs`: NVENC, then QSV, then AMF; "Fast" uses hardware, "Best" x264 slow.
- `jobs.rs`: queue, yt-dlp downloads (`download`, `link_args`), fast single cuts, safe delivery
  (`work_dir`, `deliver`; unit test), `download_media` ("Download first").
- `media_cache.rs`: previews from `http://cmedia.localhost/<id>` (sparse cache, 1 MB pieces,
  `prefetch_media`) and the HLS relay `…/hls?u=` (`relay_playlist`; unit test). Main window only.
- `media.rs`: `fetch_media` (yt-dlp JSON → formats, preview choice, `hls_preview`,
  `probe_length`). `signin.rs`: sign-in window, cookies, `REFERER_MARK`, `FIND_MEDIA`.
- `local.rs` (open files, preview copies), `store.rs` (projects, history, settings),
  `assistant.rs` (Gemini key in Credential Manager), `virustotal.rs` ("Is this link safe?":
  website reputation from VirusTotal with the project's key, built in from `CRAFTORA_VT_KEY`, a
  GitHub secret `VIRUSTOTAL_API_KEY` in the release build; hidden when absent), `engine.rs` (`command`,
  engine status, `update_yt_dlp`).

## Running and checking

```powershell
bun tauri dev                    # the desktop app, with live reload
bun run dev                      # browser demo at http://localhost:1420 (simulated exports)
bun x tsc --noEmit -p .          # type check
bun test tests/                  # UI logic tests (outside src/, so tsc doesn't need Bun types)
cd src-tauri; $env:CARGO_TARGET_DIR="target/check"; cargo clippy --all-targets; cargo test --lib
scripts/fetch-sidecars.ps1       # yt-dlp (unpacked folder) and FFmpeg into src-tauri/bin/
```

- **Testing the real app without the owner's window:** build `CARGO_TARGET_DIR=target/check cargo
  build`, start `target/check/debug/craftora.exe` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
  --remote-debugging-port=9224` and `WEBVIEW2_USER_DATA_FOLDER=%TEMP%\craftora-test-webview`, then
  drive it over the DevTools protocol from a Bun script (set `#media-url`'s value with the native
  setter, `requestSubmit`, read `.preview__stage video` state). It needs a page server on 1420
  (the owner's or `bun run dev`). Kill only processes under `target\check`.
- **Strict test server:** a tiny Python server that answers 403 without the right `Referer`
  imitates big video sites; FFmpeg `lavfi` (`testsrc2`, `sine`) makes the MP4 and HLS files.
- **Browser preview tests:** headless Edge with `--remote-debugging-port` and a Bun CDP script
  (Claude in Chrome was usually not connected). `Input.dispatchMouseEvent` gives real pointer
  events for drags.
- **AI live tests:** key in `.env` (`gemini key = …`, gitignored). Never print or copy it.
- **Shell quirk:** long heredocs break in this Bash tool; write patch scripts to the scratchpad.

## Releasing (summary of `RELEASING.md`)

1. Bump the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`
   (and `Cargo.lock`), and add a `CHANGELOG.md` section. (Done for 0.3.0.)
2. The owner commits and merges into `main`. Tag `main` (`git tag -a vX.Y.Z origin/main`) and push.
3. `.github/workflows/release.yml` runs `fetch-sidecars.ps1`, builds the NSIS installer, signs the
   update, writes `latest.json` and creates a **draft**. **Publish that draft** (edit it, paste the
   changelog); don't create a new release by hand, or it has no files and updates break.
4. The update key is in `C:\Users\chhea\.tauri\` (never commit or print it).

## Known limitations

- Streams whose server insists on its own page *and* aren't HLS or plain files (DASH) don't
  preview; DASH links fail to fetch ("no known length").
- Big commercial video sites tie streams to sessions and tokens; when the preview can't play,
  Craftora downloads instead.
- Cookies are written as covering subdomains (the cookie crate drops the leading dot), and a
  temporary cookies.txt can survive a crash until the next fetch.
- Thumbnails of links are reloaded from their websites whenever shown (privacy note in PRIVACY.md).
- Reverse plays choppy and silent in the preview; the export is right.
- `DESIGN.md` doesn't describe the newer UI. Refresh it with `/impeccable document`.

## Ideas the owner may ask for next

- A DASH player (dash.js or shaka) like hls.js; a proxy setting for anonymity (yt-dlp `--proxy`);
  keeping thumbnails on disk so websites aren't contacted on every start.
- Find out the "two videos, no sound" report.
- Let the AI hear the media (silences, highlights).
- Code signing; the Store edition once certified.
