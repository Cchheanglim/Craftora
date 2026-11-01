; Installer hooks (tauri.conf.json → bundle.windows.nsis.installerHooks).

; Up to 0.4.0, FFmpeg came as two full programs next to craftora.exe; now it's the "ffmpeg" folder.
; An update installs over the old version, so remove those two (316 MB).
!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\ffmpeg.exe"
  Delete "$INSTDIR\ffprobe.exe"
!macroend
