import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icon";
import "./ImageWorkspace.css";

export interface ImageTool {
  id: string;
  label: string;
  icon: IconName;
  /** Tools are drawn in groups with a thin line between groups. */
  group: "select" | "content" | "edit";
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

  const availW = Math.max(0, areaW - 64);
  const availH = Math.max(0, areaH - 64);

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

export function ImageWorkspace(props: {
  tools: ImageTool[];
  activeTool: string;
  onTool: (id: string) => void;
  /** The open tool's panel (photos, text, shapes…), shown in a 280px column next to the tool strip; null = none. */
  flyout: ReactNode | null;
  /** The selected layer's quick actions, one line across the top. */
  options: ReactNode;
  /** The picture (it fits its box by itself). */
  canvas: ReactNode;
  /** The image's size in pixels, for the zoom percentage. */
  imageSize: { width: number; height: number };
  properties: ReactNode;
  layers: ReactNode;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const {
    tools,
    activeTool,
    onTool,
    flyout,
    options,
    canvas,
    imageSize,
    properties,
    layers,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
  } = props;

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [propsOpen, setPropsOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(true);
  const [spaceDown, setSpaceDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });

  const workAreaRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const areaSizeRef = useRef(areaSize);
  areaSizeRef.current = areaSize;
  const imageSizeRef = useRef(imageSize);
  imageSizeRef.current = imageSize;

  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // ResizeObserver for measuring work area and computing pixel zoom %
  useEffect(() => {
    const el = workAreaRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setAreaSize({ width: cr.width, height: cr.height });
      }
    });

    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const handleZoomIn = () => {
    setZoom((prevZoom) => {
      const nextZoom = Math.min(8, prevZoom * 1.25);
      setPan((prevPan) => {
        const ratio = nextZoom / prevZoom;
        return clampPan(
          prevPan.x * ratio,
          prevPan.y * ratio,
          nextZoom,
          areaSizeRef.current.width,
          areaSizeRef.current.height,
          imageSizeRef.current.width,
          imageSizeRef.current.height
        );
      });
      return nextZoom;
    });
  };

  const handleZoomOut = () => {
    setZoom((prevZoom) => {
      const nextZoom = Math.max(0.1, prevZoom / 1.25);
      setPan((prevPan) => {
        const ratio = nextZoom / prevZoom;
        return clampPan(
          prevPan.x * ratio,
          prevPan.y * ratio,
          nextZoom,
          areaSizeRef.current.width,
          areaSizeRef.current.height,
          imageSizeRef.current.width,
          imageSizeRef.current.height
        );
      });
      return nextZoom;
    });
  };

  const handleFit = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Keyboard shortcuts (Fit, Zoom +/-, Tab panel toggle, Space pan)
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
          handleFit();
        } else if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          handleZoomIn();
        } else if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          handleZoomOut();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceDown(false);
      }
    };

    const onBlur = () => {
      setSpaceDown(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Wheel listener: non-passive for preventDefault
  useEffect(() => {
    const el = workAreaRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const areaW = rect.width;
      const areaH = rect.height;
      const imgW = imageSizeRef.current.width;
      const imgH = imageSizeRef.current.height;

      if (e.ctrlKey || e.metaKey) {
        // Zoom around pointer
        const pointerX = e.clientX - rect.left;
        const pointerY = e.clientY - rect.top;
        const cx = areaW / 2;
        const cy = areaH / 2;

        const currentZoom = zoomRef.current;
        const currentPan = panRef.current;

        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const nextZoom = Math.min(8, Math.max(0.1, currentZoom * factor));

        const nextX =
          pointerX - cx - ((pointerX - cx - currentPan.x) * nextZoom) / currentZoom;
        const nextY =
          pointerY - cy - ((pointerY - cy - currentPan.y) * nextZoom) / currentZoom;

        const clamped = clampPan(nextX, nextY, nextZoom, areaW, areaH, imgW, imgH);
        setZoom(nextZoom);
        setPan(clamped);
      } else {
        // Mouse wheel scroll pan
        const dx = e.shiftKey ? (e.deltaX !== 0 ? e.deltaX : e.deltaY) : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;

        const nextX = panRef.current.x - dx;
        const nextY = panRef.current.y - dy;

        const clamped = clampPan(nextX, nextY, zoomRef.current, areaW, areaH, imgW, imgH);
        setPan(clamped);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  const isPanTool = activeTool === "hand" || spaceDown;

  const areaW = areaSize.width || (workAreaRef.current ? workAreaRef.current.clientWidth : 0);
  const areaH = areaSize.height || (workAreaRef.current ? workAreaRef.current.clientHeight : 0);
  const fittedWidth =
    imageSize.width > 0 && imageSize.height > 0 && areaW > 64 && areaH > 64
      ? Math.min(areaW - 64, ((areaH - 64) * imageSize.width) / imageSize.height)
      : Math.max(0, areaW - 64);
  const shownPct =
    imageSize.width > 0
      ? Math.round(((zoom * fittedWidth) / imageSize.width) * 100)
      : Math.round(zoom * 100);

  const workAreaClassName = `image-ws__work-area${
    isDragging ? " is-grabbing" : isPanTool ? " is-grab" : ""
  }`;

  return (
    <div className={`image-ws${panelsVisible ? "" : " image-ws--immersive"}`}>
      {/* 1. Options bar */}
      <header className="image-ws__options-bar">
        <div className="image-ws__options-content">{options}</div>
        <div className="image-ws__history">
          <button
            type="button"
            className="image-ws__opt-btn"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Icon name="undo" size={16} />
          </button>
          <button
            type="button"
            className="image-ws__opt-btn"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Icon name="redo" size={16} />
          </button>
        </div>
      </header>

      {/* 2. Tool strip */}
      <nav className="image-ws__tool-strip">
        {tools.map((tool, idx) => {
          const prevTool = tools[idx - 1];
          const isNewGroup = prevTool && prevTool.group !== tool.group;
          return (
            <Fragment key={tool.id}>
              {isNewGroup && <div className="image-ws__tool-sep" role="separator" />}
              <button
                type="button"
                className={`image-ws__tool-btn${tool.id === activeTool ? " is-active" : ""}`}
                aria-label={tool.label}
                aria-pressed={tool.id === activeTool}
                onClick={() => onTool(tool.id)}
              >
                <Icon name={tool.icon} size={16} />
              </button>
            </Fragment>
          );
        })}
      </nav>

      {/* 3. Flyout */}
      {flyout !== null && <aside className="image-ws__flyout">{flyout}</aside>}

      {/* 4. Work area */}
      <main
        ref={workAreaRef}
        className={workAreaClassName}
        onPointerDownCapture={(e) => {
          if (isPanTool && e.button === 0) {
            e.stopPropagation();
            e.preventDefault();
            dragRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              origX: pan.x,
              origY: pan.y,
            };
            setIsDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const dx = e.clientX - dragRef.current.startX;
          const dy = e.clientY - dragRef.current.startY;
          const nextX = dragRef.current.origX + dx;
          const nextY = dragRef.current.origY + dy;
          const clamped = clampPan(
            nextX,
            nextY,
            zoomRef.current,
            areaSizeRef.current.width,
            areaSizeRef.current.height,
            imageSizeRef.current.width,
            imageSizeRef.current.height
          );
          setPan(clamped);
        }}
        onPointerUp={(e) => {
          if (dragRef.current) {
            dragRef.current = null;
            setIsDragging(false);
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              // ignore
            }
          }
        }}
        onPointerCancel={(e) => {
          if (dragRef.current) {
            dragRef.current = null;
            setIsDragging(false);
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              // ignore
            }
          }
        }}
      >
        <div
          className="image-ws__camera"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center",
          }}
        >
          {canvas}
        </div>

        <div className="image-ws__zoom-box">
          <button
            type="button"
            className="image-ws__zoom-btn"
            aria-label="Zoom out"
            onClick={handleZoomOut}
          >
            −
          </button>
          <span className="image-ws__zoom-pct">{shownPct}%</span>
          <button
            type="button"
            className="image-ws__zoom-btn"
            aria-label="Zoom in"
            onClick={handleZoomIn}
          >
            +
          </button>
          <button
            type="button"
            className="image-ws__zoom-fit"
            onClick={handleFit}
          >
            Fit
          </button>
        </div>
      </main>

      {/* 5. Right sidebar */}
      <aside className="image-ws__sidebar">
        <div
          className={`image-ws__section image-ws__section--props${
            !layersOpen ? " is-expanded" : ""
          }`}
        >
          <button
            type="button"
            className="image-ws__sidebar-hdr"
            aria-expanded={propsOpen}
            onClick={() => setPropsOpen((prev) => !prev)}
          >
            <span className="image-ws__sidebar-title">Properties</span>
            <span
              className={`image-ws__chevron${propsOpen ? "" : " is-collapsed"}`}
            >
              <Icon name="chevronDown" size={14} />
            </span>
          </button>
          {propsOpen && <div className="image-ws__prop-body">{properties}</div>}
        </div>

        <div
          className={`image-ws__section image-ws__section--layers${
            !layersOpen ? " is-collapsed" : ""
          }`}
        >
          <button
            type="button"
            className="image-ws__sidebar-hdr"
            aria-expanded={layersOpen}
            onClick={() => setLayersOpen((prev) => !prev)}
          >
            <span className="image-ws__sidebar-title">Layers</span>
            <span
              className={`image-ws__chevron${layersOpen ? "" : " is-collapsed"}`}
            >
              <Icon name="chevronDown" size={14} />
            </span>
          </button>
          {layersOpen && <div className="image-ws__layers-body">{layers}</div>}
        </div>
      </aside>
    </div>
  );
}
