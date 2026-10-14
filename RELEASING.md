# Releasing Craftora

GitHub Actions builds the Windows installer from this repository
([`.github/workflows/release.yml`](.github/workflows/release.yml)), signs it with SignPath
once that's set up, and creates a **draft** release. Installed copies find new versions
through the `latest.json` file attached to the newest published release.

## One-time setup

### 1. The update key (done once, keep it forever)

Updates are only installed if they're signed with Craftora's private update key. It was
generated on the owner's PC in `C:\Users\chhea\.tauri\`:

| File | What it is |
|---|---|
| `craftora-updater.key` | The private key. **Back it up.** If it's lost, installed copies can never update again. Never commit it. |
| `craftora-updater.password.txt` | Its password. Move it into a password manager, then delete the file. |
| `craftora-updater.key.pub` | The public key; already in `src-tauri/tauri.conf.json`. |

Add both to GitHub: repository **Settings → Secrets and variables → Actions → Secrets →
New repository secret**:

| Secret name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The whole content of `craftora-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The content of `craftora-updater.password.txt` |

### 2. Two-factor authentication

Turn on two-factor authentication for your GitHub account (**Settings → Password and
authentication**). SignPath requires it for everyone who can change the code or approve
releases.

### 3. Code signing with SignPath Foundation (free for open source)

SignPath Foundation needs an existing release, so publish the first version unsigned (see
**Publishing a version**), then:

1. Apply at <https://signpath.org> (Apply for an open-source certificate). Give the repository
   link and point to [CODE_SIGNING.md](CODE_SIGNING.md), which has the policy, team roles and
   privacy statement they ask for.
2. Once accepted, in the SignPath web app:
   - Add the predefined **GitHub.com** trusted build system and link it to the Craftora
     project.
   - Create an **artifact configuration** with this content (the workflow uploads the
     installer inside a ZIP):

     ```xml
     <?xml version="1.0" encoding="utf-8"?>
     <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
       <zip-file>
         <pe-file path="*-setup.exe">
           <authenticode-sign />
         </pe-file>
       </zip-file>
     </artifact-configuration>
     ```

   - Create a CI user with **submitter** rights on the project's release signing policy, and
     an API token for it.
3. In GitHub, add the secret `SIGNPATH_API_TOKEN` (the token), and under
   **Secrets and variables → Actions → Variables** add:

   | Variable | Value (from SignPath) |
   |---|---|
   | `SIGNPATH_ORGANIZATION_ID` | Your organization id |
   | `SIGNPATH_PROJECT_SLUG` | The project's slug, e.g. `craftora` |
   | `SIGNPATH_POLICY_SLUG` | The signing policy's slug, e.g. `release-signing` |
   | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | The artifact configuration's slug |

From then on every release is signed. The workflow skips signing while
`SIGNPATH_ORGANIZATION_ID` is empty.

4. In `README.md`, replace the "applying for free code signing" paragraph under **Download**
   with SignPath's required line: "Free code signing provided by
   [SignPath.io](https://about.signpath.io), certificate by
   [SignPath Foundation](https://signpath.org)".

## Publishing a version

1. Pick the version number, e.g. `0.2.0`, and set it in all three places:
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`
   - `package.json` → `"version"`
2. Commit, then tag and push the tag:

   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. Watch **Actions → Release** on GitHub (about 15–25 minutes). With SignPath set up, approve
   the signing request in SignPath when it arrives; the build waits up to an hour.
4. Open **Releases**, check the draft (installer, `.sig`, `latest.json`, FFmpeg source), edit
   the notes if you like, and **Publish**. Installed copies offer the update from then on.

To try the build without releasing, run the workflow by hand (**Actions → Release → Run
workflow**). The installer is kept as a workflow artifact.

## What each release contains

- `Craftora_<version>_x64-setup.exe`: the installer. It installs for the current user, with no
  admin rights needed, and updates install in the background.
- `Craftora_<version>_x64-setup.exe.sig` and `latest.json`: what installed copies use to find
  and verify updates.
- `ffmpeg-source-<commit>.tar.gz` and `ffmpeg-build-scripts-<commit>.tar.gz`: the exact source
  of the bundled FFmpeg and the scripts that built it, as the GPL requires.
