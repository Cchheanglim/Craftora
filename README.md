# Craftora (TrackApp)

> Precision desktop media extraction, lossless trimming, and conversion studio built with React, TypeScript, Vite, and Tauri, bundling `yt-dlp` and `FFmpeg` sidecars.

---

## Quick Start (Run Locally)

### 1. Clone the Repository
```bash
git clone https://github.com/Cchheanglim/Craftora.git
cd Craftora
```

---

### 2. Run the Web Interface (Fastest)

You can use **npm** or **bun**:

#### Option A: Run from Repository Root
```bash
# Install dependencies
npm install
# or: bun install

# Start development server
npm run dev
# or: bun run dev
```

#### Option B: Run directly inside `TrackApp`
```bash
cd TrackApp
npm install
npm run dev
```

Open your browser and navigate to: **`http://localhost:3000`**

---

### 3. Run as a Native Desktop App (Tauri + Rust)

To run as a native desktop application with `yt-dlp` and `FFmpeg` sidecars on your machine:

#### Prerequisites
1. **Node.js** (v20+) or **Bun**
2. **Rust & Cargo**: Install via [rustup.rs](https://rustup.rs/)
3. **C++ Build Tools**: 
   - Windows: Visual Studio C++ Build Tools (MSVC)
   - macOS: Xcode Command Line Tools (`xcode-select --install`)
   - Linux: `build-essential`, `libwebkit2gtk-4.1-dev`, `libssl-dev`

#### Sidecar Binaries (yt-dlp & FFmpeg)
Tauri sidecars reside in `src-tauri/bin/` renamed with your machine's target triple:
- Windows: `yt-dlp-x86_64-pc-windows-msvc.exe` and `ffmpeg-x86_64-pc-windows-msvc.exe`
- macOS (Apple Silicon): `yt-dlp-aarch64-apple-darwin` and `ffmpeg-aarch64-apple-darwin`
- Linux: `yt-dlp-x86_64-unknown-linux-gnu` and `ffmpeg-x86_64-unknown-linux-gnu`

#### Launch Desktop Window
```bash
cd TrackApp
npm install
npx tauri dev
# or: cargo tauri dev
```

---

### 4. Build for Production

#### Build Web Static Bundle:
```bash
npm run build
```

#### Build Native Desktop Installer (`.msi` / `.exe` / `.dmg`):
```bash
cd TrackApp
npx tauri build
```
Compiled native binaries will be output to:
`TrackApp/src-tauri/target/release/bundle/`

---

## Project Structure

```
Craftora/
├── TrackApp/                  # Main application package
│   ├── src/
│   │   ├── components/        # TimelineTrimmer, StreamInspector, HistoryView, QueuePanel
│   │   ├── services/          # Persistent download history storage
│   │   ├── types/             # Stream metadata, trim configs, queue models
│   │   ├── utils/             # Timecode calculation & CLI command synthesis
│   │   ├── data/              # Curated test streams
│   │   ├── App.tsx            # Main single-window workspace coordinator
│   │   └── index.css          # Apple Music dark utility design system
│   ├── index.html             # HTML entry point
│   ├── vite.config.ts         # Vite build configuration
│   ├── tsconfig.json          # TypeScript configuration
│   └── package.json           # Application dependencies & scripts
├── package.json               # Root workspace runner
└── README.md
```