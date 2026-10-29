# What's new in Craftora

## 0.4.0 (October 2026)

**New**

- **Smoother.** Pages fade in, the right panel slides open and shut, and dialogs and menus ease in
  instead of popping up. (Turned off if Windows is set to show fewer animations.)
- **Preview quality.** Settings → Preview quality of links: **Smooth** (up to 720p, the default,
  good on slow Wi-Fi) or **Sharp** (the best quality the site offers, for example 1080p on YouTube
  instead of 360p).
- **Hide things you don't want to see.** **Projects**, **Media library**, **Downloads** and
  **History** get a **Hide** button on each row, like Exports: hidden items move to a folded
  **Hidden** list at the bottom (**Unhide** brings them back; nothing is deleted). **Select** can
  hide several projects or links at once, and hidden projects leave Home too.
- **Keep hidden things private.** **Settings → Privacy → Don't show them** takes the Hidden lists
  away from every page, so nobody using the PC can open them; **Show hidden items** brings them back.
- **Craftora's cat on the installer.** The setup file shows Craftora's icon instead of the
  installer tool's.
- **Updates in Settings.** Settings → Updates shows your version, **Check for updates**, **Install
  and restart** and **Check automatically** (also still under Home → About).
- **Use your own AI.** The assistant now works with Gemini, ChatGPT (OpenAI) or Claude
  (Anthropic): pick one in the Assistant tab and paste its API key. Craftora tries the key before
  keeping it, stores it in Windows Credential Manager, and only ever sends it to that company.
  Switch AI from the list at the top of the chat.
- **Videos play when you rest the mouse on them.** In the sidebar's media, the Media library,
  Projects, Exports, Downloads and the Queue, a video's picture plays it (muted) while the mouse
  is over its row, and stops when it leaves. Projects play their first video from where its clip
  starts. Off when Windows is set to show fewer animations.
- **Captions go into the export.** With captions on (CC in the preview), the exported video has
  them too, exactly as the preview shows them, also for captions made on this PC without internet.
  **Drag captions anywhere** on the preview and **resize them from a corner**: every caption moves
  and resizes together (Undo works), or pick **Top / Middle / Bottom** next to the CC button. Long
  captions and long text now wrap onto lines that fit the picture, the same in the preview and the
  export, instead of running off its edges.
- **Hide saved websites.** In Settings → Links, **Hide** takes a website off the list of websites
  that saved cookies (its login stays); **Show hidden** brings them back. **Forget** now really
  deletes a website's cookies: before, YouTube and Google stayed signed in.
- **A fuller sidebar.** New pages: **Projects** (every project, to pick up where you left off),
  **Media library** (every file you've imported, in any project: search by name, show only videos,
  sound or pictures, and star the ones you use often under **Saved**), **Downloads** (what's
  downloading, paused or failed, and every finished download, ready to add to a project), and
  **Settings** (where files are saved, whether new projects export video or sound only, how many
  downloads and exports run at once, and the link settings that used to be on Home). Downloads now
  go into a Downloads folder inside your chosen save folder.
- **Edit a live stream while it's still live.** Paste the link to a stream that's on right now
  (your own shop's site, YouTube, Twitch…). Craftora records it and puts it in **Media**, and its
  length keeps growing as it records. Drag in the moments you want and export them while the stream
  goes on. Click **Stop recording** in the Queue (or just end the stream) and the whole recording
  becomes a normal video file in `Videos\Craftora\Downloads`.
- **"Fetch this video" finds more videos.** It now sees players embedded from another site (such as
  a streaming service's player on your shop page) and pages with lots of pictures, and it finds a
  finished stream's replay too. If a page plays its video over a direct live connection (WebRTC),
  Craftora says so instead of asking you to play it again.
- **Works with sites that block bots.** When a site's bot check (such as Cloudflare's) turns the
  download away, Craftora tries again as a browser, downloads the video and edits it from your PC.
  A live stream from such a site records through Craftora's page window, so keep that window open
  while it records. These videos preview right away while they download, and Export unlocks once
  the download is done (their links often expire, so Craftora exports the downloaded copy).
- **Sharper link previews.** Streams start at good quality instead of the lowest one.
- **The sound wave matches the sound.** Links no longer show a made-up wave: the real one appears
  once the video is downloaded (Cut silences no longer cuts at made-up quiet spots either).
- **Pause a download and finish it later.** Click pause on a "Download for editing" in the Queue.
  It keeps what it has, waits there even after you close Craftora, and continues where it stopped
  when you click resume.
- **Delete exported files.** Each file in **Exports** has a **Delete** button: it moves the file to
  the Recycle Bin (so a wrong click can be undone there) and takes it off the list and Home.
- **See what each website saved, and forget it.** Under **Links** (Home and Settings), Craftora lists
  the websites that saved cookies in its window (from a visit or a login), each with **Forget**.
  Forgetting YouTube or Google forgets both, since they share one login. **Sign out of all** is still there.
- **YouTube works again after visiting it in Craftora's window.** Craftora now includes Deno, which
  yt-dlp uses for the JavaScript YouTube asks for; without it, YouTube's cookies made fetches fail with
  "Requested format is not available".
- **Captions from the website.** When a fetched video comes with captions (the uploader's own, or
  automatic ones like YouTube's), Craftora reads them right away: they show on the preview (turn them
  off with **CC**), and **Add captions** on the clip puts them on a **Captions** track as text you can
  edit and export. They stay after the video is downloaded for editing.
- **Captions for every video.** A video that comes without captions (from any website, or from your
  PC) gets some made from its sound: Craftora listens to what's said and writes it down, on your PC.
  Media shows how it's going. The first time, Craftora downloads a 148 MB speech model. Turn it off
  in **Settings → Captions for videos without any**.
- **Edit by text.** A **Transcript** tab next to *Edit & export* shows what's said on the timeline,
  from the video's captions. Click a sentence or word to jump there; select words and press
  **Delete** (or **Cut these words**) to cut them out of the video, as one Ctrl+Z step. **Cut every
  "um"** removes the ums, uhs and hmms at once. Search what's said with the box at the top.
- **A calmer sidebar.** Pages are grouped under **Make** and **Library**, Settings sits at the bottom,
  and a **Working on** box shows what's downloading, exporting, recording or getting captions.
  History lives on its own page now, and yt-dlp and FFmpeg only show up when one is missing.
- **Privacy: use a proxy.** **Settings → Privacy** takes an HTTP proxy. Fetching, downloads,
  previews, pictures, captions and the AI assistant then go through it, so websites see its address
  instead of yours; Craftora's window follows after **Restart now**. If the proxy stops working,
  Craftora doesn't quietly connect directly. **Check** shows the address websites see. (A VPN app
  needs no setting: it already covers the whole PC.)
- **A History page.** **History** in the sidebar lists every link you've fetched: the video's
  picture, title and whole link, and when you fetched it. Search them, fetch one again, copy its link,
  or remove links one by one, several at once (**Select**) or all (**Clear all**). The small History
  list in the sidebar shows whole links and has **Select** too.
- **Fetching shows the video sooner.** A fetched video appears in Media without waiting for its
  picture, which fills in a moment later (about a second sooner on every fetch). Captions made from
  the sound now wait until nothing is fetching, downloading or exporting, so on a slow connection
  they don't slow those down, and they use only half the processor. **Copy report** now shows how
  long each fetch took.
- **Name your export.** The file name under **Add to queue** is now a box you can type in, so you can
  tell exports of the same video apart. Names keep spaces and accents; only characters Windows doesn't
  allow in file names are left out.
- **Name a download while it downloads.** Click the pencil on a download in the Queue (or on the
  Downloads page), type a name, and the file is saved with it when it finishes; Media shows the
  new name too. Handy for downloads that start by themselves when you fetch.
- **Delete several projects at once.** **Projects → Select**: tick projects (or **Select all**), then
  **Delete** them with one question.
- **A warning before anything that can't be undone.** Deleting an exported file, signing out of a
  website, stopping a live recording, removing a file from the Media library and removing a link
  from History now ask first. Cancelling a download now says "download" instead of "export".

**Fixed**
- **Captions no longer cover the picture.** Some videos' captions hold a whole paragraph per line;
  they now show as two-line pieces, one after another while it's said, cut at whole words (Khmer and
  Thai too), in smaller text. **Add captions** puts the same pieces on the timeline.
- **Links have a sound wave before they're downloaded.** Craftora reads just a light stream of the
  sound after a fetch and draws the real wave. Waves now hold 10 bars a second, so zooming into the
  timeline shows words and pauses, and each bar shows the loudest moment it stands for. Long clips
  get up to 1,500 bars without slowing playback.
- **Big files no longer crash Craftora.** Importing a video of several GB could close the app: the
  preview's file server sometimes read the whole file into memory at once. Files on your PC now
  play through Craftora's own server, a piece at a time (a 3.7 GB video used about 35 MB).
- **The sound wave matches the sound.** It only listened to the first 10 minutes and kept only deep
  rumble, so voices drew a flat line. It now follows how loud every moment is, for the whole video;
  waves saved in your projects are redone by themselves.
- **Captions from the sound show up while they're made**, line by line, instead of only when a long
  video is done. The **CC** button shows clearly whether captions are on (filled) or off (crossed
  out), with the progress next to it. Captions no longer wait behind a live recording.
- **Sharp taskbar icon in the Microsoft Store version.** It was shrunk from a single 44-pixel logo and
  lost pixels; the Store package now carries the icon at every taskbar size.
- **Play on a moved or deleted file says so.** Play in Exports, Home, the Queue and Downloads used
  to do nothing when the file was gone; it now shows "Moved or deleted".
- **Pictures everywhere.** Downloads, the Media library and the Queue show each video's picture, and
  project pictures in Projects and on Home keep working after Craftora restarts.
- **Pictures for links that come without one.** When a website (or sometimes YouTube) gives no
  picture, or one that won't load, Craftora takes a frame from the video itself.
- **Sharper picture while a video loads.** The picture the preview shows while a link loads, or when
  it can't play, was a tiny copy blown up; it's now kept at a size close to the video's.
- **Find a moved or renamed file.** A clip whose file can't be found now has a **Find file** button
  (select the clip): point to the file and its clips play again.

## 0.3.1 (October 2026)

**New**

- **"Is this link safe?"** Click **Check** next to the top link box, or paste a link under
  Home → Links: Craftora asks [VirusTotal](https://www.virustotal.com) whether security vendors
  flag its website, and shows what they say, people's votes and a link to the full report. Only
  the website's name is sent, never the full link.
- **Audio radio wave under the video and on timeline clips.** An interactive audio wave bar sits
  right under the preview screen (click or drag it to jump through the video), and every video
  and audio clip shows its sound wave along the bottom.
- **One-click "Cut silences".** Automatically finds and removes silent pauses in any video or
  audio clip (from the timeline toolbar, clip settings, or the AI assistant) as one `Ctrl+Z` undo step.
- **Mute any track.** Click the speaker icon on any video or audio track header to mute or unmute
  that whole track in both the preview and the export.
- **Snapshot current frame.** Click the camera button under the preview to save the current frame
  as a PNG in your export folder and add it to **Media**.
- **YouTube chapters.** Fetched links with chapters show chapter ticks on the timeline and offer
  **Split chapters** to cut the clip into one clip per chapter.
- **Duplicate clips (`Ctrl+D`).** Make a copy of the selected clip right after it on the same
  track, from the timeline toolbar, the clip settings panel, `Ctrl+D`, or the AI assistant.
- **Play exported files.** Click **Play** on any finished export in Library, Home's Recent exports,
  or the Queue to open it in your default media player.
- **Made for YouTube, TikTok or Instagram.** The Export panel has one-click presets: YouTube
  (16:9), TikTok · Reels · Shorts (9:16) and Instagram post (1:1). The upright and square ones make
  every picture fill the frame instead of showing black bars.
- **Fill the frame.** A new option on any video or picture clip: it covers the whole frame,
  cutting off the edges, instead of fitting inside with black bars.
- **Hide exported files.** In Exports, click **Hide** on any file to take it off the list and off
  Home's Recent exports. Hidden files wait under **Hidden**, folded away, with **Unhide** to bring
  them back. The file itself stays in your save folder.
- **Choose where exports are saved** from the Exports page (**Change**), and fold its list of
  files away. Home's **Recent exports** can be hidden too.
- **A welcome guide** pops up the first time you open Craftora: three steps to bring in a video,
  edit it and export it. Close it once and it stays closed.
- **Right-click menu for text.** Text boxes get Cut, Copy, Paste and Select all. The browser's
  own menu (Back, Refresh, Print…) and the keys that reload or print the app are gone, so
  Craftora no longer feels like a web page.

**Faster**

- **Video pictures are kept on your PC.** A fetched video's picture is downloaded once, so
  History, Media, Projects and Exports no longer contact its website every time they show it.
  Pictures from sites that refuse them to other pages now load too. (Videos fetched with 0.3.0
  or earlier still load theirs from the website.)

**Fixed**

- **DASH (`.mpd`) links** no longer fail to fetch with "This link has no known length": Craftora
  now reads the stream length from the DASH manifest.

**Removed**

- Choosing a cookie file (cookies.txt) for logins. Use **Sign in to …** instead.

## 0.3.0 (October 2026)

**New**

- **Fetch goes straight to the timeline.** Paste a link, click **Fetch**, and the video is on
  the timeline, ready to edit. Videos the preview can't play are downloaded by themselves.
- **History.** Every link you fetch is kept in the sidebar with its picture: click to fetch it
  again, remove one, or clear them all.
- **Pictures everywhere.** Media, History, Projects and Exports show a picture of each video.
- **Links that need a login.** Click **Sign in to …** on the error: Craftora opens its own small
  browser window (separate from your browser). Log in, then click **Fetch this video**. The login
  is remembered and only used for that website. **Sign out of all** is under Home → Links.
- **Pages yt-dlp doesn't know.** For "Unsupported URL", click **Find the video on the page**,
  play the video in Craftora's window, then **Fetch this video**: Craftora finds what the page
  plays.
- **Edit streams before downloading.** Stream playlists (HLS) preview in the editor, including
  from sites that only serve their videos to their own pages.
- **Videos on audio tracks.** Drag a video onto an audio track to use just its sound.
- **Update yt-dlp** button (Home → Links), for when a website stops working.
- **New look.** A new logo, round icon buttons, and everything a little larger.

**Faster**

- **Fetching is about 3× faster** (a YouTube link: 12 s → 3 s): Craftora now ships yt-dlp
  already unpacked, so it doesn't unpack itself on every run.
- **Exports with link clips are about 3× faster**: cutting the downloaded part now uses your
  graphics card.
- Link previews keep one connection open instead of opening a new one for every piece.

**Fixed**

- **Dragging media onto the timeline works in the app** (it only worked in the browser preview).
- **The preview no longer loads forever or runs on without the picture.** The timeline waits for
  a loading video, says when a website is slow, and says clearly when a video can't play.
- Plain video-file links no longer fail with "no known length".
- **Security:** a website open in Craftora's sign-in window could use Craftora to read pages on
  your home network (such as your router's settings). It can't any more.
- "Are you sure?" before clearing History and signing out of all websites.

**Removed**

- The **Paste** button (use `Ctrl+V` in the link box), the sample links, the edit-or-download
  window after each fetch, and the shortcuts list on Home.

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
- **Download first, or edit now.** After you fetch a link, Craftora shows what it found, lets
  you pick the quality, and explains the two ways to work with it: start editing straight away
  (only the parts you use are downloaded at export), or download the whole video first
  (smoother scrubbing, works offline). Links already in Media have a download button too.
- **Images.** Import PNG, JPEG, WebP or BMP pictures and put them on any video track: they
  start at 5 seconds and can be stretched to any length, sized, placed, cropped, faded and
  used in transitions.
- **Instant scrubbing for links.** Link previews play through a cache on your PC: any part
  already fetched plays instantly, with no "Loading…". With **Download first**, the cache fills
  from start to end in the background, and Media shows how much is ready to scrub.
- **"Are you sure?" checks** before things that can't be undone: deleting a project,
  cancelling a running export, removing the AI key, starting a new AI chat.
- **AI assistant:** suggests two or three good models for your key, with a search for any other.
  When Google's servers are busy, or a model isn't in your plan, it retries and then switches to
  another good model by itself, and says so in the chat.

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
