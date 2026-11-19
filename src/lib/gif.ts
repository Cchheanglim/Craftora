export interface DecodedGif {
  frames: ImageBitmap[];
  times: number[];
  length: number;
}

const cache = new Map<string, Promise<DecodedGif>>();

/** Frame index shown at `t` seconds into an animated GIF clip, looping by `length`. */
export function gifFrameAt(times: number[], length: number, t: number): number {
  if (t <= 0 || length <= 0 || times.length <= 1) return 0;
  const mod = t % length;
  const at = mod + 1e-9 >= length ? 0 : mod;
  for (let i = times.length - 1; i >= 0; i--) {
    if (at + 1e-9 >= times[i]) return i;
  }
  return 0;
}

/** Decodes every frame of a GIF once with `ImageDecoder`, cached by URL. */
export function loadGif(url: string): Promise<DecodedGif> {
  const hit = cache.get(url);
  if (hit) return hit;
  const job = decodeGif(url).catch((err) => {
    cache.delete(url);
    throw err;
  });
  cache.set(url, job);
  return job;
}

async function decodeGif(url: string): Promise<DecodedGif> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GIF ${res.status}`);
  const blob = await res.blob();
  const data = await blob.arrayBuffer();
  const decoder = new ImageDecoder({ data, type: "image/gif" });
  try {
    await decoder.completed;
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    const frames: ImageBitmap[] = [];
    const times: number[] = [];
    let length = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      try {
        times.push(length);
        length += (image.duration || 100_000) / 1_000_000;
        frames.push(await createImageBitmap(image));
      } finally {
        image.close();
      }
    }
    return { frames, times, length };
  } finally {
    decoder.close();
  }
}
