import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { composeCanvas, photo } from "../lib/compose";
import { clipMaskBox, greyHex, maskAffine } from "../lib/mask";
import { apply, dabSpacing, dabsAlong, floodMask, hexOf, photoToImage, invert, rgbOf, scaleOf, tipStops, type Affine, type PaintColours, type PaintSettings, type PaintTool } from "../lib/paint";
import type { Clip, Project } from "../project/model";

/** What the Image editor paints with and where (Preview's `painting`); App keeps the settings and saves the results. */
export interface Painting {
  tool: PaintTool;
  settings: PaintSettings;
  colours: PaintColours;
  /** The layer painted on: a photo layer on this PC. None: the first stroke makes a new layer for itself. */
  clipId: string | null;
  /** True when painting into `clipId`'s layer mask instead of its pixels. */
  mask?: boolean;
  /** Adds an empty layer the picture's size and picks it; its clip id. */
  onNewLayer: () => Promise<string>;
  /** Layer `clipId` now looks like `png`: saves it and swaps the layer's photo (one undo step); the file's path. */
  onPainted: (clipId: string, png: Blob) => Promise<string>;
  /** Live mask PNG data URL during a stroke (null when finished), so the layer's CSS mask updates under the brush. */
  onMaskLive?: (clipId: string, dataUrl: string | null) => void;
  /** Layer `clipId`'s mask finished: sets `Clip.mask` to the new PNG data URL (one undo step, no file on disk). */
  onMaskPainted?: (clipId: string, dataUrl: string) => void;
  /** Eyedropper: the picture's colour under the click (Alt: for the background colour). */
  onColour: (color: string, background: boolean) => void;
  onError: (message: string) => void;
}

/**
 * A layer's pixels while they're painted: shown in place of its photo (`clipId`), or over everything while its new
 * layer is being made (null). `settled` = saved; shown until the layer's new photo has loaded.
 */
export interface LivePaint {
  clipId: string | null;
  canvas: HTMLCanvasElement;
  settled: boolean;
}

type Pt = [number, number];

/** One stroke, fill or gradient on one layer, in the layer's own pixels. */
interface Session {
  clipId: string | null;
  /** True when painting into `clipId`'s layer mask instead of its pixels. */
  mask?: boolean;
  maskSeq?: number;
  done?: boolean;
  /** The new layer being made for it (no `clipId` yet). */
  made?: Promise<string>;
  /** Picture pixel → layer pixel. */
  toLayer: Affine;
  base: HTMLCanvasElement;
  live: HTMLCanvasElement;
  // The brush: its dabs so far, one dab, its width (layer px), where it last was.
  dabs?: HTMLCanvasElement;
  tip?: HTMLCanvasElement;
  width: number;
  last?: Pt;
  carry: number;
  dirty?: [number, number, number, number];
}

interface Op {
  tool: PaintTool;
  start: Pt;
  end: Pt;
  /** Brush points (picture px) waiting for the layer's pixels. */
  waiting: Pt[];
  ended: boolean;
  session?: Session;
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  // On the graphics card (strokes redraw often); the bucket reads its layer back once.
  return [canvas, canvas.getContext("2d")!] as const;
}

function copyOf(source: HTMLCanvasElement) {
  const [canvas, ctx] = canvasOf(source.width, source.height);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** One brush dab `width` px across, solid to `hardness` of the way out, then fading. */
function tipOf(width: number, hardness: number, colour: string) {
  const size = Math.ceil(width) + 2;
  const [canvas, ctx] = canvasOf(size, size);
  const [r, g, b] = rgbOf(colour);
  if (hardness >= 0.99 || width < 3) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, width / 2, 0, 2 * Math.PI);
    ctx.fill();
    return canvas;
  }
  const fade = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, width / 2);
  fade.addColorStop(0, `rgba(${r},${g},${b},1)`);
  for (const [at, alpha] of tipStops(hardness)) fade.addColorStop(at, `rgba(${r},${g},${b},${alpha})`);
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * The canvas as a PNG. Not `toBlob`: it waits for the page to be idle, which right after a stroke took 7 s in the
 * test copy (an off-screen copy encodes at once).
 */
export function pngOf(canvas: HTMLCanvasElement) {
  const copy = new OffscreenCanvas(canvas.width, canvas.height);
  copy.getContext("2d")!.drawImage(canvas, 0, 0);
  return copy.convertToBlob({ type: "image/png" });
}

const LIVE_MASK_MS = 70;

function loadMaskCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [canvas, ctx] = canvasOf(img.naturalWidth || img.width, img.naturalHeight || img.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error("Couldn't read the layer mask."));
    img.src = dataUrl;
  });
}

async function dataUrlOf(canvas: HTMLCanvasElement): Promise<string> {
  if (typeof OffscreenCanvas === "undefined") return canvas.toDataURL("image/png");
  const blob = await pngOf(canvas);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't encode the layer mask."));
    reader.readAsDataURL(blob);
  });
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The painting tools over the Image editor's stage: Brush and Eraser strokes, Paint bucket and Gradient on the picked
 * layer's own pixels (any crop, turn, angle or mirror), and the Eyedropper. Each stroke ends as one undo step.
 */
export function PaintSurface({ painting, project, width: W, height: H, onLive }: { painting: Painting; project: Project; width: number; height: number; onLive: (live: LivePaint | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLSpanElement>(null);
  const op = useRef<Op | null>(null);
  const [guide, setGuide] = useState<[Pt, Pt] | null>(null);
  // Read by the handlers between renders.
  const now = useRef({ painting, project });
  now.current = { painting, project };
  // shortcut: every stroke leaves a PNG in AppData/cutouts (undo needs the old ones); sweep files no project uses once
  // there are many.
  // Each layer's latest pixels while saved and after (`url` = its file once saved), so the next stroke builds on them.
  const latest = useRef(new Map<string, { canvas: HTMLCanvasElement; url: string | null }>());
  // Each layer's latest mask canvas (`url` = its data URL once set), so consecutive strokes build on it without re-decoding.
  const latestMask = useRef(new Map<string, { canvas: HTMLCanvasElement; url: string | null }>());
  // The picked photo's pixels, read ahead so the first stroke starts at once.
  const read = useRef<{ url: string; pixels: Promise<HTMLCanvasElement> } | null>(null);
  const readMask = useRef<{ url: string; pixels: Promise<HTMLCanvasElement> } | null>(null);
  const maskSeq = useRef(0);
  const liveMaskTimer = useRef(0);
  const lastLivePush = useRef(0);
  const encodingLive = useRef(false);
  // Saves land in the order they were painted.
  const saving = useRef(Promise.resolve());
  // The new layer the last stroke made, until it's the picked layer (strokes before that go onto it too).
  const fresh = useRef<{ made: Promise<string>; canvas: HTMLCanvasElement } | null>(null);
  useEffect(() => {
    fresh.current = null;
  }, [painting.clipId]);

  const target = painting.clipId ? project.clips.find((c) => c.id === painting.clipId) : undefined;
  const targetUrl = project.media.find((m) => m.id === target?.mediaId)?.source.url;
  const pixelsOf = (url: string) => {
    if (read.current?.url !== url) {
      const pixels = photo(url).then((img) => {
        const [canvas, ctx] = canvasOf(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, 0, 0);
        return canvas;
      });
      read.current = { url, pixels };
    }
    return read.current.pixels;
  };
  useEffect(() => {
    if (!painting.mask && targetUrl && painting.tool !== "eyedropper") pixelsOf(targetUrl).catch(() => read.current?.url === targetUrl && (read.current = null));
    // pixelsOf only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUrl, painting.tool, painting.mask]);

  const maskPixelsOf = (url: string) => {
    if (readMask.current?.url !== url) readMask.current = { url, pixels: loadMaskCanvas(url) };
    return readMask.current.pixels;
  };
  const targetMask = painting.mask ? target?.mask : undefined;
  useEffect(() => {
    if (targetMask && !op.current && painting.tool !== "eyedropper") maskPixelsOf(targetMask).catch(() => readMask.current?.url === targetMask && (readMask.current = null));
    // maskPixelsOf only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMask, painting.tool]);

  const maskBoxFor = async (clip: Clip, proj: Project) => {
    let photoAspect = W / H;
    if (clip.mediaId) {
      const shown = document.querySelector<HTMLImageElement>(`[data-clip="${CSS.escape(clip.id)}"] img`);
      if (shown?.naturalWidth && shown.naturalHeight) {
        photoAspect = shown.naturalWidth / shown.naturalHeight;
      } else {
        const media = proj.media.find((m) => m.id === clip.mediaId);
        if (media?.source.image && media.source.local) {
          const img = await pixelsOf(media.source.url);
          photoAspect = img.width / img.height;
        } else if (media?.source.previewUrl) {
          const img = await loadMaskCanvas(media.source.previewUrl).catch(() => null);
          if (img) photoAspect = img.width / img.height;
        }
      }
    }
    return clipMaskBox(clip, W, H, photoAspect);
  };

  const pushLiveMask = (s: Session) => {
    if (!s.mask || s.done || !s.clipId) return;
    const emit = () => {
      liveMaskTimer.current = 0;
      if (s.done || !s.clipId || s.maskSeq !== maskSeq.current || encodingLive.current) return;
      encodingLive.current = true;
      lastLivePush.current = performance.now();
      void dataUrlOf(s.live)
        .then((url) => {
          if (!s.done && s.clipId && s.maskSeq === maskSeq.current) now.current.painting.onMaskLive?.(s.clipId, url);
        })
        .catch(() => {})
        .finally(() => {
          encodingLive.current = false;
        });
    };
    const elapsed = performance.now() - lastLivePush.current;
    if (elapsed >= LIVE_MASK_MS && !encodingLive.current) {
      window.clearTimeout(liveMaskTimer.current);
      emit();
    } else if (!liveMaskTimer.current) {
      liveMaskTimer.current = window.setTimeout(emit, Math.max(10, LIVE_MASK_MS - elapsed));
    }
  };

  const brushWidth = painting.tool === "brush" || painting.tool === "eraser" ? painting.settings[painting.tool].size : 0;

  /** Where the pointer is on the picture, in its pixels. */
  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  /** The layer (or its mask) to paint on, its pixels ready: the picked layer, or a new one. */
  const open = async (): Promise<Session> => {
    const { painting: p, project: proj } = now.current;
    if (p.mask) {
      const clip = p.clipId ? proj.clips.find((c) => c.id === p.clipId) : undefined;
      if (!clip?.mask) throw new Error("No layer mask to paint on.");
      if (proj.tracks.find((t) => t.id === clip.trackId)?.locked) throw new Error("Unlock this layer to paint on its mask.");
      const known = latestMask.current.get(clip.id);
      const base = known && (known.url === null || known.url === clip.mask) ? known.canvas : await maskPixelsOf(clip.mask);
      const toLayer = maskAffine(await maskBoxFor(clip, proj), base);
      return { clipId: clip.id, mask: true, maskSeq: ++maskSeq.current, toLayer, base, live: copyOf(base), width: 0, carry: 0 };
    }
    const clip = p.clipId ? proj.clips.find((c) => c.id === p.clipId) : undefined;
    const media = proj.media.find((m) => m.id === clip?.mediaId);
    if (!clip || !media) {
      // A new layer, or the one the last stroke is still making (it isn't picked yet).
      const base = fresh.current?.canvas ?? canvasOf(W, H)[0];
      return { clipId: null, toLayer: [1, 0, 0, 1, 0, 0], base, live: copyOf(base), width: 0, carry: 0 };
    }
    const known = latest.current.get(clip.id);
    const base = known && (known.url === null || known.url === media.source.url) ? known.canvas : await pixelsOf(media.source.url);
    const toLayer = invert(photoToImage(clip, base, W, H, clip.effect === "mirror"));
    return { clipId: clip.id, toLayer, base, live: copyOf(base), width: 0, carry: 0 };
  };

  const show = (s: Session, settled = false) => onLive({ clipId: s.clipId, canvas: s.live, settled });

  /** The session's result becomes the layer's photo or mask (after the saves before it). */
  const save = (s: Session) => {
    if (s.mask && s.clipId) {
      const clipId = s.clipId;
      const seq = s.maskSeq;
      const urlPromise = dataUrlOf(s.live);
      urlPromise.catch(() => {});
      saving.current = saving.current.then(async () => {
        const entry = { canvas: s.live, url: null as string | null };
        const known = latestMask.current;
        known.delete(clipId);
        known.set(clipId, entry);
        for (const old of known.keys()) if (known.size > 4) known.delete(old);
        try {
          const url = await urlPromise;
          entry.url = url;
          now.current.painting.onMaskPainted?.(clipId, url);
          if (seq === maskSeq.current) now.current.painting.onMaskLive?.(clipId, null);
        } catch (err) {
          if (latestMask.current.get(clipId) === entry) latestMask.current.delete(clipId);
          if (seq === maskSeq.current) now.current.painting.onMaskLive?.(clipId, null);
          now.current.painting.onError(`Couldn't paint mask: ${message(err)}`);
        }
      });
      return;
    }
    if (s.clipId === null) {
      // The layer is made once something is painted on it.
      if (!fresh.current) {
        const made = now.current.painting.onNewLayer();
        // Its failure is reported below.
        made.catch(() => {});
        fresh.current = { made, canvas: s.live };
      }
      fresh.current.canvas = s.live;
      s.made = fresh.current.made;
    }
    // Made into a file now, while the saves before it finish.
    const png = pngOf(s.live);
    png.catch(() => {});
    saving.current = saving.current.then(async () => {
      const entry = { canvas: s.live, url: null as string | null };
      let clipId: string | undefined;
      try {
        clipId = s.clipId ?? (await s.made!);
        const known = latest.current;
        known.delete(clipId);
        known.set(clipId, entry);
        // Only the last few layers' pixels are kept; the others are read from their files again.
        for (const old of known.keys()) if (known.size > 4) known.delete(old);
        entry.url = await now.current.painting.onPainted(clipId, await png);
        onLive({ clipId, canvas: s.live, settled: true });
      } catch (err) {
        if (clipId && latest.current.get(clipId) === entry) latest.current.delete(clipId);
        onLive(null);
        now.current.painting.onError(`Couldn't paint: ${message(err)}`);
      }
    });
  };

  // Brush and Eraser.
  const dab = (s: Session, [x, y]: Pt) => {
    const tip = s.tip!;
    s.dabs!.getContext("2d")!.drawImage(tip, x - tip.width / 2, y - tip.height / 2);
    const h = tip.width / 2;
    const d = s.dirty;
    s.dirty = d ? [Math.min(d[0], x - h), Math.min(d[1], y - h), Math.max(d[2], x + h), Math.max(d[3], y + h)] : [x - h, y - h, x + h, y + h];
  };
  const stroke = (s: Session, points: Pt[]) => {
    for (const p of points) {
      const q = apply(s.toLayer, p);
      if (!s.last) dab(s, q);
      else {
        const { dabs, carry } = dabsAlong(s.last, q, dabSpacing(s.width), s.carry);
        for (const d of dabs) dab(s, d);
        s.carry = carry;
      }
      s.last = q;
    }
  };
  /** Draws the stroke so far into the shown pixels, only where it changed. */
  const redraw = (s: Session, tool: "brush" | "eraser") => {
    if (!s.dirty) return;
    const { opacity } = now.current.painting.settings[tool];
    const [x0, y0] = [Math.max(0, Math.floor(s.dirty[0])), Math.max(0, Math.floor(s.dirty[1]))];
    const [x1, y1] = [Math.min(s.live.width, Math.ceil(s.dirty[2])), Math.min(s.live.height, Math.ceil(s.dirty[3]))];
    s.dirty = undefined;
    if (x1 <= x0 || y1 <= y0) return;
    const [w, h] = [x1 - x0, y1 - y0];
    const ctx = s.live.getContext("2d")!;
    ctx.clearRect(x0, y0, w, h);
    ctx.drawImage(s.base, x0, y0, w, h, x0, y0, w, h);
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = !s.mask && tool === "eraser" ? "destination-out" : "source-over";
    ctx.drawImage(s.dabs!, x0, y0, w, h, x0, y0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (s.mask) pushLiveMask(s);
  };
  const frame = useRef(0);
  const later = (s: Session, tool: "brush" | "eraser") => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      redraw(s, tool);
    });
  };

  /** Paint bucket at `p` (picture px) on the session's layer. */
  const fill = (s: Session, p: Pt) => {
    const { colours, settings } = now.current.painting;
    const [x, y] = apply(s.toLayer, p);
    const [w, h] = [s.base.width, s.base.height];
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const mask = floodMask(s.base.getContext("2d")!.getImageData(0, 0, w, h).data, w, h, x, y, settings.bucket.tolerance, settings.bucket.contiguous);
    const [paint, pctx] = canvasOf(w, h);
    const pixels = pctx.createImageData(w, h);
    const [r, g, b] = rgbOf(s.mask ? greyHex(colours.fg) : colours.fg);
    // ImageData's bytes as one number per pixel (little-endian: alpha highest).
    const colour = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    const out = new Uint32Array(pixels.data.buffer);
    for (let i = 0; i < mask.length; i++) if (mask[i]) out[i] = colour;
    pctx.putImageData(pixels, 0, 0);
    const ctx = s.live.getContext("2d")!;
    ctx.globalAlpha = settings.bucket.opacity;
    ctx.drawImage(paint, 0, 0);
    ctx.globalAlpha = 1;
    return true;
  };

  /** Gradient from `a` to `b` (picture px) over the session's whole layer. */
  const gradient = (s: Session, a: Pt, b: Pt) => {
    const { colours, settings } = now.current.painting;
    const [p, q] = [apply(s.toLayer, a), apply(s.toLayer, b)];
    const ctx = s.live.getContext("2d")!;
    const g = settings.gradient.kind === "radial" ? ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], Math.hypot(q[0] - p[0], q[1] - p[1])) : ctx.createLinearGradient(p[0], p[1], q[0], q[1]);
    const fg = s.mask ? greyHex(colours.fg) : colours.fg;
    const bg = s.mask ? greyHex(colours.bg) : colours.bg;
    const [r, gr, bl] = rgbOf(fg);
    g.addColorStop(0, fg);
    g.addColorStop(1, settings.gradient.to === "clear" ? `rgba(${r},${gr},${bl},0)` : bg);
    ctx.globalAlpha = settings.gradient.opacity;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s.live.width, s.live.height);
    ctx.globalAlpha = 1;
  };

  /** The layer's pixels arrived: catch up with the pointer, and finish if it already let go. */
  const ready = (o: Op, s: Session) => {
    o.session = s;
    if (o.tool === "brush" || o.tool === "eraser") {
      const { size, hardness, flow } = now.current.painting.settings[o.tool];
      s.width = Math.max(1, size * scaleOf(s.toLayer));
      const colour = s.mask
        ? greyHex(o.tool === "eraser" ? now.current.painting.colours.bg : now.current.painting.colours.fg)
        : o.tool === "eraser"
          ? "#000000"
          : now.current.painting.colours.fg;
      s.tip = tipOf(s.width, hardness, colour);
      // Each dab adds `flow`; the stroke as a whole stops at its opacity (redraw).
      const [dabs, dctx] = canvasOf(s.base.width, s.base.height);
      dctx.globalAlpha = flow;
      s.dabs = dabs;
      if (!s.mask) show(s);
      stroke(s, o.waiting.splice(0));
      redraw(s, o.tool);
    }
    if (o.ended) finish(o);
  };

  const finish = (o: Op) => {
    const s = o.session;
    op.current = null;
    setGuide(null);
    if (!s) return;
    if (o.tool === "brush" || o.tool === "eraser") {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      window.clearTimeout(liveMaskTimer.current);
      liveMaskTimer.current = 0;
      s.done = true;
      redraw(s, o.tool);
      return save(s);
    }
    if (o.tool === "bucket") {
      if (!fill(s, o.start)) return s.mask ? undefined : onLive(null);
    } else {
      // A click without a drag draws no gradient.
      const r = ref.current!.getBoundingClientRect();
      if (Math.hypot(o.end[0] - o.start[0], o.end[1] - o.start[1]) * (r.width / W) < 3) return;
      gradient(s, o.start, o.end);
    }
    s.done = true;
    if (!s.mask) show(s);
    save(s);
  };

  const pick = async (p: Pt, background: boolean) => {
    const { project: proj, painting: paint } = now.current;
    if (paint.mask && paint.clipId) {
      const clip = proj.clips.find((c) => c.id === paint.clipId);
      if (!clip?.mask) return;
      try {
        const known = latestMask.current.get(clip.id);
        const canvas = known && (known.url === null || known.url === clip.mask) ? known.canvas : await maskPixelsOf(clip.mask);
        const [mx, my] = apply(maskAffine(await maskBoxFor(clip, proj), canvas), p).map(Math.floor);
        const [r, g, b] =
          mx >= 0 && my >= 0 && mx < canvas.width && my < canvas.height ? canvas.getContext("2d")!.getImageData(mx, my, 1, 1).data : [0, 0, 0];
        paint.onColour(greyHex(hexOf(r, g, b)), background);
      } catch (err) {
        paint.onError(`Couldn't read the colour: ${message(err)}`);
      }
      return;
    }
    // A small copy is enough to read one pixel, and quick on a big picture.
    const k = Math.min(1, 1200 / Math.max(W, H));
    try {
      const canvas = await composeCanvas(proj, { width: Math.round(W * k), height: Math.round(H * k) });
      const [x, y] = [Math.min(canvas.width - 1, Math.max(0, Math.floor(p[0] * k))), Math.min(canvas.height - 1, Math.max(0, Math.floor(p[1] * k)))];
      const [r, g, b] = canvas.getContext("2d")!.getImageData(x, y, 1, 1).data;
      paint.onColour(hexOf(r, g, b), background);
    } catch (err) {
      paint.onError(`Couldn't read the colour: ${message(err)}`);
    }
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || op.current) return;
    e.preventDefault();
    const p = at(e);
    const tool = now.current.painting.tool;
    if (tool === "eyedropper") return void pick(p, e.altKey);
    e.currentTarget.setPointerCapture(e.pointerId);
    const o: Op = { tool, start: p, end: p, waiting: [p], ended: false };
    op.current = o;
    open().then(
      (s) => ready(o, s),
      (err) => {
        op.current = null;
        now.current.painting.onError(`Couldn't paint on this layer: ${message(err)}`);
      },
    );
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = at(e);
    if (cursor.current) Object.assign(cursor.current.style, { left: `${(p[0] / W) * 100}%`, top: `${(p[1] / H) * 100}%`, display: "block" });
    const o = op.current;
    if (!o || o.ended) return;
    o.end = p;
    if (o.tool === "gradient") return setGuide([o.start, p]);
    if (o.tool !== "brush" && o.tool !== "eraser") return;
    // Every point the pointer passed, not just one per frame, so quick strokes stay smooth.
    const points = (e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]).map(at);
    if (!o.session) return void o.waiting.push(...points);
    stroke(o.session, points);
    later(o.session, o.tool);
  };

  const up = () => {
    const o = op.current;
    if (!o || o.ended) return;
    o.ended = true;
    if (o.session) finish(o);
  };

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(liveMaskTimer.current);
    },
    [],
  );

  const brushy = painting.tool === "brush" || painting.tool === "eraser";
  return (
    <div
      ref={ref}
      className={`preview__paint is-${painting.tool}`}
      role="application"
      aria-label={painting.tool === "eyedropper" ? "Click to pick a colour" : "Paint on the picture"}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => cursor.current && (cursor.current.style.display = "none")}
      onClick={(e) => e.stopPropagation()}
    >
      {brushy && <span ref={cursor} className="preview__brush" style={{ width: `${(brushWidth / W) * 100}%` }} aria-hidden="true" />}
      {guide && (
        <svg className="preview__guide" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1={guide[0][0]} y1={guide[0][1]} x2={guide[1][0]} y2={guide[1][1]} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  );
}

/** Shows a canvas made elsewhere (a layer being painted) as one element with `className` and `style`. */
export function LiveCanvas({ canvas, className, style }: { canvas: HTMLCanvasElement; className: string; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
    ref.current?.replaceChildren(canvas);
  }, [canvas]);
  return <span ref={ref} className={className} style={style} aria-hidden="true" />;
}
