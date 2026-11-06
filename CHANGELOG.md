# What's new in Craftora

## Next version

**Fixed**

- **Downloads started over after Pause or after closing Craftora** (#123). A whole link exported
  as it is now goes on where it stopped, like Download for editing. Downloads still running when
  Craftora closes carry on by themselves next time, so closing doesn't ask about them any more.
  (While downloading, the parts are kept in Craftora's own folder and the file shows up in your
  folder only when it's complete.)
- **Exporting an edited video from a link also saved the original** (#124). The original is now
  kept in Craftora's own folder for the project to edit from, so your folder gets only the edited
  video.
- **Captions made from the sound showed before the words, stayed too long, or landed in odd
  places** (#126, #127). Each line is now timed by when its words are said, also under music
  (measured: within 0.15 s of the speech starting, before up to 10 s early). Sound tags like
  [Music], which the speech model also gave to cries and groans, are left out, and whisper no
  longer repeats a line over what comes after. Captions made earlier can be made again (Transcript
  → Make captions).

**Changed**

- Captions from the sound appear all at once when they're done (the percent keeps moving), instead
  of a few lines along the way.

## 0.6.0 (November 2026)

**New**

- **A sound when a download or export finishes**, whether Craftora is in front or not. Windows
  notifications from Craftora are silent now, so you hear only this sound.
- **Settings → Preferences**: turn the finish sound on or off, and choose whether files imported
  from this PC go straight onto the timeline or wait under In this project.
- **Time left** for exports in the queue, worked out from how fast it's going.
- **Filters, Effects and Transitions** tabs on the right, each tile showing Craftora's cat doing
  it. Drag one onto the timeline (or click it to put it at the playhead):
  - **Filters** (14 colour looks) and **effects** (fade in, fade out, flash, blur, mirror) become
    blocks on a track above: dropped on a clip (or a piece of a split clip), one covers exactly
    that clip; dropped on an empty spot, stretch it over the part you want. It changes every
    picture under it, not text. The export draws exactly what the preview shows.
  - **Slow motion, Speed up, Reverse**: drop one on a clip (or a piece of a split clip) and it
    changes.
  - **Smooth slow-mo**: half speed with new in-between frames made in the export (motion
    interpolation), instead of each frame shown twice. It exports much more slowly than the other
    effects (several seconds per second of slowed video), so split out just the part to slow first.
  - **Transitions**: click the **+** where two clips meet (after a split, say), then pick one; or
    drop one on that join. A join with a transition shows a tick.
  - With a clip selected, clicking a tile puts it on that clip.
- **Right-click a clip**: Copy, Cut, Paste, Delete, Edit (Freeze frame, Reverse, Mirror, Rotate,
  Crop), Export this clip, Replace clip, Open file location. Ctrl+C, Ctrl+X and Ctrl+V work too.
- **Rotate** a picture a quarter turn at a time (also in Edit).
- **Cover** on the main track: the project's picture, from the frame at the playhead or a
  picture on your PC. Exported videos have it built in as their cover.
- **Every track works the same**: any track takes videos, pictures, sound, text and effects, and
  clips can be dragged onto any track. A new edit starts with one track; **+ Track** adds one at
  the top. Sound files get their own track under the main one, text goes above it. Every track
  has the same lock, hide and mute buttons and a ⋯ menu (track height, waveform size, magnet,
  remove). Hide hides a track's pictures, text and effects (its sound still plays); mute
  silences it. Video clips show frames along them, with their name, length and sound wave.
- **The assistant works without an API key** when you already have an AI on this PC. The
  Assistant tab lists what it finds: the AI programs Claude Code, Codex, Gemini CLI and
  Antigravity (each uses its own sign-in), and local AI servers such as Ollama and LM Studio. Or
  type the address of any other AI server on this PC. Craftora runs AI programs in an empty
  folder with their file and command tools blocked. They're slower than a key (about 10 to 35
  seconds per reply). Switch between them and your API keys from the list at the top.

**Changed**

- **Tracks start with the magnet off**: clips move freely on every track, the main track too, and
  filters, effects and pictures can go on any of them. Turn the magnet on in a track's ⋯ menu
  (dropping a transition turns it on for that track).
- **The playhead goes anywhere on the timeline**, past the last clip and on an empty timeline.
- **Files imported from this PC wait under In this project** instead of going onto the timeline:
  drag them in or press their +. Fetched links still go straight onto the timeline. (Settings →
  Preferences brings the old way back.)
- **Smooth slow-mo exports 2–3× faster**: each smooth clip is made in up to 4 pieces at once (fewer
  when memory is short), then joined frame-exactly. Reversed smooth clips, and frame rates that
  don't divide evenly (24 fps exported at 30), still take the slower one-pass way.
- **The queue drop-down is smaller**, and its progress line no longer wraps.
- **Reverse is an effect only**: drag Effects → Reverse onto a clip (the Edit panel's Reverse tick
  box is gone). Right-click ▸ Edit ▸ Reverse still turns it off again.
- **Edit and Export are separate tabs** on the right (they were one, Edit & export): Edit has the
  selected clip's settings, Export the export settings and Add to queue (Ctrl+Enter still works
  from anywhere).
- **The left sidebar and the right panel can be resized**: drag their inner edge (a line shows
  when you point at it). Craftora remembers the widths, and the middle always keeps room for the
  preview (a narrow timeline shows its tools as icons). File details in the sidebar and panel tabs
  stay on one line instead of wrapping.
- **The timeline looks like a familiar editor's**: video clips are teal, with their name and
  length on a bar along the top, frames in the middle and the sound wave along the bottom. The
  main track is taller, with Cover at the right of its buttons and a line above it; tracks sit in
  the middle of the timeline when there are only a few. The ruler has small ticks between its
  times. Effect blocks are now blue.
- **Text is always drawn over pictures in exports**, as the preview shows it, whatever track
  it's on.
- **Settings → Links** lists each website with when it was last used (opened in Craftora's
  window, or fetched from with its login). The box for typing a website to open is gone; when a
  link needs a login, Fetch still offers to open its page. **Sign out of all** stays.
- **Exporting an edited video that uses links** first downloads each link whole (a Download for
  editing in the Queue; the export says "Waiting for its video to download"), then exports from
  the file. After it, the editor plays the downloaded file instead of streaming the link.
- **Fetch shows what a link holds before adding it**: its picture, title, website, who posted it,
  length, what's in it, qualities, size, captions and what happens when it's added, with a
  website check (VirusTotal key) and Cancel. Nothing is added or downloaded until you click
  Add to project.
- **Settings no longer has "New projects export as"**: every project starts as Video (MP4); pick
  Audio only in Export when you want sound.
- **A video's picture can be changed**: click its picture under In this project (left) and pick
  an image on your PC. It shows there, on the project and in History, and stays after the video
  is downloaded for editing (which used to swap in a frame of the video).
- **Downloads can be deleted** from the Downloads page (the file goes to the Recycle Bin), not
  only hidden.
- **Craftora opens maximized.** Restore still gives the usual window.
- **The preview can be made bigger or smaller**: drag the bar between the preview and the
  timeline (or focus it and press ↑/↓). Craftora remembers the size.
- **Every download is checked before Craftora keeps it** (Download for editing, and exports cut
  straight from a link): it must really be a video or sound file, and your PC's antivirus
  (Microsoft Defender or the one you installed) scans it, as browsers do. A file that fails is
  deleted and the Queue says why.
- **Websites in the sign-in window can't start other programs on your PC** (meeting apps, app
  store links, Windows tools…), not even from an ad inside the page; before, Windows asked
  "Open …?" and one click started it.

**Fixed**

- **Website checks use only your own VirusTotal key** (Settings → Links); no key is built into
  Craftora.
- **Downloads listed Windows' hidden files** (desktop.ini, which can't be deleted there); hidden and
  system files are left out now.
- **Clicking the empty space above or below the tracks didn't move the playhead** (only the ruler
  and the tracks did); now a click or drag anywhere on the timeline does.
- **The track lines on the left didn't meet the lines across the timeline** (they were half a
  scrollbar lower).
- **Slow motion, Speed up or Reverse on a picture** now says pictures have no speed.
- **The + on a join couldn't be clicked right after a split**: the playhead stands exactly there
  after splitting and took the click. The + is now on top.
- **Light glass: clip names on the timeline were hard to read** (white on pale teal).
- **Glass themes: the Queue's list was see-through**, with the video showing sharply behind it.
- **Editing felt slow, worst on fast screens**: during playback the editor stopped and restarted
  two of its listeners on every frame (hundreds of calls a second to the app's back end). It now
  draws about twice as many frames a second.
- **A slow file from this PC said "Still loading from the website…"**: it now says Loading…; the
  website wording is kept for links.
- **The playhead couldn't be dragged past the edge of the timeline**: the timeline now scrolls
  along, as it does when dragging a clip's edge. Its pin is bigger and easier to grab.
- **Exports with a Mirror effect block failed** ("Invalid argument"): FFmpeg refused the way the
  flip was limited to the block's time.
- **Some videos from a website had no picture while others from the same site did**: Craftora
  only tried the website's largest picture, which isn't there for every video (YouTube's, for
  one), and gave up after one try. It now tries the video's other pictures in turn, and once
  more after a dropped connection.
- **Fetching sometimes failed on a website that usually works**: a moment's network trouble (a
  timeout, a dropped connection, the site's server failing for a moment) now gets one more try.
- **An export deleted in File Explorer stayed in Exports and on Home**: Craftora now drops it
  when it starts or when you switch back to it (not for an unplugged drive: those stay listed).
  The Downloads page reads its folder again then too.
- **Pausing an export from a link started its download over**: the link's download is now a
  Download for editing, which goes on from where it was.
- **Hovering a project or a History row whose video is a link** didn't play it (only files on
  this PC did): it now plays the link's light 480p stream, after a few seconds the first time.
- **Broken pictures on the timeline** for some files from your PC (ones whose sound the preview
  can't play as is, such as AC3): the clip's picture turned into a broken image once Craftora's
  preview copy was ready.
- **A black flash where clips meet** in the preview (after a split, a slow-motion part, or any
  cut): the next clip only started looking for its first frame when its turn came. It now waits
  on that frame beforehand.
- **Sound files showed a broken picture** on their timeline clip and a black box under In this
  project: they show a music note now.
- **Dropping a video on the text track did nothing**: it now lands on a video track.
- **The Duplicate button's icon was squashed** to a sliver in Edit & export.
- **Hints in link, file name and key boxes** were in the code font; they now match the rest of
  the app (what you type there stays in the code font).

## 0.5.1 (November 2026)

**New**

- **Style your captions.** Click the captions on the preview (or a caption clip) to pick their
  font (Segoe UI, Arial, Impact, Georgia, Comic Sans), colour, size and what keeps them readable:
  a shadow, an outline or a dark box. Text clips get the same font and edge choices. The preview
  and the export look the same.
- **Save captions as .srt** from the Captions section or the Transcript tab, for YouTube or any
  player.
- **Pause anything in the queue.** Downloads carry on where they stopped; exports start again when
  resumed. **Pause all** pauses everything (live recordings keep their Stop button).
- **Notifications** when a download, export or recording finishes or fails while you're in another
  window. Click one to jump back to it. The taskbar button shows overall progress.
- **Choose your Downloads folder** in **Settings → Saving** or on the Downloads page.
- **Ads and trackers blocked** in Craftora's sign-in window (**Settings → Privacy**, on by default;
  turn it off if a site's login or player stops working).
- **A new welcome.** The app icon comes alive when Craftora opens. It shows at every start until
  you tick **Don't show this again**.

**Better**

- **Closing Craftora asks first** when a download or export is unfinished, and nothing it started
  keeps running after it closes (or crashes). Paused downloads are kept for next time.
- **Slow link previews** offer **Download for editing** right in the preview.
- **Videos play when you hover them** in lists again, from a lighter stream so they start quickly.
- **Tidier file lists:** Exports, Downloads and History show one line per file with round icon
  buttons and short dates. The Exports page has an **In progress** section.
- **Clearer words:** an export from a link says "Getting the video" while it fetches, instead of
  looking like a download.
- **Home** shows your 3 latest projects and **See all** for the rest.
- The **Working on** box in the sidebar scrolls when it's full, so Settings never disappears.

**Fixed**

- The welcome guide's speech bubble cut off its last letter.
- **Export size showed 0 MB** for a video from your PC (exported as is).
- **"~0.0 MB" in the queue** for downloads from sites that don't list a file's size: it shows the
  real size once the download starts.
- The mouse-wheel glide could stop short, freeze a list or shake it.
- The "Saved info" list still popped up under some fields.
- The sign-in window no longer opens pop-ups other than sign-in pages, starts downloads by
  itself or opens other programs from a link.

## 0.5.0 (November 2026)

**Better**

- **Smaller.** FFmpeg's two programs now share one copy of their libraries instead of carrying a
  full one each, and two whisper files Craftora never used are gone: about 135 MB less on disk, and
  the installer is a third smaller (about 100 MB instead of 150). Updating removes the old copies.
- **Less to load at start.** The stream player is loaded only when a stream preview needs it, which
  halves the code Craftora reads when it opens.
- **Less memory in the background.** While Craftora is minimized (say, during a long download or
  export), it gives back about 55 MB of memory it only needs on screen.
- **The queue gets out of the way.** It opens when a download or export starts and folds down to
  its one-line header when everything is done (it stays open if something failed). The arrow still
  opens and closes it.
- **Pages line up.** Home and every sidebar page share one centred column, and long explanations
  wrap at a comfortable width.
- **Previews of links play the best quality the video has** (up to 4K). They used to pick YouTube's
  only file with sound built in, which is 360p and looked blurry full screen. A new quality picker
  next to the speed (**Best**, 1080p, 720p…) lowers it for slow Wi-Fi; exports keep their own quality.
  The Smooth/Sharp setting is gone. At the same size, YouTube's sharper VP9 file is preferred.
- **Know what you'll get before it's queued.** Add to queue shows a short summary first: picture
  quality, whether it's copied as is or re-made, length, file name and size, where it's saved, and
  whether captions are drawn in. (Ctrl+Enter still adds straight away.)
- **Plain error messages.** A slip inside Craftora now says "Something went wrong inside
  Craftora…" instead of showing programmer text.

**New**

- **Themes.** **Settings → Theme**: **Classic** (the look you know, still the default), **Dark glass**
  or **Light glass**. The glass themes are see-through panels over a soft glow that takes the
  colours of the video playing and eases into each new one.
- **Smoother everywhere.** Switches slide to the option you pick, buttons give a soft press,
  changing the theme fades over, and the mouse wheel scrolls with a gentle glide.
- **Fix caption text.** In the **Transcript** tab, search a wrong word or name and **Replace all**
  changes it in every caption at once; the pencil on a line retypes just that caption (Enter keeps
  it, Escape drops it). The preview, exports and the Transcript all show the fix, and Ctrl+Z undoes it.
- **Report an AI reply.** **Report a reply** under the assistant's chat opens a short form to tell us
  about a wrong or inappropriate answer (it names the AI and model; you paste the reply yourself).

**Fixed**

- **"Fetch this video" fetched the episode before.** After a player's "next episode" (or any new
  video on the same page), it fetched the video that played first. It now fetches the one playing
  when you click it.
- **"Is this link safe?" was missing** from the installed app. **Check** is back next to Fetch:
  add your own free VirusTotal key once in **Settings → Links** (Check takes you there), and
  Craftora tries it before keeping it in Windows Credential Manager.
- **YouTube previews stuck on a blurry picture** (or "can't play in the preview"): YouTube sometimes
  refuses the file it has just listed, and the preview showed only the video's cover picture.
  Craftora now checks the file first and plays the next best one if it's refused.
- **">>" before captions** whenever someone starts talking (YouTube's mark for a new speaker) is
  gone from the preview, exports and the Transcript.
- **Export size showing 0 MB** after changing the preview quality or reopening a project: YouTube can
  list the same quality under another format the next time. The export keeps the quality you
  picked (or 1080p if it's gone).
- **Microsoft Store version:** it now includes Deno and whisper.cpp like the GitHub installer, so
  YouTube and captions from the sound work there too.
- **Exporting with captions:** captions no longer count toward the 150-clip limit, so long videos
  with hundreds of captions export (up to 5,000 texts and captions).
- **Windows Security blocking downloads and exports:** with Controlled folder access on, Windows
  blocked FFmpeg and yt-dlp from writing into Videos and the download started over. They now work
  in Craftora's own folder and only Craftora saves into Videos; if Windows blocks that too, Craftora
  says how to allow it. A save folder named Downloads no longer gets a second Downloads inside.
- **No more "Saved info" list** popping up under the link box and other fields.
- **Captions made from the sound show up with the words,** not seconds before them, and go away
  when the talking stops instead of staying through the silence. (Under music the timing stays as
  before.)
- **Captions from the sound only when you ask.** They no longer start by themselves (they kept the
  processor busy for minutes): press **CC** on the preview, or **Make captions from the sound** in the
  Transcript tab. It also
  redoes captions made before this version, with the better timing. The Settings choice is gone.
- **Music notes (♪) and Khmer in exported videos** showed as empty boxes; they're drawn now.

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
