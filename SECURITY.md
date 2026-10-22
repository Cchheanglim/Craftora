# Security Policy

Craftora is a desktop app that runs locally. It has no account and no server, and it does
not upload anything. It still handles untrusted input: links you paste, the metadata sites
send back, and media files you open. It also runs yt-dlp and FFmpeg on your PC. Bugs in
those areas can be serious, and I want to hear about them.

## Supported versions

Craftora is in early development. Only the latest release gets security fixes.

| Version | Supported |
|---|---|
| 0.1.x (latest) | ✅ |
| Older | ❌ |

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
- **Script injection in the interface.** Content from a website (such as a video title or
  description) or from a media file's metadata running as code inside the app window.
- **Supply chain.** Weaknesses in `scripts/fetch-sidecars.ps1` or the build that could lead
  to someone running a tampered yt-dlp or FFmpeg, such as a bypass of the checksum check.

### Out of scope

- **Bugs in yt-dlp or FFmpeg themselves.** Please report these upstream to
  [yt-dlp](https://github.com/yt-dlp/yt-dlp/security) or
  [FFmpeg](https://ffmpeg.org/security.html). If Craftora ships a version with a known
  vulnerability, please tell me so I can update it.
- **Browser preview mode** (`bun run dev` in a normal browser). It's a demo for UI work and
  has no access to files or the engines.
- **Attacks that already need control of the PC**, such as admin rights or the ability to
  replace files in the install folder.
- **Unsigned installers and the lack of auto-updates.** These are known gaps and are on the
  [roadmap](README.md#roadmap) for the first public release.
- **Copyright or terms-of-service questions** about downloaded content.

## How Craftora is designed to stay safe

- **The interface never builds command lines.** It sends structured requests to Rust. Rust
  validates them and builds every yt-dlp and FFmpeg argument itself.
- **Engines are bundled and pinned.** `scripts/fetch-sidecars.ps1` checks downloaded
  binaries against known checksums before using them. The binaries are not committed to
  the repo.
- **Minimal permissions.** The app window only gets the Tauri permissions it needs.
- **No network services.** Craftora doesn't listen on any port in a release build. The only
  network traffic is yt-dlp fetching links you give it.

Thanks for helping keep Craftora and its users safe.
