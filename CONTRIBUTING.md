# Contributing to Craftora

Thanks for wanting to help! Bug reports, fixes, clearer wording and small features are
all welcome. This is a small project maintained in spare time, so reviews can
take a few days.

## Before you start

- **Found a bug?** [Open an issue](https://github.com/Cchheanglim/Craftora/issues) with your
  Craftora version, your Windows version, and the steps to make it happen. A screenshot helps a lot,
  and so does **Copy report** when an error message shows it.
- **Found a security problem?** Don't open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Want to add something big?** Open an issue first and describe it, so we can agree on it
  before you spend time on the code.

## Set up your fork

1. Fork the repo on GitHub, then clone your fork:

   ```powershell
   git clone https://github.com/<your-name>/Craftora.git
   cd Craftora
   git remote add upstream https://github.com/Cchheanglim/Craftora.git
   ```

2. Install the tools and engines, then run the app. The steps are in the README under
   [For developers](README.md#for-developers) (Bun, Rust, the C++ build tools,
   `scripts/fetch-sidecars.ps1`, then `bun tauri dev`).

3. Make a branch from the latest `main` for each change:

   ```powershell
   git fetch upstream
   git switch -c fix-caption-colour upstream/main
   ```

## Making a change

- **Keep it small.** One fix or feature per pull request. Small changes get merged faster.
- **Match the code around you.** Read the files you touch first and follow their naming and
  style. The interface is React + TypeScript with plain CSS (no Tailwind).
- **Follow the look.** For anything on screen, read [DESIGN.md](DESIGN.md) and
  [PRODUCT.md](PRODUCT.md): sharp, near-square corners, no pill-shaped text buttons, no
  decorative gradients, no cursor or scroll effects, red only for the playhead and the main
  action.
- **Write for everyone.** Words in the app are plain and short ("Getting the video", not
  "Resolving stream manifest"). Error messages say what to do next.
- **Keep it safe.** The interface never builds command lines: it sends structured requests,
  and Rust checks them and builds every yt-dlp and FFmpeg argument. Keep it that way.
- **Never commit** the engines in `src-tauri/bin/`, build output, API keys or personal files.
- **Add a test** for new logic: TypeScript tests live in `tests/`, Rust tests sit next to the
  code in `src-tauri/src/`.
- **Add a line to [CHANGELOG.md](CHANGELOG.md)** under `## Next version` (New, Better or
  Fixed), written for people who use the app, not for programmers.

Craftora edits videos and fetches links from sites that allow it. Changes that get around DRM
or a site's protections, or that target sites sharing content without permission, won't be
merged.

## Check before you push

Run these from the repo root. All of them should pass:

```powershell
bun run build          # TypeScript check + interface build
bun test               # TypeScript tests
cd src-tauri
cargo clippy           # Rust warnings
cargo test             # Rust tests
```

Then try your change in the real app (`bun tauri dev`), not only in the browser preview.

## Open a pull request

1. Push your branch to your fork and open a pull request into `main` of
   `Cchheanglim/Craftora`.
2. Say **what** changed and **why**, how you tested it, and add a screenshot for anything on
   screen. Link the issue it fixes (`Fixes #123`).
3. Commit messages start with a type, like the rest of the history: `fix: …`, `feat: …`,
   `refactor: …`, `chore: …`.

Releases are made by the maintainer (see [RELEASING.md](RELEASING.md)), so don't change the
version number.

## Licence

Craftora is [MIT-licensed](LICENSE). By sending a pull request, you agree that your
contribution is shared under the same licence.
