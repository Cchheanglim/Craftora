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

export function layerName(clip: Clip, project: Project): string {
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
      {/* Header row */}
      <div className="layers-panel__header">
        <div className="layers-panel__header-left">
          <span className="layers-panel__title">Layers</span>
          <span className="layers-panel__count">{layers.length}</span>
        </div>
        <div className="layers-panel__header-actions">
          <button
            type="button"
            className="btn btn--icon"
            style={{ width: 26, height: 26 }}
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
            className="btn btn--icon"
            style={{ width: 26, height: 26 }}
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
            className="btn btn--icon"
            style={{ width: 26, height: 26 }}
            aria-label="Duplicate layer"
            disabled={!selectedClip}
            onClick={() => {
              if (!selectedClip) return;
              const newClipId = crypto.randomUUID();
              api.edit({ type: "duplicateClip", clipId: selectedClip.id, newClipId });
              onSelect(newClipId);
            }}
          >
            <Icon name="copy" size={14} />
          </button>
          <button
            type="button"
            className="btn btn--icon"
            style={{ width: 26, height: 26 }}
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
      </div>

      {/* Layers list */}
      <div className="layers-panel__list" ref={listRef}>
        {layers.length === 0 ? (
          <p className="layers-panel__empty">Add a picture, text or shape with the tools on the left.</p>
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

                {/* 40x26 Thumbnail */}
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

                {/* Small lock toggle button */}
                <button
                  type="button"
                  className={`layers-panel__lock-btn${track.locked ? " is-locked" : ""}`}
                  aria-label={track.locked ? "Unlock layer" : "Lock layer"}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    api.edit({
                      type: "updateTrack",
                      trackId: track.id,
                      patch: { locked: !track.locked },
                    });
                  }}
                >
                  <Icon name={track.locked ? "lock" : "unlock"} size={14} />
                </button>
              </div>
            );
          })
        )}

        {/* Background row (always last, not draggable, not selectable) */}
        <div className="layers-panel__row layers-panel__row--bg">
          <div className="layers-panel__eye-placeholder" aria-hidden="true" />
          <div
            className="layers-panel__thumb layers-panel__thumb-bg"
            style={{ backgroundColor: project.image?.background ?? "#000" }}
          />
          <span className="layers-panel__name layers-panel__name--bg">Background</span>
          <span className="layers-panel__lock-indicator" aria-label="Locked">
            <Icon name="lock" size={14} />
          </span>
        </div>

        {/* 2px drop indicator line */}
        {indicatorTop !== null && (
          <div className="layers-panel__drop-indicator" style={{ top: `${indicatorTop}px` }} />
        )}
      </div>
    </section>
  );
}
