# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(A Tauri 2 desktop app: the interface is web UI in WebView2, packaged as a Windows `.exe`/`.msi`. Windows is the first target; the design language is not native-OS.)

## Users

- **Primary: the maker, for personal use.** Craftora starts as the owner's own tool for grabbing video or audio from a link and keeping just the part they want.
- **Later: the public.** The owner plans a public release, so anyone downloading it must be able to use it without explanation. Who that audience turns out to be is not yet known; do not invent personas.

## Product Purpose

Paste a media link, see what's available, pick the exact part you want, and save it as a clean file, optionally mirrored, reversed or audio-only. Success means getting the clip you wanted, in the quality you wanted, without touching a command line.

## Positioning

A local desktop studio that puts yt-dlp and FFmpeg behind one honest interface: fetch, trim, transform and export in a single workspace, with the real command visible for anyone who wants it. No browser extension, no ad-filled website, no upload to someone else's server.

## Operating Context

- Workflow: paste or fetch a URL → inspect available streams → set in/out points on a timeline → choose output (video/audio, quality, container, transforms, cut mode) → add to queue → find the file in the library or on disk.
- Several jobs can run at once; downloads and FFmpeg encodes take seconds to minutes, so progress must stay visible while the user prepares the next clip.
- Runs entirely on the user's PC. Output goes to a local folder (default under the user's Videos folder).
- Keyboard use is expected for trimming (play/pause, set in/out, frame step).

## Capabilities and Constraints

- Engines: bundled **yt-dlp** (fetch and download, including section-only downloads) and **FFmpeg** (trim, mirror via `hflip`, reverse, convert), run as Tauri sidecars.
- Two cut modes: **fast** (stream copy, no quality loss, start snaps to a keyframe) and **precise** (re-encode, frame-accurate, slower). Mirror and reverse always require re-encoding.
- Outputs: video (MP4, MKV) or audio only (MP3, WAV, FLAC).
- History of past jobs persists across app restarts; jobs can be re-run or reopened in the trimmer.
- Stack: React + TypeScript + Vite, Bun, Tauri 2 (Rust). Styling is **plain CSS** (chosen over Tailwind).
- Sites change often, so yt-dlp needs a way to be updated after release.
- **Open decisions before public release:** code signing (unsigned builds trigger a Windows SmartScreen warning), auto-updates, FFmpeg licence compliance for bundled binaries, and user-facing terms about what users may download.

## Brand Commitments

- Name: **Craftora**.
- Binding visual constraints from the owner: sharp, near-square corners; no pill-shaped buttons; no purple or decorative gradients; no cursor animations or scroll effects; dense, utility-style desktop layout.

## Evidence on Hand

- No users, testimonials, metrics, press or case studies exist. Do not fabricate any.
- Test media: Blender Foundation open movies (CC BY) on archive.org: Big Buck Bunny, Elephants Dream, Sintel. (Google's `gtv-videos-bucket` samples now return 403.)
- Approved layout direction: the "Craftora Workspace Redesign" mockup (https://claude.ai/artifact/32EQwSWoBoVbU5hKWKUBgv).

## Product Principles

1. **Simple by default, power one click away.** The common path (link → part → file) needs no technical knowledge; formats, cut modes and the raw command are available but never in the way.
2. **Never hide the work.** Running jobs and their progress stay visible while the user does something else.
3. **Be honest about trade-offs.** Say plainly what each choice costs (speed vs. frame accuracy, file size, re-encoding) before the user commits.
4. **Local and private.** Everything happens on the user's machine: no accounts, no uploads, no tracking.
5. **Build for one, ship for many.** It must satisfy its maker first and still make sense to a stranger on first launch.
