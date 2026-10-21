/**
 * Small pictures for lists: a frame of a video file (or the image itself) drawn into a JPEG
 * data URL, so it still shows after a restart, when the file's preview link has expired.
 */
const WIDTH = 192;

function draw(source: HTMLVideoElement | HTMLImageElement, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = Math.max(1, Math.round((WIDTH * height) / width));
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
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
      img.onload = () => done(draw(img, img.naturalWidth, img.naturalHeight));
      img.onerror = () => done();
      img.src = previewUrl;
      return;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
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
