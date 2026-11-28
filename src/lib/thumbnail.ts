/**
 * Small pictures for lists: a frame of a video file (or the image itself) drawn into a JPEG
 * data URL, so it still shows after a restart, when the file's preview link has expired.
 */
import type Hls from "hls.js";

// Also the preview's stand-in while a video loads or can't play, so not much smaller than the video.
const WIDTH = 480;

export function draw(source: HTMLVideoElement | HTMLImageElement, width: number, height: number, targetWidth = WIDTH): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = Math.max(1, Math.round((targetWidth * height) / width));
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  } catch {
    return undefined;
  }
}

/**
 * Loads a stream playlist into `video` through hls.js, like the preview (SyncedMedia), for pictures and hover plays:
 * from `start` seconds, at the smallest quality still `width` wide (a 1080p part could take longer than allowed, as a
 * found stream through the relay did), loading only `ahead` seconds past where it is. Returns what stops it.
 */
export function playStream(video: HTMLVideoElement, url: string, width: number, start: number, failed: () => void, ahead = 1): () => void {
  let player: Hls | undefined;
  let stopped = false;
  void import("hls.js").then(
    ({ default: Hls }) => {
      if (stopped) return;
      // Not started until the quality is picked (it began on the best one, then switched), and no buffering ahead
      // (30 s after every seek): measured 22.9 s for a 5-minute stream's filmstrip at 20 Mbit/s.
      player = new Hls({ abrEwmaDefaultEstimate: 50_000_000, autoStartLoad: false, maxBufferLength: ahead, maxMaxBufferLength: ahead * 2, backBufferLength: 0 });
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) failed();
      });
      player.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (!player) return;
        const fits = data.levels.findIndex((level) => (level.width || 0) >= width);
        if (fits >= 0) {
          player.startLevel = fits;
          player.autoLevelCapping = fits;
        }
        player.startLoad(start);
      });
      player.loadSource(url);
      player.attachMedia(video);
    },
    () => failed(),
  );
  return () => {
    stopped = true;
    player?.destroy();
  };
}

/** `previewUrl` must be playable here (a file on this PC, or a cached preview). Resolves undefined when it can't be read. */
export function captureThumbnail(previewUrl: string, image?: boolean, hls?: boolean, time?: number, width = WIDTH): Promise<string | undefined> {
  return new Promise((resolve) => {
    let stop: (() => void) | undefined;
    let gone = false;
    const done = (value?: string) => {
      if (gone) return;
      gone = true;
      window.clearTimeout(timer);
      stop?.();
      resolve(value);
    };
    const timer = window.setTimeout(() => done(), 10_000);
    if (image) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => done(draw(img, img.naturalWidth, img.naturalHeight, width));
      img.onerror = () => done();
      img.src = previewUrl;
      return;
    }
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = time === undefined ? "metadata" : "auto";
    // One second in skips the black first frame most videos start with, unless a time is asked for.
    video.onloadedmetadata = () =>
      (video.currentTime =
        time === undefined ? Math.min(1, video.duration / 2 || 0) : Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05)));
    video.onseeked = () => {
      done(video.videoWidth ? draw(video, video.videoWidth, video.videoHeight, width) : undefined);
      video.removeAttribute("src");
      video.load();
    };
    video.onerror = () => done();
    if (hls) {
      stop = playStream(video, previewUrl, width, time ?? 1, () => done());
      return;
    }
    video.src = previewUrl;
  });
}

/** One frame of a filmstrip, 16:9. */
const FRAME_W = 128;
const FRAME_H = 72;

/** Frames across a whole video, side by side in one JPEG, for its clips on the timeline. */
export interface Strip {
  url: string;
  frames: number;
}

const strips = new Map<string, Promise<Strip | undefined>>();
let stripTurn: Promise<unknown> = Promise.resolve();

/**
 * A video's filmstrip, made once per address, one video at a time (a long project doesn't open
 * them all at once). `hls`: a stream playlist (each frame loads one of its parts), shown as it fills
 * through `partly`. Undefined when it can't be read, or a frame takes over 20 seconds.
 */
export function filmstrip(previewUrl: string, duration: number, hls?: boolean, partly?: (strip: Strip) => void): Promise<Strip | undefined> {
  let made = strips.get(previewUrl);
  if (!made) {
    made = stripTurn.then(() => drawStrip(previewUrl, duration, hls, partly)).catch(() => undefined);
    stripTurn = made;
    strips.set(previewUrl, made);
  }
  return made;
}

function drawStrip(previewUrl: string, duration: number, hls?: boolean, partly?: (strip: Strip) => void): Promise<Strip | undefined> {
  // About one frame every 6 seconds, at least 6 and at most 40.
  const frames = Math.round(Math.min(40, Math.max(6, duration / 6)));
  // A stream loads a part over the network for each frame: four players side by side, each a stretch of the video.
  // A file on this PC seeks fast enough with one.
  const lanes = hls ? Math.min(4, frames) : 1;
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = frames * FRAME_W;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext("2d")!;
    const videos: HTMLVideoElement[] = [];
    const stops: (() => void)[] = [];
    let drawn = 0;
    let timer = 0;
    let gone = false;
    const finish = (strip?: Strip) => {
      if (gone) return;
      gone = true;
      window.clearTimeout(timer);
      stops.forEach((stop) => stop());
      for (const video of videos) {
        video.removeAttribute("src");
        video.load();
      }
      resolve(strip);
    };
    // Per frame, not for the whole strip: a stream on slow Wi-Fi loads a part for each frame.
    const wait = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => finish(), 20_000);
    };
    wait();
    const at = (cell: number, video?: HTMLVideoElement) => ((cell + 0.5) / frames) * (video?.duration || duration);
    // Shown before it's whole: a cell not drawn yet borrows the nearest drawn one (a 5-minute stream takes ~13 s at 20 Mbit/s).
    const done: number[] = [];
    const showSoFar = () => {
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = FRAME_H;
      const c = copy.getContext("2d")!;
      for (let cell = 0; cell < frames; cell++) {
        const near = done.reduce((best, d) => (Math.abs(d - cell) < Math.abs(best - cell) ? d : best));
        c.drawImage(canvas, near * FRAME_W, 0, FRAME_W, FRAME_H, cell * FRAME_W, 0, FRAME_W, FRAME_H);
      }
      try {
        partly?.({ url: copy.toDataURL("image/jpeg", 0.7), frames });
      } catch {
        // A picture the page may not read: the whole strip fails the same way below.
      }
    };
    for (let lane = 0; lane < lanes; lane++) {
      const end = Math.floor(((lane + 1) * frames) / lanes);
      let cell = Math.floor((lane * frames) / lanes);
      const video = document.createElement("video");
      videos.push(video);
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.preload = "auto";
      video.onloadedmetadata = () => (video.currentTime = at(cell, video));
      video.onseeked = () => {
        // hls.js moves to its start place itself: only the frame asked for is drawn.
        if (gone || Math.abs(video.currentTime - at(cell, video)) > 0.5) return;
        // Cover the frame, keeping the picture's shape.
        const scale = Math.max(FRAME_W / video.videoWidth, FRAME_H / video.videoHeight);
        const [w, h] = [video.videoWidth * scale, video.videoHeight * scale];
        try {
          // Only inside its own cell, so a wide picture doesn't spill onto its neighbours.
          ctx.save();
          ctx.beginPath();
          ctx.rect(cell * FRAME_W, 0, FRAME_W, FRAME_H);
          ctx.clip();
          ctx.drawImage(video, cell * FRAME_W + (FRAME_W - w) / 2, (FRAME_H - h) / 2, w, h);
          ctx.restore();
        } catch {
          return finish();
        }
        drawn++;
        done.push(cell);
        wait();
        // After each round of the players (the first already spans the whole video).
        if (partly && drawn % lanes === 0 && drawn < frames) showSoFar();
        if (++cell < end) video.currentTime = at(cell, video);
        if (drawn === frames) {
          try {
            finish({ url: canvas.toDataURL("image/jpeg", 0.7), frames });
          } catch {
            finish();
          }
        }
      };
      video.onerror = () => finish();
      if (hls) stops.push(playStream(video, previewUrl, FRAME_W, at(cell), () => finish()));
      else video.src = previewUrl;
    }
  });
}

/** The frame of a video at `time` (media seconds), full size, as PNG bytes; undefined when it can't be read. */
export function captureFrame(previewUrl: string, time: number): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const done = (bytes?: Uint8Array) => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(bytes);
    };
    const timer = window.setTimeout(() => done(), 20_000);
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.onloadedmetadata = () => (video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05)));
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")!.drawImage(video, 0, 0);
        canvas.toBlob((blob) => (blob ? void blob.arrayBuffer().then((b) => done(new Uint8Array(b))) : done()), "image/png");
      } catch {
        done();
      }
    };
    video.onerror = () => done();
    video.src = previewUrl;
  });
}

/** The frame at `time` (media seconds) as a cover: a JPEG data URL up to 1280 wide; undefined when it can't be read. */
export async function coverFrame(previewUrl: string, time: number): Promise<string | undefined> {
  const bytes = await captureFrame(previewUrl, time);
  if (!bytes) return undefined;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
    const scale = Math.min(1, 1280 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return undefined;
  }
}
