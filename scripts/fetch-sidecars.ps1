<#
.SYNOPSIS
  Downloads the yt-dlp and FFmpeg binaries Craftora bundles as Tauri sidecars.

.DESCRIPTION
  Fetches official release builds, verifies their SHA-256 checksums, and places them in
  src-tauri/bin/: FFmpeg and FFprobe named with this machine's Rust target triple (e.g.
  ffmpeg-x86_64-pc-windows-msvc.exe), and yt-dlp's unpacked build as the folder bin/yt-dlp,
  bundled as a resource. The binaries are gitignored; run this once per machine:

    powershell -ExecutionPolicy Bypass -File scripts/fetch-sidecars.ps1

  Re-run with -Force to replace existing binaries (for example to update yt-dlp).
#>
param(
  # BtbN FFmpeg build. "gpl" includes libx264 (used for precise cuts and transforms).
  [string]$FfmpegBuild = "ffmpeg-n9.0-latest-win64-gpl-9.0",
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
$ffmpegTarget = Join-Path $binDir "ffmpeg-$triple.exe"
$ffprobeTarget = Join-Path $binDir "ffprobe-$triple.exe"
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
  Copy-Item (Join-Path $bin "ffmpeg.exe") $ffmpegTarget -Force
  Copy-Item (Join-Path $bin "ffprobe.exe") $ffprobeTarget -Force
  Copy-Item (Join-Path $unzipped "$FfmpegBuild\LICENSE.txt") (Join-Path $binDir "FFMPEG-LICENSE.txt") -Force
} else {
  Write-Host "FFmpeg already present (use -Force to replace)"
}

# --- whisper.cpp (speech to text, for captions made from the sound) --------------
# Pinned: its releases publish no checksum file, so the SHA-256 of this exact build lives here.
# The speech model (ggml-base.bin, ~148 MB) isn't bundled: Craftora downloads it on first use.
$whisperRelease = "b5454"
$whisperSha256 = "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb"
$whisperDir = Join-Path $binDir "whisper"
$whisperTarget = Join-Path $whisperDir "whisper-cli.exe"
if ($Force -or -not (Test-Path $whisperTarget)) {
  Write-Host "whisper.cpp ($whisperRelease)"
  $zip = Join-Path $tmp "whisper-bin-x64.zip"
  Get-File "https://github.com/ggml-org/whisper.cpp/releases/download/$whisperRelease/whisper-bin-x64.zip" $zip
  $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
  if ($actual -ne $whisperSha256) { throw "Checksum mismatch for whisper-bin-x64.zip (expected $whisperSha256, got $actual)" }
  Write-Host "  checksum OK: whisper-bin-x64.zip"
  $unzipped = Join-Path $tmp "whisper"
  if (Test-Path $unzipped) { Remove-Item -Recurse -Force $unzipped }
  Expand-Archive -Path $zip -DestinationPath $unzipped
  if (Test-Path $whisperDir) { Remove-Item -Recurse -Force $whisperDir }
  New-Item -ItemType Directory -Force -Path $whisperDir | Out-Null
  # Only the command-line tool and the libraries it loads; the zip also has demos and tests.
  Copy-Item (Join-Path $unzipped "Release\whisper-cli.exe") $whisperDir
  Get-ChildItem (Join-Path $unzipped "Release\*.dll") | Where-Object { $_.Name -ne "SDL2.dll" } | Copy-Item -Destination $whisperDir
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
