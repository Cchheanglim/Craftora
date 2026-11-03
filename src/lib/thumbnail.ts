/**
 * Small pictures for lists: a frame of a video file (or the image itself) drawn into a JPEG
 * data URL, so it still shows after a restart, when the file's preview link has expired.
 */
// Also the preview's stand-in while a video loads or can't play, so not much smaller than the video.
const WIDTH = 480;

function draw(source: HTMLVideoElement | HTMLImageElement, width: number, height: number): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = Math.max(1, Math.round((WIDTH * height) / width));
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  } catch {
    return undefined;
  }
}

/** `previewUrl` must be playable here (a file on this PC). Resolves undefined when it can't be read. */
export function captureThumbnail(previewUrl: string, image?: boolean): Promise<string | undefined> {
  return new Promise((resolve) => {
    const done = (value?: string) => {
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => done(), 10_000);
    if (image) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => done(draw(img, img.naturalWidth, img.naturalHeight));
      img.onerror = () => done();
      img.src = previewUrl;
      return;
    }
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";
    // One second in skips the black first frame most videos start with.
    video.onloadedmetadata = () => (video.currentTime = Math.min(1, video.duration / 2 || 0));
    video.onseeked = () => {
      done(video.videoWidth ? draw(video, video.videoWidth, video.videoHeight) : undefined);
      video.removeAttribute("src");
      video.load();
    };
    video.onerror = () => done();
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
 * them all at once). Undefined when it can't be read, or takes over a minute.
 */
export function filmstrip(previewUrl: string, duration: number): Promise<Strip | undefined> {
  let made = strips.get(previewUrl);
  if (!made) {
    made = stripTurn.then(() => drawStrip(previewUrl, duration)).catch(() => undefined);
    stripTurn = made;
    strips.set(previewUrl, made);
  }
  return made;
}

function drawStrip(previewUrl: string, duration: number): Promise<Strip | undefined> {
  // About one frame every 6 seconds, at least 6 and at most 40.
  const frames = Math.round(Math.min(40, Math.max(6, duration / 6)));
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = frames * FRAME_W;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext("2d")!;
    const video = document.createElement("video");
    let drawn = 0;
    const finish = (strip?: Strip) => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(strip);
    };
    const timer = window.setTimeout(() => finish(), 60_000);
    const seek = () => (video.currentTime = ((drawn + 0.5) / frames) * (video.duration || duration));
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.onloadedmetadata = seek;
    video.onseeked = () => {
      // Cover the frame, keeping the picture's shape.
      const scale = Math.max(FRAME_W / video.videoWidth, FRAME_H / video.videoHeight);
      const [w, h] = [video.videoWidth * scale, video.videoHeight * scale];
      try {
        // Only inside its own cell, so a wide picture doesn't spill onto its neighbours.
        ctx.save();
        ctx.beginPath();
        ctx.rect(drawn * FRAME_W, 0, FRAME_W, FRAME_H);
        ctx.clip();
        ctx.drawImage(video, drawn * FRAME_W + (FRAME_W - w) / 2, (FRAME_H - h) / 2, w, h);
        ctx.restore();
      } catch {
        return finish();
      }
      drawn++;
      if (drawn < frames) seek();
      else {
        try {
          finish({ url: canvas.toDataURL("image/jpeg", 0.7), frames });
        } catch {
          finish();
        }
      }
    };
    video.onerror = () => finish();
    video.src = previewUrl;
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
