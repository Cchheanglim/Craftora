# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org)

Craftora's Windows installers are built from this repository's source code by GitHub
Actions (see [`.github/workflows/release.yml`](.github/workflows/release.yml)). They are
signed only after a maintainer approves each release in SignPath. Craftora signs only its
own installer. The bundled third-party programs (FFmpeg, yt-dlp; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) are shipped as their authors publish them.

## Team roles

| Role | Who |
|---|---|
| Committers and reviewers | [Cchheanglim](https://github.com/Cchheanglim) |
| Approvers | [Cchheanglim](https://github.com/Cchheanglim) |

Everyone in these roles uses multi-factor authentication on GitHub and SignPath.

## Privacy policy

This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it.

These are the only times Craftora goes online, each one started by you:

- **Links you fetch or export.** When you paste a link, Craftora asks that website (through
  yt-dlp) for the video, and downloads it when you export.
- **The AI assistant.** It is off until you add your own Gemini API key. Each message you send
  goes to Google's Gemini API together with a text description of your timeline (clip names,
  times and settings, never the media files). Google's
  [Gemini API terms](https://ai.google.dev/gemini-api/terms) apply. You can remove the key at
  any time.
- **Update checks.** Craftora asks GitHub whether a newer version exists when it starts. Turn
  this off on the Home screen (About → Check for updates automatically) or check by hand
  instead. The request carries no personal information beyond what any web request does.

Files you import from your PC are never uploaded. Projects, settings and export history stay
in your Windows user folder.
