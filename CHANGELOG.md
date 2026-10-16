# What's new in Craftora

## 0.2.0 (October 2026)

**New**

- **All tracks are equal.** Every video track can hold full-screen clips, picture-in-picture
  and transitions; move and resize any clip on the preview. Add as many video, audio and text
  tracks as you like with **+ Track**, and remove them from the track header.
- **Magnet per track.** With the magnet on, a track's clips stay back to back and can have
  transitions; with it off, clips go anywhere. Video 1 starts with the magnet on.
- **Much faster export.** Craftora uses your graphics card (NVIDIA, Intel or AMD) when the PC
  has one, and each clip now reads only its own part of the file. Choose **Best quality** in
  the Export panel for smaller files at a slower speed.
- **Download first, or edit now.** When fetching a link, choose whether to start editing
  straight away or download the whole video first (smoother scrubbing, works offline). Links
  already in Media have a download button too.
- **"Are you sure?" checks** before things that can't be undone: deleting a project,
  cancelling a running export, removing the AI key, starting a new AI chat.
- **AI assistant:** suggests two or three good models for your key, with a search for any other.

**Fixed** (reported in [#15](https://github.com/Cchheanglim/Craftora/issues/15))

- **Exports can no longer delete an earlier export.** Two exports that started close together
  could get the same file name, and if the second failed or was cancelled it deleted the first
  one's finished file. Exports are now built in a private working folder and only moved into
  your export folder, under a name nobody else is using, once complete.
- **Downloading part of a link shows its progress** instead of staying at 0% until the end.
- **Cancelling an export stops it completely**, including the FFmpeg it started, and leftover
  working folders are cleaned up the next time Craftora starts.
- **The preview keeps picture and sound together after you move the playhead.** While a clip
  loads, everything waits (shown as "Loading…") instead of the sound running on under a frozen
  picture, and dragging the playhead no longer piles up jumps.
- **The AI assistant works with any Gemini model your API key can use.**

## 0.1.0 (October 2026)

The first release.

- A timeline editor: a main video track, picture-in-picture tracks, audio tracks and a
  text track. Move, trim, split, delete, snap, zoom, and undo or redo everything.
- Import video and audio from your PC (offline), or from a link through yt-dlp.
- Move and resize picture-in-picture and text directly on the preview.
- Per clip: crop, mirror, reverse, speed (0.25× to 4×), fade in and out, and volume.
- Crossfade and dip-to-black transitions between main-track clips.
- An optional AI assistant (Google Gemini, with your own API key) that makes edits from a
  description.
- Export to MP4, MKV, MP3, WAV or FLAC in 16:9, 9:16, 1:1 or 4:3, in a background queue.
- Projects save themselves; finished exports stay listed after a restart; choose the save
  folder.
- Preview copies for files the built-in player can't show (AC-3 or DTS sound, AVI, HEVC).
- Automatic updates from GitHub Releases (can be turned off).
