import { Fragment, useEffect, useRef, useState } from "react";
import { BLEND_MODES, layersOf, type BlendMode, type Clip, type Project } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import { SHAPES, colourName, shapeLabel } from "../project/shapes";
import { Icon } from "./Icon";
import type { MenuItem } from "./MenuBar";
import { Select } from "./Select";
import "./LayersPanel.css";

const BLEND_OPTIONS = BLEND_MODES.flatMap((m) => (m === "sep" ? [] : [{ value: m[0], label: m[1] }]));

const PCT_FIELDS = [
  ["opacity", "Opacity", "layers-opacity"],
  ["fillOpacity", "Fill", "layers-fill"],
] as const;
type PctKey = (typeof PCT_FIELDS)[number][0];
const pct = (v?: number) => Math.round((v ?? 1) * 100);

/** A menu that just opened, moved up and left by as much as it would run out of the window (a ref callback). */
function keepInside(el: HTMLElement | null) {
  if (!el) return;
  // Measured where it opened (React may call this twice) and without its pop-in, which shrinks it for a moment (it
  // still plays after).
  el.style.translate = "";
  el.style.animation = "none";
  const r = el.getBoundingClientRect();
  el.style.animation = "";
  const dx = Math.max(8 - r.left, Math.min(0, window.innerWidth - 8 - r.right));
  const dy = Math.max(8 - r.top, Math.min(0, window.innerHeight - 8 - r.bottom));
  el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}

interface DragState {
  index: number;
  pointerId: number;
  startY: number;
  startScrollTop: number;
  currentY: number;
  isDragging: boolean;
  gap: number;
  rowBounds: { top: number; bottom: number }[];
}

interface DragInfo {
  index: number;
  deltaY: number;
  gap: number;
  indicatorTop: number;
}

interface ScrubState {
  key: PctKey;
  pointerId: number;
  startX: number;
  startVal: number;
  checkpointed: boolean;
}

export function layerName(clip: Clip, project: Project): string {
  if (clip.name) return clip.name;
  if (clip.mediaId) {
    const media = project.media.find((m) => m.id === clip.mediaId);
    return media?.name || "Image";
  }
  if (clip.shape) {
    // "Rectangle · red": a poster often has many of one shape.
    const colour = colourName(clip.color);
    return colour ? `${shapeLabel(clip.shape)} · ${colour}` : shapeLabel(clip.shape);
  }
  return clip.text?.split("\n")[0]?.trim() || "Text";
}

export function LayersPanel({
  project,
  api,
  selectedId,
  onSelect,
  maskEdit,
  onMaskEdit,
  maskView,
  onMaskView,
  menu,
}: {
  project: Project;
  api: ProjectApi;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  maskEdit?: string | null;
  onMaskEdit?: (id: string | null) => void;
  maskView?: string | null;
  onMaskView?: (id: string | null) => void;
  /** The picked layer's commands (App's Layer menu); shown under the panel's own items. */
  menu?: (MenuItem | "sep")[];
}) {
  const layers = layersOf(project);
  const selectedClip = selectedId ? project.clips.find((c) => c.id === selectedId) ?? null : null;
  const selectedTrack = selectedClip ? project.tracks.find((t) => t.id === selectedClip.trackId) ?? null : null;

  // Opacity / Fill typing, scrub and popover slider state
  const [typed, setTyped] = useState<Partial<Record<PctKey, string>>>({});
  const pctCancelledRef = useRef(false);
  const scrubRef = useRef<ScrubState | null>(null);
  const [openPct, setOpenPct] = useState<PctKey | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const pctBtnRefs = useRef<Partial<Record<PctKey, HTMLButtonElement | null>>>({});
  const sliderCheckpointedRef = useRef(false);

  useEffect(() => {
    setTyped({});
    setOpenPct(null);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedClip) setOpenPct(null);
  }, [selectedClip]);

  useEffect(() => {
    sliderCheckpointedRef.current = false;
    if (!openPct) return;
    popoverRef.current?.querySelector("input")?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popoverRef.current?.contains(target) && !pctBtnRefs.current[openPct]?.contains(target)) {
        setOpenPct(null);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpenPct(null);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLInputElement && e.target.type === "text")) {
        e.preventDefault();
        e.stopPropagation();
        setOpenPct(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openPct]);

  const setPct = (key: PctKey, rawPct: number, live = false) => {
    if (!selectedClip) return;
    const clamped = Math.min(100, Math.max(0, Math.round(rawPct)));
    const next = clamped === 100 ? undefined : clamped / 100;
    if ((selectedClip[key] ?? 1) === (next ?? 1)) return;
    const action = { type: "updateClip" as const, clipId: selectedClip.id, patch: { [key]: next } };
    if (live) api.editLive(action);
    else api.edit(action);
  };

  const applyPct = (key: PctKey) => {
    const raw = typed[key]?.replace(/%$/, "").trim();
    const value = Number(raw);
    setTyped({});
    if (pctCancelledRef.current) return void (pctCancelledRef.current = false);
    if (!raw || !Number.isFinite(value)) return;
    setPct(key, value);
  };

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const editingCancelledRef = useRef(false);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ clipId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const ctxLayer = ctxMenu ? layers.find((l) => l.clip.id === ctxMenu.clipId) ?? null : null;

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!ctxMenu) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    first?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu(null);
      }
    };
    const close = () => setCtxMenu(null);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [ctxMenu]);

  const startRename = (clip: Clip) => {
    editingCancelledRef.current = false;
    setEditingId(clip.id);
    setEditingName(clip.name ?? layerName(clip, project));
  };

  const toggleHidden = (trackId: string, hidden?: boolean) => {
    api.edit({
      type: "updateTrack",
      trackId,
      patch: { hidden: !hidden },
    });
  };

  const toggleLocked = (trackId: string, locked?: boolean) => {
    api.edit({
      type: "updateTrack",
      trackId,
      patch: { locked: !locked },
    });
  };

  const runMenuItem = (item: MenuItem) => {
    if (item.disabled) return;
    setCtxMenu(null);
    item.run();
  };

  const ctxItems: (MenuItem | "sep")[] = ctxLayer
    ? [
        { id: "rename", label: "Rename", run: () => startRename(ctxLayer.clip) },
        { id: "hide", label: ctxLayer.track.hidden ? "Show" : "Hide", run: () => toggleHidden(ctxLayer.track.id, ctxLayer.track.hidden) },
        { id: "lock", label: ctxLayer.track.locked ? "Unlock" : "Lock", run: () => toggleLocked(ctxLayer.track.id, ctxLayer.track.locked) },
        ...(menu && menu.length > 0 ? (["sep", ...menu] as const) : []),
      ]
    : [];

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
  const scrollRafRef = useRef<number | null>(null);
  const justDraggedRef = useRef(false);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);

  const stopAutoScroll = () => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  };

  useEffect(() => () => stopAutoScroll(), []);

  const updateDrag = (cur: DragState) => {
    const list = listRef.current;
    const listRect = list?.getBoundingClientRect();
    let scrolling = false;

    if (list && listRect && listRect.height > 0) {
      const topDist = cur.currentY - listRect.top;
      const bottomDist = listRect.bottom - cur.currentY;
      const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
      if (topDist < 24 && list.scrollTop > 0) {
        const speed = Math.max(2, Math.round(((24 - Math.max(0, topDist)) / 24) * 8));
        list.scrollTop = Math.max(0, list.scrollTop - speed);
        scrolling = list.scrollTop > 0;
      } else if (bottomDist < 24 && list.scrollTop < maxScroll) {
        const speed = Math.max(2, Math.round(((24 - Math.max(0, bottomDist)) / 24) * 8));
        list.scrollTop = Math.min(maxScroll, list.scrollTop + speed);
        scrolling = list.scrollTop < maxScroll;
      }
    }

    const scrollTop = list?.scrollTop ?? 0;
    const pointerY = cur.currentY - (listRect?.top ?? 0) + scrollTop;
    const bounds = cur.rowBounds;
    let gap = bounds.length;
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i];
      if (pointerY < (b.top + b.bottom) / 2) {
        gap = i;
        break;
      }
    }
    cur.gap = gap;

    const deltaY = cur.currentY - cur.startY + (scrollTop - cur.startScrollTop);
    const indicatorTop =
      bounds.length === 0
        ? 0
        : gap === 0
          ? bounds[0].top
          : bounds[Math.min(gap - 1, bounds.length - 1)].bottom - 1;

    setDragInfo({
      index: cur.index,
      deltaY,
      gap,
      indicatorTop,
    });

    if (scrolling) {
      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(() => {
          scrollRafRef.current = null;
          if (dragRef.current?.isDragging) updateDrag(dragRef.current);
        });
      }
    } else {
      stopAutoScroll();
    }
  };

  const cancelDrag = () => {
    stopAutoScroll();
    const cur = dragRef.current;
    if (!cur) return;
    try {
      rowRefs.current[cur.index]?.releasePointerCapture(cur.pointerId);
    } catch {}
    if (cur.isDragging) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 80);
    }
    dragRef.current = null;
    setDragInfo(null);
  };

  useEffect(() => {
    if (!dragInfo) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelDrag();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [dragInfo]);

  const handlePointerDown = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    const list = listRef.current;
    const listRect = list?.getBoundingClientRect();
    const startScrollTop = list?.scrollTop ?? 0;
    const rowBounds = layers.map((_, i) => {
      const r = rowRefs.current[i]?.getBoundingClientRect();
      if (!r || !listRect) return { top: 0, bottom: 0 };
      return {
        top: r.top - listRect.top + startScrollTop,
        bottom: r.bottom - listRect.top + startScrollTop,
      };
    });
    dragRef.current = {
      index,
      pointerId: e.pointerId,
      startY: e.clientY,
      startScrollTop,
      currentY: e.clientY,
      isDragging: false,
      gap: index,
      rowBounds,
    };
  };

  const handlePointerMove = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    const cur = dragRef.current;
    if (!cur || cur.index !== index) return;
    const deltaY = e.clientY - cur.startY;
    if (!cur.isDragging) {
      if (Math.abs(deltaY) < 3) return;
      cur.isDragging = true;
    }
    cur.currentY = e.clientY;
    updateDrag(cur);
  };

  const handlePointerUp = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    const cur = dragRef.current;
    if (!cur || cur.index !== index) return;
    stopAutoScroll();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const wasDragging = cur.isDragging;
    const gap = cur.gap;
    dragRef.current = null;
    setDragInfo(null);

    if (wasDragging) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 80);

      // A drop on its own spot (gap === index or gap === index + 1) changes nothing.
      if (gap !== index && gap !== index + 1) {
        const targetK = gap < index ? gap : gap - 1;
        if (layers[targetK]) {
          const to = project.tracks.findIndex((t) => t.id === layers[targetK].track.id);
          if (to !== -1) {
            api.edit({
              type: "moveTrack",
              trackId: layers[index].track.id,
              to,
            });
          }
        }
      }
    }
  };

  const handlePointerCancel = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.index === index) {
      stopAutoScroll();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      dragRef.current = null;
      setDragInfo(null);
    }
  };

  const indicatorTop = dragInfo ? dragInfo.indicatorTop : null;

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

      {/* Blend mode, Opacity and Fill row */}
      <div className="layers-panel__mix">
        <Select<BlendMode>
          value={selectedClip?.blend ?? "normal"}
          options={BLEND_OPTIONS}
          disabled={!selectedClip}
          className="layers-panel__blend"
          title="Blend mode"
          onChange={(blend) => {
            if (!selectedClip) return;
            api.edit({
              type: "updateClip",
              clipId: selectedClip.id,
              patch: { blend: blend === "normal" ? undefined : blend },
            });
          }}
        />
        {PCT_FIELDS.map(([key, label, id]) => {
          const endScrub = (e: React.PointerEvent<HTMLLabelElement>) => {
            if (scrubRef.current?.key === key) {
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {}
              scrubRef.current = null;
            }
          };
          return (
            <Fragment key={key}>
              <label
                className={`layers-panel__mix-label${!selectedClip ? " is-disabled" : ""}`}
                htmlFor={id}
                onPointerDown={(e) => {
                  if (!selectedClip || e.button !== 0) return;
                  e.preventDefault();
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {}
                  setTyped({});
                  setOpenPct(null);
                  scrubRef.current = {
                    key,
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startVal: pct(selectedClip[key]),
                    checkpointed: false,
                  };
                }}
                onPointerMove={(e) => {
                  const cur = scrubRef.current;
                  if (!cur || cur.key !== key) return;
                  const steps = Math.trunc((e.clientX - cur.startX) / 2);
                  const next = cur.startVal + steps * (e.shiftKey ? 10 : 1);
                  if (!cur.checkpointed) {
                    if (Math.min(100, Math.max(0, next)) === cur.startVal) return;
                    cur.checkpointed = true;
                    api.checkpoint();
                  }
                  setPct(key, next, true);
                }}
                onPointerUp={endScrub}
                onPointerCancel={endScrub}
              >
                {label}
              </label>
              <div className="layers-panel__pct-box">
                <input
                  id={id}
                  type="text"
                  className="field mono layers-panel__pct"
                  inputMode="numeric"
                  disabled={!selectedClip}
                  value={typed[key] ?? `${pct(selectedClip?.[key])}%`}
                  onChange={(e) => setTyped({ [key]: e.target.value })}
                  onBlur={() => applyPct(key)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      const raw = typed[key]?.replace(/%$/, "").trim();
                      const cur = raw && Number.isFinite(Number(raw)) ? Number(raw) : pct(selectedClip?.[key]);
                      const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
                      setTyped({});
                      setPct(key, cur + step);
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      applyPct(key);
                      setOpenPct(null);
                      pctCancelledRef.current = true;
                      e.currentTarget.blur();
                      pctCancelledRef.current = false;
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setTyped({});
                      setOpenPct(null);
                      pctCancelledRef.current = true;
                      e.currentTarget.blur();
                      pctCancelledRef.current = false;
                    }
                  }}
                />
                <button
                  ref={(el) => {
                    pctBtnRefs.current[key] = el;
                  }}
                  type="button"
                  className="layers-panel__pct-btn"
                  aria-label={`${label} slider`}
                  aria-expanded={openPct === key}
                  disabled={!selectedClip}
                  onClick={() => setOpenPct((cur) => (cur === key ? null : key))}
                >
                  <Icon name="chevronDown" size={10} />
                </button>
                {openPct === key && selectedClip && (
                  <div ref={popoverRef} className="insp__slider layers-panel__popover">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      aria-label={label}
                      value={pct(selectedClip[key])}
                      onPointerDown={() => {
                        if (!sliderCheckpointedRef.current) {
                          sliderCheckpointedRef.current = true;
                          api.checkpoint();
                        }
                      }}
                      onPointerUp={() => {
                        sliderCheckpointedRef.current = false;
                      }}
                      onPointerCancel={() => {
                        sliderCheckpointedRef.current = false;
                      }}
                      onBlur={() => {
                        sliderCheckpointedRef.current = false;
                      }}
                      onKeyDown={(e) => {
                        if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
                          if (!sliderCheckpointedRef.current) {
                            sliderCheckpointedRef.current = true;
                            api.checkpoint();
                          }
                        }
                      }}
                      onChange={(e) => {
                        if (!sliderCheckpointedRef.current) {
                          sliderCheckpointedRef.current = true;
                          api.checkpoint();
                        }
                        setTyped({});
                        setPct(key, Number(e.target.value), true);
                      }}
                    />
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* Layers list */}
      <div className={`layers-panel__list${dragInfo ? " is-dragging" : ""}`} ref={listRef}>
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(clip.id);
                  setCtxMenu({ clipId: clip.id, x: e.clientX, y: e.clientY });
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
                    toggleHidden(track.id, track.hidden);
                  }}
                >
                  <Icon name={track.hidden ? "eyeOff" : "eye"} size={14} />
                </button>

                {/* 40x26 Thumbnail (+ optional Layer mask thumbnail) */}
                <div className="layers-panel__thumbs">
                  <button
                    type="button"
                    className={`layers-panel__thumb${clip.mediaId ? " layers-panel__thumb--checker" : ""}${isSelected && clip.mask && maskEdit !== clip.id ? " is-editing" : ""}`}
                    aria-label="Layer thumbnail"
                    aria-pressed={isSelected && (!clip.mask || maskEdit !== clip.id)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(clip.id);
                      onMaskEdit?.(null);
                    }}
                  >
                    {clip.mediaId ? (
                      src ? (
                        <img src={src} alt="" className="layers-panel__thumb-img" draggable={false} />
                      ) : (
                        <Icon name="image" size={16} />
                      )
                    ) : clip.shape ? (
                      (() => {
                        const def = SHAPES.find((s) => s.id === clip.shape) ?? SHAPES[0];
                        const stroked = Boolean(clip.outline) || Boolean(def.line);
                        const colour = clip.color ?? "#ffffff";
                        return (
                          <svg className="layers-panel__thumb-shape" viewBox="-6 -6 112 112" aria-hidden="true">
                            <path d={def.path} fill={stroked ? "none" : colour} stroke={stroked ? colour : "none"} strokeWidth={stroked ? 10 : 0} />
                          </svg>
                        );
                      })()
                    ) : (
                      <span className="layers-panel__thumb-text">T</span>
                    )}
                  </button>
                  {clip.mask && (
                    <button
                      type="button"
                      className={`layers-panel__thumb layers-panel__thumb--mask${isSelected && maskEdit === clip.id ? " is-editing" : ""}`}
                      aria-label="Layer mask"
                      aria-pressed={isSelected && maskEdit === clip.id}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey) {
                          api.edit({ type: "maskOff", clipId: clip.id, off: !clip.maskOff });
                          return;
                        }
                        if (e.altKey) {
                          onMaskView?.(maskView === clip.id ? null : clip.id);
                          return;
                        }
                        onSelect(clip.id);
                        onMaskEdit?.(clip.id);
                      }}
                    >
                      <img src={clip.mask} alt="" className="layers-panel__thumb-img" draggable={false} />
                      {clip.maskOff && (
                        <svg className="layers-panel__mask-x" viewBox="0 0 40 26" aria-hidden="true">
                          <line x1="2" y1="2" x2="38" y2="24" />
                          <line x1="38" y1="2" x2="2" y2="24" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>

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
                      startRename(clip);
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
                    toggleLocked(track.id, track.locked);
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
            className={project.image?.background === "" ? "layers-panel__thumb layers-panel__thumb-bg layers-panel__thumb--checker" : "layers-panel__thumb layers-panel__thumb-bg"}
            style={{ backgroundColor: project.image?.background || undefined }}
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

      {ctxMenu && ctxLayer && (
        <div
          ref={(el) => {
            menuRef.current = el;
            keepInside(el);
          }}
          className="layers-panel__menu"
          role="menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();
              const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
              if (items.length === 0) return;
              const at = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = e.key === "ArrowDown" ? (at === -1 ? 0 : (at + 1) % items.length) : at <= 0 ? items.length - 1 : at - 1;
              items[next]?.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu(null);
            }
          }}
        >
          {ctxItems.map((item, i) =>
            item === "sep" ? (
              <div key={`sep-${i}`} className="layers-panel__menu-sep" role="separator" />
            ) : (
              <button
                key={`${item.id}-${i}`}
                type="button"
                className="layers-panel__menu-item"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                onClick={() => runMenuItem(item)}
                onPointerEnter={(e) => {
                  if (!item.disabled) e.currentTarget.focus();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    runMenuItem(item);
                  }
                }}
              >
                <span>{item.label}</span>
                {item.keys && <span className="layers-panel__menu-keys">{item.keys}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </section>
  );
}
