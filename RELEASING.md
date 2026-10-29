# Releasing Craftora

GitHub Actions builds the Windows installer from this repository
([`.github/workflows/release.yml`](.github/workflows/release.yml)) and creates a **draft**
release. Installed copies find new versions
through the `latest.json` file attached to the newest published release.

## Code signing

The installer isn't code-signed, so Windows SmartScreen warns that the publisher is unknown
(users choose **More info → Run anyway**). The app's own update signature is separate and
always on, so updates stay safe either way. Ways to remove the warning later:

- **Microsoft Store** (free for individual developers): Microsoft signs and updates the app.
  See "Microsoft Store" below.
- **A code-signing certificate**, such as Certum's for open-source developers (about $50 a
  year). Signing would go in `release.yml` just before "Sign the update".

SignPath Foundation turned down the application in October 2026.

## Microsoft Store

The Store copy is an MSIX package that Microsoft signs and updates, so it has no SmartScreen
warning and no self-updater. It's made by `scripts/make-msix.ps1`. Uploading a plain `.exe`
installer would need a paid certificate (Store policy 10.2.9), so the Store gets the MSIX.

### Registering (once, by the owner)

1. Go to <https://storedeveloper.microsoft.com> and sign up as an **individual developer** with
   your personal Microsoft account. It's free. Microsoft checks your identity with a photo of
   a government ID and a selfie.
2. In Partner Center, open **Apps and games → New product → MSIX or PWA app**, and reserve
   the name **Craftora**. If it's taken, try something like "Craftora Video Editor".
3. Open the new app's **Product identity** page and copy three values into
   `src-tauri/msix/store-identity.json`. They're public, so the file can be committed:

   ```json
   {
     "name": "<Package/Identity/Name>",
     "publisher": "<Package/Identity/Publisher, starts with CN=>",
     "publisherDisplayName": "<Package/Properties/PublisherDisplayName>"
   }
   ```

### Making and submitting a package

1. Set the version as in **Publishing a version** below (the package uses it as `x.y.z.0`).
2. Run `powershell -ExecutionPolicy Bypass -File scripts/make-msix.ps1`. The package is
   `src-tauri/target/msix/Craftora_<version>_x64.msix`.
3. In Partner Center, start a submission:
   - **Packages:** upload the `.msix`.
   - **Store listing:** description, at least one screenshot, category **Photo & video**.
     Describe Craftora as a video editor first; link downloading is one feature among many.
   - **Privacy policy URL:** <https://github.com/Cchheanglim/Craftora/blob/main/PRIVACY.md>
   - **Age ratings:** answer the questionnaire.
   - **Restricted capabilities** (`runFullTrust`), a suggested justification: "Craftora is a
     desktop video editor. It runs the bundled FFmpeg and yt-dlp programs from its install
     folder to cut, render and import media, which needs a full-trust desktop process."
4. Submit. Certification usually takes a few days. A Store version is a separate upload from
   the GitHub release; do both for each version.

To try the package layout on this PC before you have the identity values, run the script with
`-Test`. A test package can't be uploaded. To run it, turn on Developer Mode, then run
`Add-AppxPackage -Register src-tauri/target/msix/layout/AppxManifest.xml` in PowerShell.

## Publishing a version

1. Pick the version number, e.g. `0.2.0`, and set it in all three places:
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`
   - `package.json` → `"version"`
2. Add a section for the version at the top of [CHANGELOG.md](CHANGELOG.md) (`## 0.4.0 (Month
   Year)`): what's new, in plain words. The release workflow copies it into the GitHub release
   notes by itself (and stops if it's missing); paste a short version into the Store's "What's
   new" box.
3. Commit, then tag and push the tag:

   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. Watch **Actions → Release** on GitHub (about 15–25 minutes).
5. Open **Releases**, check the draft (installer, `.sig`, `latest.json`, FFmpeg source) and its
   notes, and **Publish**. Installed copies offer the update from then on.

To try the build without releasing, run the workflow by hand (**Actions → Release → Run
workflow**). The installer is kept as a workflow artifact.

## What each release contains

- `Craftora_<version>_x64-setup.exe`: the installer. It installs for the current user, with no
  admin rights needed, and updates install in the background.
- `Craftora_<version>_x64-setup.exe.sig` and `latest.json`: what installed copies use to find
  and verify updates.
- `ffmpeg-source-<commit>.tar.gz` and `ffmpeg-build-scripts-<commit>.tar.gz`: the exact source
  of the bundled FFmpeg and the scripts that built it, as the GPL requires.
