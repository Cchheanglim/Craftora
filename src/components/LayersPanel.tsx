import { useRef, useState } from "react";
import type { Project } from "../project/model";
import { layersOf } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import { shapeLabel } from "../project/shapes";
import { Icon } from "./Icon";
import "./LayersPanel.css";

interface LayersPanelProps {
  project: Project;
  api: ProjectApi;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface DragState {
  index: number;
  pointerId: number;
  startX: number;
  currentX: number;
  isDragging: boolean;
  dropIndex: number;
}

interface DragInfo {
  index: number;
  deltaX: number;
  dropIndex: number;
}

export function LayersPanel({ project, api, selectedId, onSelect }: LayersPanelProps) {
  const layers = layersOf(project);
  const stripRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const justDraggedRef = useRef(false);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);

  const handlePointerDown = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    dragRef.current = {
      index,
      pointerId: e.pointerId,
      startX: e.clientX,
      currentX: e.clientX,
      isDragging: false,
      dropIndex: index,
    };
  };

  const handlePointerMove = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    const cur = dragRef.current;
    if (!cur || cur.index !== index) return;
    const deltaX = e.clientX - cur.startX;
    if (!cur.isDragging) {
      if (Math.abs(deltaX) < 4) return;
      cur.isDragging = true;
    }
    cur.currentX = e.clientX;

    // Slot k (0 = leftmost) based on the closest card center to the pointer
    let closest = index;
    let minDistance = Infinity;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const center = (r.left + r.right) / 2;
      const dist = Math.abs(e.clientX - center);
      if (dist < minDistance) {
        minDistance = dist;
        closest = i;
      }
    });
    cur.dropIndex = closest;

    setDragInfo({
      index: cur.index,
      deltaX: cur.currentX - cur.startX,
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

  // Compute 2px drop indicator line position in var(--text)
  let indicatorLeft: number | null = null;
  if (dragInfo && stripRef.current) {
    const strip = stripRef.current;
    const stripRect = strip.getBoundingClientRect();
    const k = dragInfo.dropIndex;
    const dragIdx = dragInfo.index;
    const targetEl = cardRefs.current[k];
    if (targetEl) {
      const r = targetEl.getBoundingClientRect();
      const GAP = 8;
      if (k < dragIdx) {
        const leftEdge = r.left - stripRect.left + strip.scrollLeft;
        indicatorLeft = k === 0 ? leftEdge - 1 : leftEdge - GAP / 2 - 1;
      } else if (k > dragIdx) {
        const rightEdge = r.right - stripRect.left + strip.scrollLeft;
        indicatorLeft = k === layers.length - 1 ? rightEdge - 1 : rightEdge + GAP / 2 - 1;
      } else {
        const leftEdge = r.left - dragInfo.deltaX - stripRect.left + strip.scrollLeft;
        indicatorLeft = leftEdge - 1;
      }
    }
  }

  return (
    <section className="layers-panel" aria-label="Layers">
      <div className="layers-panel__header">
        <div className="layers-panel__title-row">
          <span className="layers-panel__title">Layers</span>
          <span className="layers-panel__count">{layers.length}</span>
        </div>
        {/* The timeline's Undo and Redo, which this strip replaces. */}
        <div className="layers-panel__history">
          <button type="button" className="btn btn--icon" aria-label="Undo" disabled={!api.canUndo} onClick={api.undo}>
            <Icon name="undo" size={14} />
          </button>
          <button type="button" className="btn btn--icon" aria-label="Redo" disabled={!api.canRedo} onClick={api.redo}>
            <Icon name="redo" size={14} />
          </button>
        </div>
      </div>

      <div className="layers-panel__strip" ref={stripRef}>
        {layers.length === 0 ? (
          <p className="layers-panel__empty">Add a picture, text or shape from the left.</p>
        ) : (
          layers.map(({ track, clip }, index) => {
            const isSelected = clip.id === selectedId;
            const isDragging = dragInfo?.index === index;
            const cardStyle: React.CSSProperties = isDragging
              ? { transform: `translateX(${dragInfo.deltaX}px)`, zIndex: 10 }
              : {};

            let preview: React.ReactNode;
            let name = "Layer";

            if (clip.mediaId) {
              const media = project.media.find((m) => m.id === clip.mediaId);
              name = media?.name || "Image";
              const src = media?.source?.thumbnail || media?.source?.previewUrl;
              preview = src ? (
                <img src={src} alt="" className="layers-panel__thumb-img" draggable={false} />
              ) : (
                <Icon name="image" size={14} />
              );
            } else if (clip.shape) {
              name = shapeLabel(clip.shape);
              preview = <Icon name="star" size={14} />;
            } else {
              name = clip.text ? clip.text.split("\n")[0] || "Text" : "Text";
              preview = <Icon name="text" size={14} />;
            }

            return (
              <div
                key={clip.id}
                ref={(el) => {
                  cardRefs.current[index] = el;
                }}
                className={`layers-panel__card${isSelected ? " is-selected" : ""}${
                  track.hidden ? " is-hidden" : ""
                }${track.locked ? " is-locked" : ""}${isDragging ? " is-dragging" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                style={cardStyle}
                onPointerDown={(e) => handlePointerDown(index, e)}
                onPointerMove={(e) => handlePointerMove(index, e)}
                onPointerUp={(e) => handlePointerUp(index, e)}
                onPointerCancel={(e) => handlePointerCancel(index, e)}
                onClick={() => {
                  if (justDraggedRef.current) return;
                  if (!track.locked) {
                    onSelect(clip.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!track.locked) {
                      onSelect(clip.id);
                    }
                  }
                }}
              >
                <div className="layers-panel__card-head">
                  <div className="layers-panel__thumb">{preview}</div>
                  <span className="layers-panel__name">{name}</span>
                </div>

                <div className="layers-panel__card-actions">
                  <button
                    type="button"
                    className="btn btn--icon layers-panel__btn"
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
                    <Icon name={track.hidden ? "eyeOff" : "eye"} size={13} />
                  </button>

                  <button
                    type="button"
                    className="btn btn--icon layers-panel__btn"
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
                    <Icon name={track.locked ? "lock" : "unlock"} size={13} />
                  </button>

                  <button
                    type="button"
                    className="btn btn--icon layers-panel__btn"
                    aria-label="Delete layer"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      api.edit({ type: "deleteClip", clipId: clip.id });
                      if (clip.id === selectedId) {
                        onSelect(null);
                      }
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}

        {indicatorLeft !== null && (
          <div className="layers-panel__drop-indicator" style={{ left: `${indicatorLeft}px` }} />
        )}
      </div>
    </section>
  );
}
