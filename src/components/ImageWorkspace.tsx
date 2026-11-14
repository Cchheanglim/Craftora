import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Select } from "./Select";
import "./ImageWorkspace.css";

export interface ImageTool {
  id: string;
  label: string;
  icon: IconName;
  /** Tools are drawn in groups with a thin line between groups. */
  group: "select" | "content" | "edit";
  /** Its key (read out with its name). */
  key?: string;
  disabled?: boolean;
}

function isInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.getAttribute("role") === "textbox" ||
    target.getAttribute("role") === "combobox"
  );
}

/** The picture's room around it in the work area (px each side). */
const MARGIN = 32;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

function clampPan(
  x: number,
  y: number,
  zoom: number,
  areaW: number,
  areaH: number,
  imageW: number,
  imageH: number
): { x: number; y: number } {
  if (areaW <= 0 || areaH <= 0) return { x, y };

  const cx = areaW / 2;
  const cy = areaH / 2;

  const availW = Math.max(0, areaW - 2 * MARGIN);
  const availH = Math.max(0, areaH - 2 * MARGIN);

  let picW = availW;
  let picH = availH;
  if (imageW > 0 && imageH > 0) {
    const aspect = imageW / imageH;
    picW = Math.min(availW, availH * aspect);
    picH = Math.min(availH, availW / aspect);
  }

  const scaledW = picW * zoom;
  const scaledH = picH * zoom;

  // Clamp x/y so at least 80px of the picture stays visible
  const minVisible = 80;
  const marginX = Math.min(minVisible, scaledW);
  const marginY = Math.min(minVisible, scaledH);

  const minX = marginX - cx - scaledW / 2;
  const maxX = areaW - marginX - cx + scaledW / 2;

  const minY = marginY - cy - scaledH / 2;
  const maxY = areaH - marginY - cy + scaledH / 2;

  const clampedX = minX <= maxX ? Math.min(maxX, Math.max(minX, x)) : 0;
  const clampedY = minY <= maxY ? Math.min(maxY, Math.max(minY, y)) : 0;

  return { x: clampedX, y: clampedY };
}

/** The picture's zoom and pan in the work area, kept in App so the top bar's zoom box can show and change them. */
export interface ImageView {
  zoom: number;
  pan: { x: number; y: number };
  /** Zoom as a percentage of the picture's real pixels. */
  pct: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  /** Zoom so the picture shows at `pct` % of its real pixels. */
  zoomTo: (pct: number) => void;
  /** Zoom by `factor` around a point of the work area (px from its top left). */
  zoomAround: (factor: number, x: number, y: number) => void;
  /** Moves the picture to `x`, `y` (kept partly on screen). */
  panTo: (x: number, y: number) => void;
  /** The work area's element, which the view measures. */
  areaRef: (el: HTMLElement | null) => void;
}

export function useImageView(imageSize: { width: number; height: number }): ImageView {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [area, setArea] = useState<HTMLElement | null>(null);
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
  // Read by the handlers, which stay the same functions from render to render.
  const now = useRef({ zoom, pan, areaSize, imageSize });
  now.current = { zoom, pan, areaSize, imageSize };

  useEffect(() => {
    if (!area) return;
    const ro = new ResizeObserver(([entry]) => setAreaSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(area);
    return () => ro.disconnect();
  }, [area]);

  // The fitted picture's width (zoom 1), for the percentage.
  const fittedWidth = (a = areaSize, img = imageSize) =>
    img.width > 0 && img.height > 0 && a.width > 2 * MARGIN && a.height > 2 * MARGIN
      ? Math.min(a.width - 2 * MARGIN, ((a.height - 2 * MARGIN) * img.width) / img.height)
      : Math.max(0, a.width - 2 * MARGIN);

  const handlers = useMemo(() => {
    const clamp = (x: number, y: number, z: number) => {
      const { areaSize: a, imageSize: img } = now.current;
      return clampPan(x, y, z, a.width, a.height, img.width, img.height);
    };
    // Zoom keeping the work area's point (px from its centre) still.
    const zoomBy = (next: number, px = 0, py = 0) => {
      const { zoom: z, pan: p } = now.current;
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      setZoom(nz);
      setPan(clamp(px - ((px - p.x) * nz) / z, py - ((py - p.y) * nz) / z, nz));
    };
    return {
      zoomIn: () => zoomBy(now.current.zoom * 1.25),
      zoomOut: () => zoomBy(now.current.zoom / 1.25),
      fit: () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      },
      zoomTo: (pct: number) => {
        const { areaSize: a, imageSize: img } = now.current;
        const w = fittedWidth(a, img);
        if (w > 0 && img.width > 0) zoomBy(((pct / 100) * img.width) / w);
      },
      zoomAround: (factor: number, x: number, y: number) => {
        const { areaSize: a } = now.current;
        zoomBy(now.current.zoom * factor, x - a.width / 2, y - a.height / 2);
      },
      panTo: (x: number, y: number) => setPan(clamp(x, y, now.current.zoom)),
    };
    // fittedWidth only reads its arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const w = fittedWidth();
  const pct = imageSize.width > 0 ? Math.round(((zoom * w) / imageSize.width) * 100) : Math.round(zoom * 100);
  return { zoom, pan, pct, ...handlers, areaRef: setArea };
}

/** The top bar's zoom box: the zoom now, and Fit or a set size. */
export function ZoomSelect({ view }: { view: ImageView }) {
  return (
    <Select
      className="mono image-ws__zoom"
      value="now"
      options={[
        { value: "now", label: `${view.pct}%`, disabled: true },
        { value: "fit", label: "Fit" },
        { value: "50", label: "50%" },
        { value: "100", label: "100%" },
        { value: "200", label: "200%" },
      ]}
      onChange={(v) => (v === "fit" ? view.fit() : v !== "now" && view.zoomTo(Number(v)))}
    />
  );
}

/** How tall the Layers list starts, and the Properties' least room over it. */
const LAYERS_H = 232;
const PROPS_MIN = 200;
const LAYERS_KEY = "craftora.imageLayersHeight";

function savedLayersHeight(): number {
  try {
    const n = Number(localStorage.getItem(LAYERS_KEY));
    return n >= 96 ? n : LAYERS_H;
  } catch {
    return LAYERS_H;
  }
}

/**
 * The Image editor, laid out like a photo editor: an options bar across the top, a thin tool column at the left (with a
 * tool's panel beside it), the picture in a grey work area under its name tab and over a status line, and a dock at the
 * right with the picked layer's settings over the layers (a line between them drags).
 */
export function ImageWorkspace(props: {
  tools: ImageTool[];
  activeTool: string;
  onTool: (id: string) => void;
  /** The options bar's contents: what the picked tool and layer can do. */
  options: ReactNode;
  /** The picture's name and size, for its tab and the status line. */
  doc: { name: string; width: number; height: number };
  /** The open tool's panel (photos, shapes, canvas size…), in a 300px column next to the tool strip; null = none. */
  flyout: ReactNode | null;
  /** The picture (it fits its box by itself). */
  canvas: ReactNode;
  view: ImageView;
  properties: ReactNode;
  layers: ReactNode;
}) {
  const { tools, activeTool, onTool, options, doc, flyout, canvas, view, properties, layers } = props;

  const [panelsVisible, setPanelsVisible] = useState(true);
  const [spaceDown, setSpaceDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [layersH, setLayersH] = useState(savedLayersHeight);

  const workAreaRef = useRef<HTMLElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Keyboard: Tab hides the panels, Space pans, Ctrl+0 fits, Ctrl+= / Ctrl+- zoom.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isInputTarget(e.target)) return;

      if (e.key === "Tab") {
        e.preventDefault();
        setPanelsVisible((v) => !v);
        return;
      }

      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "0") {
          e.preventDefault();
          viewRef.current.fit();
        } else if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          viewRef.current.zoomIn();
        } else if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          viewRef.current.zoomOut();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };

    const onBlur = () => setSpaceDown(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Wheel: Ctrl zooms around the pointer, otherwise it pans (non-passive, to stop the page scrolling).
  useEffect(() => {
    const el = workAreaRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        v.zoomAround(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        const dx = e.shiftKey ? (e.deltaX !== 0 ? e.deltaX : e.deltaY) : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        v.panTo(v.pan.x - dx, v.pan.y - dy);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** The line between Layers and Properties: dragged or moved with the arrow keys, remembered for next time. */
  const setLayersHeight = (h: number) => {
    const room = (dockRef.current?.clientHeight ?? 800) - PROPS_MIN;
    const next = Math.round(Math.max(96, Math.min(room, h)));
    setLayersH(next);
    try {
      localStorage.setItem(LAYERS_KEY, String(next));
    } catch {
      // Not remembered this time.
    }
  };

  const isPanTool = activeTool === "hand" || spaceDown;
  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div className={`image-ws${panelsVisible ? "" : " image-ws--immersive"}${flyout !== null ? " has-flyout" : ""}`}>
      <div className="image-ws__options">{options}</div>

      <nav className="image-ws__tools" aria-label="Tools">
        {tools.map((tool, idx) => {
          const prevTool = tools[idx - 1];
          const isNewGroup = prevTool && prevTool.group !== tool.group;
          return (
            <Fragment key={tool.id}>
              {isNewGroup && <div className="image-ws__tool-sep" role="separator" />}
              <button
                type="button"
                className={`image-ws__tool${tool.id === activeTool ? " is-active" : ""}`}
                aria-label={tool.key ? `${tool.label} (${tool.key})` : tool.label}
                aria-pressed={tool.id === activeTool}
                disabled={tool.disabled}
                onClick={() => onTool(tool.id)}
              >
                <Icon name={tool.icon} size={16} />
              </button>
            </Fragment>
          );
        })}
      </nav>

      {flyout !== null && <aside className="image-ws__flyout">{flyout}</aside>}

      <div className="image-ws__stage">
      <div className="image-ws__doctabs">
        <span className="image-ws__doctab">
          {doc.name} @ {view.pct}%
        </span>
      </div>
      <main
        ref={(el) => {
          workAreaRef.current = el;
          view.areaRef(el);
        }}
        className={`image-ws__work${isDragging ? " is-grabbing" : isPanTool ? " is-grab" : ""}`}
        onPointerDownCapture={(e) => {
          if (isPanTool && e.button === 0) {
            e.stopPropagation();
            e.preventDefault();
            dragRef.current = { startX: e.clientX, startY: e.clientY, origX: view.pan.x, origY: view.pan.y };
            setIsDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (d) view.panTo(d.origX + e.clientX - d.startX, d.origY + e.clientY - d.startY);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="image-ws__camera"
          style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`, transformOrigin: "center" }}
        >
          {canvas}
        </div>
      </main>
      <footer className="image-ws__status mono">
        <span>{view.pct}%</span>
        <span>
          {doc.width} px × {doc.height} px
        </span>
      </footer>
      </div>

      <aside ref={dockRef} className="image-ws__dock" style={{ "--layers-h": `${layersH}px` } as CSSProperties}>
        <section className="image-ws__props" aria-label="Properties">
          {properties}
        </section>
        <div
          className="image-ws__grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Layers height"
          aria-valuenow={layersH}
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const start = { y: e.clientY, h: layersH };
            const move = (ev: PointerEvent) => setLayersHeight(start.h - (ev.clientY - start.y));
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              setLayersHeight(layersH + (e.key === "ArrowUp" ? 16 : -16));
            }
          }}
        >
          <span />
        </div>
        <section className="image-ws__layers" aria-label="Layers">
          {layers}
        </section>
      </aside>
    </div>
  );
}
