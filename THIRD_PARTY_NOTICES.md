# Third-party software in Craftora

Craftora's own code is under the [MIT License](LICENSE). The Windows installer also ships
these programs, which keep their own licences.

## FFmpeg (GPL version 3)

Craftora runs `ffmpeg.exe` and `ffprobe.exe` as separate programs for cutting, rendering and
reading media, with the FFmpeg libraries they share (`.dll` files) in the same folder. They come
from the "gpl-shared" build by
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds). That build includes GPL
libraries such as x264, so the binaries are licensed under the
[GNU General Public License, version 3](https://www.gnu.org/licenses/gpl-3.0.html). The full
licence text is installed with Craftora as `licenses/FFMPEG-LICENSE.txt`.

**Source code.** Every Craftora release on
[GitHub Releases](https://github.com/Cchheanglim/Craftora/releases) states the exact FFmpeg
version it ships. It also attaches the matching source code: the FFmpeg source at that commit,
and the BtbN build scripts used to compile it. FFmpeg's source is also at
<https://github.com/FFmpeg/FFmpeg> and <https://ffmpeg.org/download.html>.

You may replace the bundled FFmpeg with your own build. Craftora runs `ffmpeg.exe` and
`ffprobe.exe` from the `ffmpeg` folder next to its own `.exe`.

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

## ONNX Runtime (MIT)

Craftora ships [ONNX Runtime](https://github.com/microsoft/onnxruntime) 1.24.4 (MIT licence,
Copyright (c) Microsoft Corporation) as `onnxruntime/onnxruntime.dll` and
`onnxruntime/onnxruntime_providers_shared.dll` for local background removal. Its licence ships as
`onnxruntime/ONNXRUNTIME-LICENSE.txt` and its third-party notices ship as
`onnxruntime/ONNXRUNTIME-ThirdPartyNotices.txt`.

## DirectML (Microsoft DirectML licence)

Craftora ships DirectML 1.15.4 (Microsoft DirectML licence, redistributable) as
`onnxruntime/DirectML.dll` so background removal can run on the graphics card via DirectX 12. Its
licence ships as `onnxruntime/DIRECTML-LICENSE.txt`.

## BiRefNet "lite" model (MIT)

The `birefnet-lite-fp16.onnx` background-removal model (MIT licence) ships with Craftora in
`models/birefnet-lite-fp16.onnx`. BiRefNet is by Peng Zheng et al. ("Bilateral Reference for
High-Resolution Dichotomous Image Segmentation", [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet));
the ONNX conversion is published by [onnx-community](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX)
on Hugging Face.

## Real-ESRGAN x4plus model (BSD-3-Clause)

The AI sharpen model in Export picture ships with Craftora as `models/real_esrgan_x4plus.onnx` and
`models/real_esrgan_x4plus.data`. Real-ESRGAN is by Xintao Wang et al. ("Real-ESRGAN: Training Real-World Blind
Super-Resolution with Pure Synthetic Data", [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)), BSD-3-Clause
licence, Copyright (c) 2021, Xintao Wang. The ONNX conversion is published by
[Qualcomm AI Hub](https://github.com/quic/ai-hub-models) (release v0.67.0).

## Libraries built into Craftora

The app is built with [Tauri](https://tauri.app) (MIT or Apache-2.0), [React](https://react.dev)
(MIT), [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0, plays stream previews),
[anime.js](https://animejs.com) (MIT, the empty-state cat's motion), the Pixelify Sans font (SIL Open Font License 1.1, the cat's
speech bubble) and other open-source Rust crates and npm packages under permissive licences (MIT,
Apache-2.0, BSD, ISC, Zlib, Unicode). Their licence texts are in each package's source; run
`cargo license` in `src-tauri/` or check `bun.lock` for the full list.
