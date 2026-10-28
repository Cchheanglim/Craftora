# Privacy policy

Craftora doesn't send any information to other networked systems unless you use a feature that needs it, and it has no tracking or analytics.

These are the only times Craftora goes online:

- **Links you fetch or export.** When you paste a link, Craftora asks that website (through
  yt-dlp) for the video, and downloads it when you export. Like any web request, the website
  sees your IP address.
- **Signing in to a website.** When a link needs a login, Craftora can open the website in its
  own small browser window, separate from your browser. Logins made there are kept on your PC,
  inside Craftora, and are only sent to the website they belong to, when you fetch from it.
  **Sign out of all** (Home → Links) removes them.
- **Pictures of fetched videos.** When you fetch a video, Craftora downloads its picture once and
  keeps a small copy on your PC for History, Media, Projects and Exports. (Videos fetched with
  version 0.3.0 or earlier still load their picture from the website each time.)
- **"Is this link safe?"** Only when you paste a link into the check box under Home → Links and
  click **Check**: Craftora sends VirusTotal the website's name (for example `youtube.com`),
  never the full link, using Craftora's own VirusTotal key. VirusTotal's
  [terms and privacy policy](https://www.virustotal.com/gui/terms-of-service) apply.
- **Captions made from the sound.** Craftora listens to a video's sound and writes captions on
  your PC; the sound isn't sent anywhere. The first time, it downloads the speech model
  (`ggml-base.bin`, 148 MB) from Hugging Face. You can turn this off in Settings.
- **Updating yt-dlp.** The **Update yt-dlp** button (Home → Links) downloads the newest yt-dlp
  from GitHub.
- **The AI assistant.** It is off until you add your own Gemini API key. Each message you send
  goes to Google's Gemini API together with a text description of your timeline (clip names,
  times and settings, never the media files). Google's
  [Gemini API terms](https://ai.google.dev/gemini-api/terms) apply. You can remove the key at
  any time.
- **Update checks.** Craftora asks GitHub whether a newer version exists when it starts. Turn
  this off on the Home screen (About → Check automatically) or check by hand instead. The
  request carries no personal information beyond what any web request does. Copies from the
  Microsoft Store don't do this; the Store updates them.

Files you import from your PC are never uploaded. Projects, settings and export history stay
in your Windows user folder.
