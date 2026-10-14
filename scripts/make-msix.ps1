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
  try {
    Push-Location $root
    & bun tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "The build failed." }
  } finally {
    Pop-Location
    Remove-Item Env:VITE_STORE_BUILD -ErrorAction SilentlyContinue
  }
}

# --- Layout ------------------------------------------------------------------
Write-Host "Laying out the package..."
if (Test-Path $layout) { Remove-Item -Recurse -Force $layout }
New-Item -ItemType Directory -Force $layout, (Join-Path $layout "Assets"), (Join-Path $layout "licenses") | Out-Null

foreach ($exe in "craftora.exe", "ffmpeg.exe", "ffprobe.exe", "yt-dlp.exe") {
  $source = Join-Path $release $exe
  if (-not (Test-Path $source)) { throw "Missing $source. Run without -SkipBuild (and scripts/fetch-sidecars.ps1 first)." }
  Copy-Item $source $layout
}
Copy-Item (Join-Path $release "licenses\*") (Join-Path $layout "licenses")
foreach ($logo in "StoreLogo", "Square44x44Logo", "Square71x71Logo", "Square150x150Logo") {
  Copy-Item (Join-Path $tauri "icons\$logo.png") (Join-Path $layout "Assets")
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

$package = Join-Path $out "Craftora_$($appVersion)_x64.msix"
& $makeappx.FullName pack /d $layout /p $package /o
if ($LASTEXITCODE -ne 0) { throw "makeappx couldn't pack the layout." }

Write-Host ""
Write-Host "Package: $package"
if ($Test) { Write-Host "This is a test package (placeholder identity); don't upload it." }
