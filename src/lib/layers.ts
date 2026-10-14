import type { Layer, LayerPosition, LayerSpec, MediaSource } from "../types";

/**
 * Position presets as fractions of the free space (0 = left/top, 1 = right/bottom).
 * The same numbers drive the live preview and FFmpeg's overlay, so they always match.
 */
export const POSITIONS: Record<LayerPosition, { label: string; x: number; y: number }> = {
  "top-left": { label: "Top left", x: 0.04, y: 0.06 },
  "top-right": { label: "Top right", x: 0.96, y: 0.06 },
  "bottom-left": { label: "Bottom left", x: 0.04, y: 0.94 },
  "bottom-right": { label: "Bottom right", x: 0.96, y: 0.94 },
  center: { label: "Center", x: 0.5, y: 0.5 },
};

export const SIZES = [
  { label: "Small", value: 0.25 },
  { label: "Medium", value: 0.4 },
  { label: "Large", value: 0.6 },
  { label: "Full frame", value: 1 },
];

/** A layer from a file opened with `openLocal`. Video files become picture-in-picture. */
export function layerFromSource(source: MediaSource, kind: Layer["kind"]): Layer {
  return {
    id: crypto.randomUUID(),
    kind,
    path: source.url,
    name: source.url.split(/[\\/]/).pop() ?? source.title,
    duration: source.duration,
    hasAudio: source.previewHasAudio !== false && source.streams.some((s) => s.kind === "audio"),
    previewUrl: source.previewUrl,
    start: 0,
    volume: kind === "audio" ? 0.8 : 1,
    size: 0.4,
    position: "bottom-right",
  };
}

export function layerSpec(layer: Layer): LayerSpec {
  const { x, y } = layer.size >= 1 ? POSITIONS.center : POSITIONS[layer.position];
  return { path: layer.path, kind: layer.kind, start: layer.start, volume: layer.volume, size: layer.size, x, y };
}
