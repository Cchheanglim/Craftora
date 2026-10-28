# Third-party software in Craftora

Craftora's own code is under the [MIT License](LICENSE). The Windows installer also ships
these programs, which keep their own licences.

## FFmpeg (GPL version 3)

Craftora runs `ffmpeg.exe` and `ffprobe.exe` as separate programs for cutting, rendering and
reading media. They come from the "gpl" build by
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds). That build includes GPL
libraries such as x264, so the binaries are licensed under the
[GNU General Public License, version 3](https://www.gnu.org/licenses/gpl-3.0.html). The full
licence text is installed with Craftora as `licenses/FFMPEG-LICENSE.txt`.

**Source code.** Every Craftora release on
[GitHub Releases](https://github.com/Cchheanglim/Craftora/releases) states the exact FFmpeg
version it ships. It also attaches the matching source code: the FFmpeg source at that commit,
and the BtbN build scripts used to compile it. FFmpeg's source is also at
<https://github.com/FFmpeg/FFmpeg> and <https://ffmpeg.org/download.html>.

You may replace the bundled `ffmpeg.exe` and `ffprobe.exe` with your own builds. Craftora
finds them next to its own `.exe`.

## yt-dlp (Unlicense)

Craftora runs `yt-dlp.exe` to read and download links. yt-dlp is released into the public
domain under the [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE). Its Windows
executable bundles Python and other components; their licences are listed in
[yt-dlp's THIRD_PARTY_LICENSES.txt](https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt).

## Deno (MIT)

yt-dlp uses [Deno](https://github.com/denoland/deno) (MIT licence, Copyright 2018-2026 the Deno
authors) to run the JavaScript that YouTube asks for before it lists a video's formats.

## whisper.cpp (MIT) and the Whisper "base" speech model (MIT)

Craftora runs `whisper-cli.exe` from [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
(MIT licence, Copyright (c) 2023-2026 The ggml authors) to make captions from a video's sound. The
speech model, `ggml-base.bin`, is OpenAI's [Whisper](https://github.com/openai/whisper) base model
(MIT licence, Copyright (c) 2022 OpenAI) converted for whisper.cpp; Craftora downloads it from
[Hugging Face](https://huggingface.co/ggerganov/whisper.cpp) the first time it's needed.

## Libraries built into Craftora

The app is built with [Tauri](https://tauri.app) (MIT or Apache-2.0), [React](https://react.dev)
(MIT), [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0, plays stream previews) and other open-source Rust crates and npm packages under permissive licences (MIT,
Apache-2.0, BSD, ISC, Zlib, Unicode). Their licence texts are in each package's source; run
`cargo license` in `src-tauri/` or check `bun.lock` for the full list.
