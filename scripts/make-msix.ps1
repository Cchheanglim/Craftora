<#
.SYNOPSIS
  Builds the Microsoft Store package of Craftora (an .msix file).

.DESCRIPTION
  Builds the app in Store mode (no self-updates: the Store updates it), lays out the program,
  FFmpeg, yt-dlp, licences and logos, and packs them with the Windows SDK's makeappx.

  The package identity comes from src-tauri/msix/store-identity.json, copied from Partner
  Center (Apps and games > Craftora > Product identity). Without that file, -Test makes a
  package with a placeholder identity, for trying the layout on this PC only.

  The Store signs the package when you upload it, so it is left unsigned here.

    powershell -ExecutionPolicy Bypass -File scripts/make-msix.ps1
    powershell -ExecutionPolicy Bypass -File scripts/make-msix.ps1 -Test

  Output: src-tauri/target/msix/Craftora_<version>_x64.msix
#>
param(
  # Use a placeholder identity (no Partner Center values yet). Not for uploading.
  [switch]$Test,
  # Reuse the last release build instead of building again.
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $root "src-tauri"
$release = Join-Path $tauri "target\release"
$out = Join-Path $tauri "target\msix"
$layout = Join-Path $out "layout"

# --- Identity and version -------------------------------------------------------
$identityFile = Join-Path $tauri "msix\store-identity.json"
if (Test-Path $identityFile) {
  $identity = Get-Content $identityFile -Raw | ConvertFrom-Json
} elseif ($Test) {
  Write-Host "No store-identity.json: using a placeholder identity (-Test)."
  $identity = [pscustomobject]@{ name = "Craftora.Test"; publisher = "CN=Craftora Test"; publisherDisplayName = "Craftora (test)" }
} else {
  throw "Missing $identityFile. Copy Package/Identity/Name, Package/Identity/Publisher and Package/Properties/PublisherDisplayName from Partner Center into it (see RELEASING.md), or run with -Test."
}
foreach ($field in "name", "publisher", "publisherDisplayName") {
  if (-not $identity.$field) { throw "store-identity.json is missing `"$field`"." }
}

$appVersion = (Get-Content (Join-Path $tauri "tauri.conf.json") -Raw | ConvertFrom-Json).version
if ($appVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw "Version $appVersion must look like 1.2.3 for the Store." }
# The Store wants four parts and the last one 0.
$msixVersion = "$appVersion.0"

# --- Build -------------------------------------------------------------------
if (-not $SkipBuild) {
  Write-Host "Building Craftora $appVersion (Store edition)..."
  $env:VITE_STORE_BUILD = "1"
  # Keeps this PC's user folder (Windows user name) out of the program's built-in file paths.
  $env:CARGO_ENCODED_RUSTFLAGS = "--remap-path-prefix=$env:USERPROFILE=~"
  try {
    Push-Location $root
    & bun tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "The build failed." }
  } finally {
    Pop-Location
    Remove-Item Env:VITE_STORE_BUILD -ErrorAction SilentlyContinue
    Remove-Item Env:CARGO_ENCODED_RUSTFLAGS -ErrorAction SilentlyContinue
  }
}

# --- Layout ------------------------------------------------------------------
Write-Host "Laying out the package..."
if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }
New-Item -ItemType Directory -Force $layout, (Join-Path $layout "Assets"), (Join-Path $layout "licenses") | Out-Null

foreach ($item in "craftora.exe", "ffmpeg.exe", "ffprobe.exe", "yt-dlp", "deno", "whisper") {
  $source = Join-Path $release $item
  if (-not (Test-Path $source)) { throw "Missing $source. Run without -SkipBuild (and scripts/fetch-sidecars.ps1 first)." }
  # yt-dlp, Deno (which yt-dlp needs for YouTube) and whisper (captions from the sound) are folders
  # the app runs from next to itself.
  Copy-Item $source $layout -Recurse
}
Copy-Item (Join-Path $release "licenses\*") (Join-Path $layout "licenses")
foreach ($logo in "StoreLogo", "Square44x44Logo", "Square71x71Logo", "Square150x150Logo") {
  Copy-Item (Join-Path $tauri "icons\$logo.png") (Join-Path $layout "Assets")
}

# The taskbar, Start and the title bar want the app icon at exact sizes (24 px at 100% display
# scale, 32 at 125%...). With only the 44 px logo Windows shrank it and the icon lost pixels. Each
# size is drawn from the 512 px icon; "unplated" ones keep Windows from putting a coloured square
# behind it. resources.pri (made below) tells Windows which file is which.
Add-Type -AssemblyName System.Drawing
$master = [System.Drawing.Image]::FromFile((Join-Path $tauri "icons\icon.png"))
$edges = New-Object System.Drawing.Imaging.ImageAttributes
$edges.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY) # no faint border from outside the image
try {
  foreach ($size in 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $draw = [System.Drawing.Graphics]::FromImage($bitmap)
    $draw.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $draw.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $draw.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $draw.DrawImage($master, (New-Object System.Drawing.Rectangle 0, 0, $size, $size), 0, 0, $master.Width, $master.Height, [System.Drawing.GraphicsUnit]::Pixel, $edges)
    $draw.Dispose()
    foreach ($form in "", "_altform-unplated", "_altform-lightunplated") {
      $bitmap.Save((Join-Path $layout "Assets\Square44x44Logo.targetsize-$size$form.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $bitmap.Dispose()
  }
} finally {
  $master.Dispose()
}

$escape = { param($text) [Security.SecurityElement]::Escape([string]$text) }
$manifest = (Get-Content (Join-Path $tauri "msix\AppxManifest.xml") -Raw).
  Replace("{{IDENTITY_NAME}}", (& $escape $identity.name)).
  Replace("{{PUBLISHER}}", (& $escape $identity.publisher)).
  Replace("{{PUBLISHER_DISPLAY_NAME}}", (& $escape $identity.publisherDisplayName)).
  Replace("{{VERSION}}", $msixVersion)
[IO.File]::WriteAllText((Join-Path $layout "AppxManifest.xml"), $manifest)

# --- Pack --------------------------------------------------------------------
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
  Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
if (-not $makeappx) { throw "makeappx.exe wasn't found. Install the Windows SDK (it comes with Visual Studio Build Tools)." }

# The index of the sized icons above (resources.pri), made by the SDK's makepri next to makeappx.
$makepri = Join-Path $makeappx.DirectoryName "makepri.exe"
$priConfig = Join-Path $out "priconfig.xml"
& $makepri createconfig /cf $priConfig /dq en-US /pv 10.0.0 /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri couldn't make its settings file." }
& $makepri new /pr $layout /cf $priConfig /of (Join-Path $layout "resources.pri") /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri couldn't index the icons." }

$package = Join-Path $out "Craftora_$($appVersion)_x64.msix"
& $makeappx.FullName pack /d $layout /p $package /o
if ($LASTEXITCODE -ne 0) { throw "makeappx couldn't pack the layout." }

Write-Host ""
Write-Host "Package: $package"
if ($Test) { Write-Host "This is a test package (placeholder identity); don't upload it." }
