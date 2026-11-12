import { useEffect, useRef, useState } from "react";
import type { Clip, Project } from "../project/model";
import { layersOf } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import { shapeLabel } from "../project/shapes";
import { Icon } from "./Icon";
import "./LayersPanel.css";

interface DragState {
  index: number;
  pointerId: number;
  startY: number;
  currentY: number;
  isDragging: boolean;
  dropIndex: number;
}

interface DragInfo {
  index: number;
  deltaY: number;
  dropIndex: number;
}

function layerName(clip: Clip, project: Project): string {
  if (clip.name) return clip.name;
  if (clip.mediaId) {
    const media = project.media.find((m) => m.id === clip.mediaId);
    return media?.name || "Image";
  }
  if (clip.shape) {
    return shapeLabel(clip.shape);
  }
  return clip.text?.split("\n")[0]?.trim() || "Text";
}

export function LayersPanel({
  project,
  api,
  selectedId,
  onSelect,
}: {
  project: Project;
  api: ProjectApi;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const layers = layersOf(project);
  const selectedClip = selectedId ? project.clips.find((c) => c.id === selectedId) ?? null : null;
  const selectedTrack = selectedClip ? project.tracks.find((t) => t.id === selectedClip.trackId) ?? null : null;

  // Opacity row state (clamped 0-100)
  const [opacityText, setOpacityText] = useState("100");
  useEffect(() => {
    if (selectedClip) {
      setOpacityText(String(Math.round((selectedClip.opacity ?? 1) * 100)));
    } else {
      setOpacityText("100");
    }
  }, [selectedClip?.id, selectedClip?.opacity]);

  const applyOpacity = (val: string) => {
    if (!selectedClip) return;
    const num = Number(val);
    const clamped = Number.isNaN(num)
      ? Math.round((selectedClip.opacity ?? 1) * 100)
      : Math.min(100, Math.max(0, Math.round(num)));
    setOpacityText(String(clamped));
    // Leaving the field unchanged isn't an edit (no empty Undo step).
    if (clamped === Math.round((selectedClip.opacity ?? 1) * 100)) return;
    api.edit({
      type: "updateClip",
      clipId: selectedClip.id,
      patch: { opacity: clamped / 100 },
    });
  };

  const handleOpacityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!selectedClip) return;
    if (e.key === "Enter") {
      e.preventDefault();
      applyOpacity(opacityText);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const delta = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
      const num = Number(opacityText);
      const cur = Number.isNaN(num) ? Math.round((selectedClip.opacity ?? 1) * 100) : num;
      const next = Math.min(100, Math.max(0, Math.round(cur + delta)));
      setOpacityText(String(next));
      api.edit({
        type: "updateClip",
        clipId: selectedClip.id,
        patch: { opacity: next / 100 },
      });
    }
  };

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const editingCancelledRef = useRef(false);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const saveName = (clipId: string, val: string) => {
    if (editingCancelledRef.current) return;
    editingCancelledRef.current = true;
    api.edit({
      type: "updateClip",
      clipId,
      patch: { name: val.trim() || undefined },
    });
    setEditingId(null);
  };

  const cancelName = () => {
    editingCancelledRef.current = true;
    setEditingId(null);
  };

  // Reorder drag state
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const justDraggedRef = useRef(false);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);

  const handlePointerDown = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    dragRef.current = {
      index,
      pointerId: e.pointerId,
      startY: e.clientY,
      currentY: e.clientY,
      isDragging: false,
      dropIndex: index,
    };
  };

  const handlePointerMove = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    const cur = dragRef.current;
    if (!cur || cur.index !== index) return;
    const deltaY = e.clientY - cur.startY;
    if (!cur.isDragging) {
      if (Math.abs(deltaY) < 4) return;
      cur.isDragging = true;
    }
    cur.currentY = e.clientY;

    let closest = index;
    let minDistance = Infinity;
    rowRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const center = (r.top + r.bottom) / 2;
      const dist = Math.abs(e.clientY - center);
      if (dist < minDistance) {
        minDistance = dist;
        closest = i;
      }
    });
    cur.dropIndex = closest;

    setDragInfo({
      index: cur.index,
      deltaY: cur.currentY - cur.startY,
      dropIndex: cur.dropIndex,
    });
  };

  const handlePointerUp = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    const cur = dragRef.current;
    if (!cur || cur.index !== index) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const wasDragging = cur.isDragging;
    const targetK = cur.dropIndex;
    dragRef.current = null;
    setDragInfo(null);

    if (wasDragging) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 80);

      if (targetK !== index && layers[targetK]) {
        const targetTrackId = layers[targetK].track.id;
        const to = project.tracks.findIndex((t) => t.id === targetTrackId);
        if (to !== -1) {
          api.edit({
            type: "moveTrack",
            trackId: layers[index].track.id,
            to,
          });
        }
      }
    }
  };

  const handlePointerCancel = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.index === index) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      dragRef.current = null;
      setDragInfo(null);
    }
  };

  // Landing indicator calculation
  let indicatorTop: number | null = null;
  if (dragInfo && listRef.current) {
    const list = listRef.current;
    const listRect = list.getBoundingClientRect();
    const k = dragInfo.dropIndex;
    const dragIdx = dragInfo.index;
    const targetEl = rowRefs.current[k];
    if (targetEl) {
      const r = targetEl.getBoundingClientRect();
      if (k < dragIdx) {
        indicatorTop = r.top - listRect.top + list.scrollTop;
      } else if (k > dragIdx) {
        indicatorTop = r.bottom - listRect.top + list.scrollTop - 2;
      } else {
        indicatorTop = r.top - dragInfo.deltaY - listRect.top + list.scrollTop;
      }
    }
  }

  return (
    <section className="layers-panel" aria-label="Layers">
      {/* Opacity row */}
      <div className="layers-panel__control-row">
        <label htmlFor="layers-opacity-input" className="layers-panel__control-label">
          Opacity
        </label>
        <div className="layers-panel__opacity-wrap">
          <input
            id="layers-opacity-input"
            type="number"
            min={0}
            max={100}
            step={1}
            className="layers-panel__opacity-input"
            value={selectedClip ? opacityText : "100"}
            disabled={!selectedClip}
            onChange={(e) => setOpacityText(e.target.value)}
            onKeyDown={handleOpacityKeyDown}
            onBlur={() => applyOpacity(opacityText)}
          />
          <span className="layers-panel__opacity-unit" aria-hidden="true">
            %
          </span>
        </div>
      </div>

      {/* Lock row */}
      <div className="layers-panel__control-row">
        <span className="layers-panel__control-label">Lock</span>
        <button
          type="button"
          className="layers-panel__icon-btn"
          aria-label="Lock layer"
          aria-pressed={Boolean(selectedTrack?.locked)}
          disabled={!selectedClip || !selectedTrack}
          onClick={() => {
            if (!selectedTrack) return;
            api.edit({
              type: "updateTrack",
              trackId: selectedTrack.id,
              patch: { locked: !selectedTrack.locked },
            });
          }}
        >
          <Icon name={selectedTrack?.locked ? "lock" : "unlock"} size={14} />
        </button>
      </div>

      {/* Layers list */}
      <div className="layers-panel__list" ref={listRef}>
        {layers.length === 0 ? (
          <p className="layers-panel__empty">Add a picture, text or shape from the left.</p>
        ) : (
          layers.map(({ track, clip }, index) => {
            const isSelected = clip.id === selectedId;
            const isDragging = dragInfo?.index === index;
            const media = clip.mediaId ? project.media.find((m) => m.id === clip.mediaId) : undefined;
            const src = media?.source?.thumbnail || media?.source?.previewUrl;

            const rowStyle: React.CSSProperties | undefined = isDragging
              ? { transform: `translateY(${dragInfo.deltaY}px)`, zIndex: 10 }
              : undefined;

            return (
              <div
                key={clip.id}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                className={`layers-panel__row${isSelected ? " is-selected" : ""}${
                  track.hidden ? " is-hidden" : ""
                }${track.locked ? " is-locked" : ""}${isDragging ? " is-dragging" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                style={rowStyle}
                onPointerDown={(e) => handlePointerDown(index, e)}
                onPointerMove={(e) => handlePointerMove(index, e)}
                onPointerUp={(e) => handlePointerUp(index, e)}
                onPointerCancel={(e) => handlePointerCancel(index, e)}
                onClick={() => {
                  if (justDraggedRef.current || editingId) return;
                  if (!track.locked) {
                    onSelect(clip.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (editingId || e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!track.locked) {
                      onSelect(clip.id);
                    }
                  }
                }}
              >
                {/* Hide / Show eye button */}
                <button
                  type="button"
                  className="layers-panel__icon-btn"
                  aria-label={track.hidden ? "Show layer" : "Hide layer"}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    api.edit({
                      type: "updateTrack",
                      trackId: track.id,
                      patch: { hidden: !track.hidden },
                    });
                  }}
                >
                  <Icon name={track.hidden ? "eyeOff" : "eye"} size={14} />
                </button>

                {/* 28x28 Thumbnail */}
                {clip.mediaId ? (
                  <div className="layers-panel__thumb layers-panel__thumb--checker">
                    {src ? (
                      <img src={src} alt="" className="layers-panel__thumb-img" draggable={false} />
                    ) : (
                      <Icon name="image" size={16} />
                    )}
                  </div>
                ) : clip.shape ? (
                  <div className="layers-panel__thumb">
                    <Icon name="star" size={16} />
                  </div>
                ) : (
                  <div className="layers-panel__thumb">
                    <span className="layers-panel__thumb-text">T</span>
                  </div>
                )}

                {/* Layer Name / Inline Rename Input */}
                {editingId === clip.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    className="layers-panel__name-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveName(clip.id, editingName);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelName();
                      }
                    }}
                    onBlur={() => saveName(clip.id, editingName)}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="layers-panel__name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      editingCancelledRef.current = false;
                      setEditingId(clip.id);
                      setEditingName(clip.name ?? layerName(clip, project));
                    }}
                  >
                    {layerName(clip, project)}
                  </span>
                )}

                {/* Lock indicator */}
                {track.locked && (
                  <span className="layers-panel__lock-indicator" role="img" aria-label="Locked">
                    <Icon name="lock" size={12} />
                  </span>
                )}
              </div>
            );
          })
        )}

        {/* Background row (always last, not draggable, not selectable) */}
        <div className="layers-panel__row layers-panel__row--bg">
          <div className="layers-panel__eye-placeholder" />
          <div
            className="layers-panel__thumb-bg"
            style={{ backgroundColor: project.image?.background ?? "#000" }}
          />
          <span className="layers-panel__name layers-panel__name--bg">Background</span>
          <span className="layers-panel__lock-indicator" role="img" aria-label="Locked">
            <Icon name="lock" size={12} />
          </span>
        </div>

        {/* 2px drop indicator line */}
        {indicatorTop !== null && (
          <div className="layers-panel__drop-indicator" style={{ top: `${indicatorTop}px` }} />
        )}
      </div>

      {/* Bottom bar */}
      <div className="layers-panel__bottom-bar">
        <button
          type="button"
          className="layers-panel__icon-btn"
          aria-label="Move layer up"
          disabled={!selectedClip}
          onClick={() => {
            if (!selectedTrack) return;
            const idx = project.tracks.findIndex((t) => t.id === selectedTrack.id);
            if (idx > 0) {
              api.edit({
                type: "moveTrack",
                trackId: selectedTrack.id,
                to: idx - 1,
              });
            }
          }}
        >
          <svg
            aria-hidden="true"
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>

        <button
          type="button"
          className="layers-panel__icon-btn"
          aria-label="Move layer down"
          disabled={!selectedClip}
          onClick={() => {
            if (!selectedTrack) return;
            const idx = project.tracks.findIndex((t) => t.id === selectedTrack.id);
            if (idx !== -1 && idx < project.tracks.length - 1) {
              api.edit({
                type: "moveTrack",
                trackId: selectedTrack.id,
                to: idx + 1,
              });
            }
          }}
        >
          <svg
            aria-hidden="true"
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        <button
          type="button"
          className="layers-panel__icon-btn"
          aria-label="Duplicate layer"
          disabled={!selectedClip}
          onClick={() => {
            if (!selectedClip) return;
            api.edit({
              type: "duplicateClip",
              clipId: selectedClip.id,
              newClipId: crypto.randomUUID(),
            });
          }}
        >
          <Icon name="copy" size={14} />
        </button>

        <button
          type="button"
          className="layers-panel__icon-btn"
          aria-label="Delete layer"
          disabled={!selectedClip}
          onClick={() => {
            if (!selectedClip) return;
            api.edit({
              type: "deleteClip",
              clipId: selectedClip.id,
            });
            onSelect(null);
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </section>
  );
}
