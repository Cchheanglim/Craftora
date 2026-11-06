<#
.SYNOPSIS
  Downloads the yt-dlp and FFmpeg binaries Craftora bundles as Tauri sidecars.

.DESCRIPTION
  Fetches official release builds, verifies their SHA-256 checksums, and places them in
  src-tauri/bin/ as folders bundled as resources: FFmpeg and FFprobe with the libraries they
  share as bin/ffmpeg, yt-dlp's unpacked build as bin/yt-dlp, Deno and whisper.cpp. The
  binaries are gitignored; run this once per machine:

    powershell -ExecutionPolicy Bypass -File scripts/fetch-sidecars.ps1

  Re-run with -Force to replace existing binaries (for example to update yt-dlp).
#>
param(
  # BtbN FFmpeg build. "gpl" includes libx264 (used for precise cuts and transforms); "shared"
  # puts the libraries in DLLs that ffmpeg and ffprobe share, instead of a copy inside each.
  [string]$FfmpegBuild = "ffmpeg-n9.0-latest-win64-gpl-shared-9.0",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root "src-tauri\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$triple = (& rustc -vV | Select-String "^host: (.+)$").Matches[0].Groups[1].Value
if (-not $triple) { throw "Could not read the Rust target triple from 'rustc -vV'. Is Rust installed?" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) "craftora-sidecars"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Get-File([string]$Url, [string]$OutFile) {
  Write-Host "  downloading $Url"
  & curl.exe -fL --progress-bar --retry 3 --connect-timeout 30 -o $OutFile $Url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
}

function Assert-Checksum([string]$File, [string]$SumsFile, [string]$Name) {
  $line = Get-Content $SumsFile | Where-Object { $_ -match "\s\*?$([regex]::Escape($Name))$" } | Select-Object -First 1
  if (-not $line) { throw "No checksum listed for $Name" }
  $expected = ($line -split "\s+")[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 $File).Hash.ToLower()
  if ($expected -ne $actual) { throw "Checksum mismatch for $Name (expected $expected, got $actual)" }
  Write-Host "  checksum OK: $Name"
}

# --- yt-dlp -------------------------------------------------------------------
# The unpacked build (a folder): the one-file yt-dlp.exe unpacks itself on every run, which
# took about 4 s per run (28 s on the first) with the virus scanner, against under 1 s.
$ytdlpDir = Join-Path $binDir "yt-dlp"
$ytdlpTarget = Join-Path $ytdlpDir "yt-dlp.exe"
if ($Force -or -not (Test-Path $ytdlpTarget)) {
  Write-Host "yt-dlp"
  $base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download"
  Get-File "$base/SHA2-256SUMS" (Join-Path $tmp "yt-dlp.sums")
  Get-File "$base/yt-dlp_win.zip" (Join-Path $tmp "yt-dlp_win.zip")
  Assert-Checksum (Join-Path $tmp "yt-dlp_win.zip") (Join-Path $tmp "yt-dlp.sums") "yt-dlp_win.zip"
  if (Test-Path $ytdlpDir) { Remove-Item -Recurse -Force $ytdlpDir }
  Expand-Archive (Join-Path $tmp "yt-dlp_win.zip") $ytdlpDir
  # The old one-file sidecar, from before the switch.
  Remove-Item (Join-Path $binDir "yt-dlp-$triple.exe") -ErrorAction SilentlyContinue
} else {
  Write-Host "yt-dlp already present (use -Force to replace)"
}

# --- FFmpeg + ffprobe -----------------------------------------------------------
$ffmpegDir = Join-Path $binDir "ffmpeg"
$ffmpegTarget = Join-Path $ffmpegDir "ffmpeg.exe"
$ffprobeTarget = Join-Path $ffmpegDir "ffprobe.exe"
if ($Force -or -not (Test-Path $ffmpegTarget) -or -not (Test-Path $ffprobeTarget)) {
  Write-Host "FFmpeg ($FfmpegBuild)"
  $base = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
  $zip = Join-Path $tmp "$FfmpegBuild.zip"
  Get-File "$base/checksums.sha256" (Join-Path $tmp "ffmpeg.sums")
  Get-File "$base/$FfmpegBuild.zip" $zip
  Assert-Checksum $zip (Join-Path $tmp "ffmpeg.sums") "$FfmpegBuild.zip"
  $unzipped = Join-Path $tmp "ffmpeg"
  if (Test-Path $unzipped) { Remove-Item -Recurse -Force $unzipped }
  Expand-Archive -Path $zip -DestinationPath $unzipped
  $bin = Join-Path $unzipped "$FfmpegBuild\bin"
  if (Test-Path $ffmpegDir) { Remove-Item -Recurse -Force $ffmpegDir }
  New-Item -ItemType Directory -Force -Path $ffmpegDir | Out-Null
  # Not ffplay.exe: Craftora doesn't use it.
  Get-ChildItem $bin | Where-Object { $_.Name -in "ffmpeg.exe", "ffprobe.exe" -or $_.Extension -eq ".dll" } | Copy-Item -Destination $ffmpegDir
  Copy-Item (Join-Path $unzipped "$FfmpegBuild\LICENSE.txt") (Join-Path $binDir "FFMPEG-LICENSE.txt") -Force
  # The old sidecars, from before the switch to the folder.
  Remove-Item (Join-Path $binDir "ffmpeg-$triple.exe"), (Join-Path $binDir "ffprobe-$triple.exe") -ErrorAction SilentlyContinue
} else {
  Write-Host "FFmpeg already present (use -Force to replace)"
}

# --- Deno (JavaScript for yt-dlp) -------------------------------------------------
# YouTube makes yt-dlp solve JavaScript challenges; without a runtime, signed-in fetches find no
# formats ("Requested format is not available"). yt-dlp looks for Deno first.
$denoVersion = "v2.9.8"
# Its .sha256sum files are in PowerShell's list format, so the hash of this build lives here.
$denoSha256 = "cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf"
$denoDir = Join-Path $binDir "deno"
$denoTarget = Join-Path $denoDir "deno.exe"
if ($Force -or -not (Test-Path $denoTarget)) {
  Write-Host "Deno ($denoVersion)"
  $base = "https://github.com/denoland/deno/releases/download/$denoVersion"
  $zip = Join-Path $tmp "deno-x86_64-pc-windows-msvc.zip"
  Get-File "$base/deno-x86_64-pc-windows-msvc.zip" $zip
  $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
  if ($actual -ne $denoSha256) { throw "Checksum mismatch for deno-x86_64-pc-windows-msvc.zip (expected $denoSha256, got $actual)" }
  Write-Host "  checksum OK: deno-x86_64-pc-windows-msvc.zip"
  if (Test-Path $denoDir) { Remove-Item -Recurse -Force $denoDir }
  Expand-Archive -Path $zip -DestinationPath $denoDir
} else {
  Write-Host "Deno already present (use -Force to replace)"
}

# --- whisper.cpp (speech to text, for captions made from the sound) --------------
# Release b5454. With the Vulkan SDK installed (release.yml installs it), built from its source with graphics-card
# support (Vulkan: NVIDIA, AMD and Intel), which its releases don't offer for Windows: the official CUDA build
# needs 1.1 GB of NVIDIA libraries, the Vulkan part adds ~5 MB to the installer. Without the SDK, the official
# processor-only build. Pinned: the source by commit; the zip by SHA-256 (its releases publish no checksum file).
# The speech models (148 MB, or 190 MB on a graphics card) aren't bundled: Craftora downloads one on first use.
$whisperRelease = "b5454"
$whisperCommit = "d1be6fde11ac6e0407606b4e42fe72d34add8037"
$whisperSha256 = "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb"
$whisperDir = Join-Path $binDir "whisper"
$whisperTarget = Join-Path $whisperDir "whisper-cli.exe"
if ($Force -or -not (Test-Path $whisperTarget)) {
  if ($env:VULKAN_SDK -and (Test-Path $env:VULKAN_SDK)) {
    Write-Host "whisper.cpp ($whisperRelease, built with Vulkan)"
    # A short folder: Visual Studio's build stops on paths over 260 characters.
    $src = Join-Path $tmp "w"
    if (Test-Path $src) { Remove-Item -Recurse -Force $src }
    & git -c core.longpaths=true clone --quiet --depth 1 --branch $whisperRelease https://github.com/ggml-org/whisper.cpp $src
    if ($LASTEXITCODE -ne 0) { throw "Couldn't download the whisper.cpp source" }
    $head = (& git -C $src rev-parse HEAD).Trim()
    if ($head -ne $whisperCommit) { throw "whisper.cpp $whisperRelease is commit $head, expected $whisperCommit" }
    $cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
    if (-not $cmake) {
      $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
      $cmake = & $vswhere -latest -products * -find "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" | Select-Object -First 1
    }
    if (-not $cmake) { throw "CMake wasn't found: install Visual Studio's C++ build tools" }
    $build = Join-Path $src "build"
    # whisper.cpp's own Windows release options, plus Vulkan.
    & $cmake -S $src -B $build -A x64 -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DGGML_NATIVE=OFF -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DGGML_VULKAN=ON -DWHISPER_BUILD_TESTS=OFF
    if ($LASTEXITCODE -ne 0) { throw "Couldn't set up the whisper.cpp build" }
    & $cmake --build $build --config Release --parallel
    if ($LASTEXITCODE -ne 0) { throw "Couldn't build whisper.cpp" }
    $release = Join-Path $build "bin\Release"
  } else {
    Write-Host "whisper.cpp ($whisperRelease, processor only: install the Vulkan SDK for graphics-card captions)"
    $zip = Join-Path $tmp "whisper-bin-x64.zip"
    Get-File "https://github.com/ggml-org/whisper.cpp/releases/download/$whisperRelease/whisper-bin-x64.zip" $zip
    $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
    if ($actual -ne $whisperSha256) { throw "Checksum mismatch for whisper-bin-x64.zip (expected $whisperSha256, got $actual)" }
    Write-Host "  checksum OK: whisper-bin-x64.zip"
    $unzipped = Join-Path $tmp "whisper"
    if (Test-Path $unzipped) { Remove-Item -Recurse -Force $unzipped }
    Expand-Archive -Path $zip -DestinationPath $unzipped
    $release = Join-Path $unzipped "Release"
  }
  if (Test-Path $whisperDir) { Remove-Item -Recurse -Force $whisperDir }
  New-Item -ItemType Directory -Force -Path $whisperDir | Out-Null
  # Only the command-line tool and the libraries it loads; the zip also has demos and tests.
  Copy-Item (Join-Path $release "whisper-cli.exe") $whisperDir
  # Only what whisper-cli loads: not SDL2, llama or parakeet (3.3 MB).
  Get-ChildItem (Join-Path $release "*.dll") | Where-Object { $_.Name -like "ggml*.dll" -or $_.Name -eq "whisper.dll" } | Copy-Item -Destination $whisperDir
} else {
  Write-Host "whisper.cpp already present (use -Force to replace)"
}

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Sidecars in $binDir"
$ErrorActionPreference = "Continue"
Write-Host ("  {0,-40} {1}" -f (Split-Path -Leaf $ytdlpTarget), (& $ytdlpTarget --version | Select-Object -First 1))
foreach ($tool in @($ffmpegTarget, $ffprobeTarget)) {
  Write-Host ("  {0,-40} {1}" -f (Split-Path -Leaf $tool), (& $tool -version | Select-Object -First 1))
}
