import { useEffect, useRef, useState } from "react";
import { layerBox, placeAt, type PixelBox } from "../project/layerBox";
import type { ClipPatch } from "../project/actions";
import type { Clip, MediaItem } from "../project/model";

const SIDES = [
  ["left", "X"],
  ["top", "Y"],
  ["width", "W"],
  ["height", "H"],
] as const;

/** Image editor: a picture or shape layer's place and size typed in pixels of the image. */
export function LayerPlace({ clip, media, image, onChange }: { clip: Clip; media?: MediaItem; image: { width: number; height: number }; onChange: (patch: ClipPatch) => void }) {
  // The photo's own shape (width / height), read from the file itself; shapes don't need one.
  const [picture, setPicture] = useState<number | null>(null);
  const url = clip.shape ? undefined : media?.source.previewUrl;
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => img.naturalWidth && img.naturalHeight && setPicture(img.naturalWidth / img.naturalHeight);
    img.src = url;
  }, [url]);

  const ready = clip.shape || picture;
  const box = ready ? layerBox(clip, picture ?? 1, image.width, image.height) : null;
  // What's typed stays until Enter or leaving the box, then becomes the layer's place.
  const [typed, setTyped] = useState<Partial<Record<keyof PixelBox, string>>>({});
  const cancelled = useRef(false);

  const apply = (side: keyof PixelBox) => {
    const value = Number(typed[side]);
    setTyped({});
    if (cancelled.current) return void (cancelled.current = false);
    if (!box || !typed[side]?.trim() || !Number.isFinite(value)) return;
    const next = { ...box, [side]: value };
    // A picture keeps its shape: its height sets the width.
    if (!clip.shape && side === "height") next.width = (value * box.width) / box.height;
    onChange(placeAt(clip, picture ?? 1, image.width, image.height, next));
  };

  if (!box) return null;
  return (
    <div className="insp__pair">
      {SIDES.map(([side, label]) => (
        <div className="insp__field" key={side}>
          <label htmlFor={`insp-place-${side}`}>{label}</label>
          <input
            id={`insp-place-${side}`}
            className="field mono"
            inputMode="numeric"
            value={typed[side] ?? String(Math.round(box[side]))}
            onChange={(e) => setTyped({ [side]: e.target.value })}
            onBlur={() => apply(side)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      ))}
    </div>
  );
}
