# Security Policy

Craftora is a desktop app that runs locally. It has no account and no server, and it never
uploads your files. It still handles untrusted input: links you paste, the metadata and
pages sites send back, websites you open in its sign-in window, and media files you open.
It runs yt-dlp, FFmpeg, Deno and whisper.cpp on your PC, and it keeps your AI and VirusTotal
API keys. Bugs in those areas can be serious, and I want to hear about them.

## Supported versions

Craftora is in early development. Only the latest release gets security fixes.

| Version | Supported |
|---|---|
| 0.5.x (latest) | ✅ |
| Older | ❌ |

The GitHub installer updates itself (Settings → Updates), and the Microsoft Store updates its
copy, so please check you're on the latest version before reporting.

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report it privately through GitHub instead:

1. Go to the [**Security** tab](https://github.com/Cchheanglim/Craftora/security) of this repo.
2. Click **Report a vulnerability**.
3. Fill in the form.

Please include:

- What the problem is and what an attacker could do with it.
- Steps to reproduce it. A sample link, file or project helps a lot.
- The Craftora version, your Windows version, and whether you ran an installer or
  `bun tauri dev`.
- A suggested fix, if you have one.

### What to expect

This is a small project maintained in spare time, so these are targets, not promises:

- **Within 7 days:** I confirm I've received your report.
- **Within 30 days:** I tell you whether it's confirmed and how I plan to fix it.
- **Once a fix ships:** I publish a GitHub Security Advisory and credit you, unless you'd
  rather stay anonymous.

Please give me a reasonable amount of time to release a fix before you share details
publicly.

## Scope

### In scope

These are the kinds of reports I care most about:

- **Command or argument injection.** A link, file name, title, text clip or project value
  that changes the yt-dlp or FFmpeg command beyond what the user asked for. Examples:
  injecting extra flags, writing to a path the user didn't choose, or running another
  program.
- **Reading or writing files outside what the user picked.** FFmpeg should only read files
  opened in Craftora, and exports should only be written to the export folder.
- **Abuse of the Tauri bridge.** Calling Rust commands or plugins in ways the app doesn't
  intend, or getting around the window's capabilities (`src-tauri/capabilities/`).
- **The sign-in window.** A website opened there reaching any Craftora command, opening
  pop-ups, downloads or other programs, or reading cookies saved for a different website.
- **API keys.** An AI or VirusTotal key leaving Windows Credential Manager for anything but
  the service it belongs to, or becoming readable by the interface or a website.
- **Local servers.** The `cmedia` protocol serving a file the user didn't open, or the stream
  relay (`src-tauri/src/page_fetch.rs`) being usable by another program on the PC.
- **Updates.** Anything that makes Craftora install an update that wasn't signed with the
  release key.
- **Script injection in the interface.** Content from a website (such as a video title or
  description) or from a media file's metadata running as code inside the app window.
- **Supply chain.** Weaknesses in `scripts/fetch-sidecars.ps1` or the build that could lead
  to someone running a tampered yt-dlp, FFmpeg, Deno or whisper.cpp, such as a bypass of the
  checksum check.

### Out of scope

- **Bugs in the engines themselves.** Please report these upstream to
  [yt-dlp](https://github.com/yt-dlp/yt-dlp/security),
  [FFmpeg](https://ffmpeg.org/security.html), [Deno](https://github.com/denoland/deno/security)
  or [whisper.cpp](https://github.com/ggml-org/whisper.cpp/security). If Craftora ships a version with a known
  vulnerability, please tell me so I can update it.
- **Browser preview mode** (`bun run dev` in a normal browser). It's a demo for UI work and
  has no access to files or the engines.
- **Attacks that already need control of the PC**, such as admin rights or the ability to
  replace files in the install folder.
- **The unsigned GitHub installer.** It's a known gap and on the [roadmap](README.md#roadmap).
  Microsoft Store copies are signed by Microsoft, and updates are always signed.
- **What an AI service does with your messages.** Craftora only sends them; see
  [PRIVACY.md](PRIVACY.md).
- **Copyright or terms-of-service questions** about downloaded content.

## How Craftora is designed to stay safe

- **The interface never builds command lines.** It sends structured requests to Rust. Rust
  validates them and builds every yt-dlp and FFmpeg argument itself.
- **Engines are bundled and pinned.** `scripts/fetch-sidecars.ps1` checks downloaded
  binaries against known checksums before using them. The binaries are not committed to
  the repo. Engines only get `http(s)` links, and each one is ended when Craftora closes.
- **Minimal permissions.** Only the main window gets Tauri permissions, and only the ones it
  needs. Websites in the sign-in window can't call any command; pop-ups other than sign-in
  pages, downloads and other programs' links are blocked there.
- **Downloads are checked before they're kept.** A file kept as a website sent it must be a
  real video or sound file (FFmpeg reads it), and Windows' Attachment Services has the PC's
  antivirus scan it, as browsers do (`src-tauri/src/scan.rs`). A file that fails is deleted.
- **Keys stay out of the interface.** API keys live in Windows Credential Manager and are
  only sent to the service they belong to.
- **Signed updates.** The updater only installs updates signed with the release key.
- **Almost no listening.** Craftora opens no port for other PCs. The only local server is the
  stream relay for recording bot-checked live streams: it starts only when needed, listens on
  `127.0.0.1` only, and answers only under a random secret path.
- **Online only when you ask:** fetching a link, the assistant, the link check, the speech
  model's first download and update checks. Details in [PRIVACY.md](PRIVACY.md).

Thanks for helping keep Craftora and its users safe.
