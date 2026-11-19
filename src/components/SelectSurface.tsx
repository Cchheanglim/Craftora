import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { combine, ellipsePoints, featherSelection, moveSelection, outlinePath, polygonSelection, rectPoints, type Selection, type SelectMode, type SelectSettings, type SelectTool } from "../lib/selection";
import "./SelectSurface.css";

/** What the selection tools do (Preview's `selecting`); App keeps the selection. */
export interface Selecting {
  tool: SelectTool;
  settings: SelectSettings;
  selection: Selection | null;
  /** The new selection (null = nothing selected). */
  onChange: (selection: Selection | null) => void;
  /** Magic wand clicked at picture point `p`: App reads the picture's pixels and calls onChange itself. */
  onWand: (p: [number, number], mode: SelectMode) => void;
}

type Pt = [number, number];

/** One marquee, ellipse, lasso or move drag. */
interface Drag {
  kind: "marquee" | "ellipse" | "lasso" | "move";
  mode: SelectMode;
  /** Shift / Alt held at the press chose the mode, so they don't also square or centre the shape. */
  shift: boolean;
  alt: boolean;
  start: Pt;
  end: Pt;
  points: Pt[];
  /** Where it was pressed (screen px); `moved` once the pointer is 3 px away. */
  client: Pt;
  moved: boolean;
}

type Live =
  | { kind: "marquee" | "ellipse"; corners: [Pt, Pt] }
  | { kind: "lasso"; points: Pt[] }
  | { kind: "polygon"; points: Pt[]; rubber: Pt }
  | { kind: "move"; offset: Pt };

const modeOf = (e: { shiftKey: boolean; altKey: boolean }, fallback: SelectMode): SelectMode =>
  e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : fallback;

/** The shape's corners from `start` to `end`: `square` = equal sides (Shift), `centre` = drawn out from `start` (Alt). */
function corners(start: Pt, end: Pt, square: boolean, centre: boolean): [Pt, Pt] {
  let [dx, dy] = [end[0] - start[0], end[1] - start[1]];
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    [dx, dy] = [Math.sign(dx || 1) * side, Math.sign(dy || 1) * side];
  }
  const far: Pt = [start[0] + dx, start[1] + dy];
  return centre ? [[start[0] - dx, start[1] - dy], far] : [start, far];
}

const selectedAt = (sel: Selection, [x, y]: Pt, W: number, H: number) => {
  const [gx, gy] = [Math.floor(x * (sel.width / W)), Math.floor(y * (sel.height / H))];
  return gx >= 0 && gy >= 0 && gx < sel.width && gy < sel.height && sel.data[gy * sel.width + gx] >= 128;
};

const pointsOf = (pts: Pt[]) => pts.map((p) => p.join(",")).join(" ");

/** The marching-ants outline of `selection` over a W × H picture; `offset` (picture px) while it is being dragged. */
export function SelectionOutline({ selection, width, height, offset }: { selection: Selection; width: number; height: number; offset?: [number, number] }) {
  const path = useMemo(() => outlinePath(selection), [selection]);
  return (
    <svg
      className="select-surface__outline"
      viewBox={`0 0 ${path.width} ${path.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={offset && { translate: `${(offset[0] / width) * 100}% ${(offset[1] / height) * 100}%` }}
    >
      <path className="select-surface__line" d={path.d} vectorEffect="non-scaling-stroke" />
      <path className="select-surface__ants" d={path.d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The shape being drawn, in picture px, with the outline's ants look. */
function LiveShape({ live, width: W, height: H }: { live: Exclude<Live, { kind: "move" }>; width: number; height: number }) {
  const draw = (className: string) => {
    if (live.kind === "lasso" || live.kind === "polygon") {
      const pts = live.kind === "polygon" ? [...live.points, live.rubber] : live.points;
      return <polyline className={className} points={pointsOf(pts)} vectorEffect="non-scaling-stroke" />;
    }
    const [[x0, y0], [x1, y1]] = live.corners;
    if (live.kind === "ellipse") return <ellipse className={className} cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={Math.abs(x1 - x0) / 2} ry={Math.abs(y1 - y0) / 2} vectorEffect="non-scaling-stroke" />;
    return <rect className={className} x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} vectorEffect="non-scaling-stroke" />;
  };
  return (
    <svg className="select-surface__live" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {draw("select-surface__line")}
      {draw("select-surface__ants")}
    </svg>
  );
}

/** The selection tools over the stage (Preview renders it in place of PaintSurface while a selection tool is picked). */
export function SelectSurface({ selecting, width: W, height: H }: { selecting: Selecting; width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // The polygonal lasso's corners so far (picture px) and its mode, read at the first click.
  const poly = useRef<{ mode: SelectMode; points: Pt[] } | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  // Read by the handlers between renders.
  const now = useRef({ selecting, W, H });
  now.current = { selecting, W, H };

  useEffect(() => {
    drag.current = null;
    poly.current = null;
    setLive(null);
  }, [selecting.tool]);

  /** Where the pointer is on the picture, in its pixels. */
  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  /** Screen px per picture px. */
  const scale = () => ref.current!.getBoundingClientRect().width / W;

  /** A finished shape (picture px) joined to the selection. */
  const commit = (points: Pt[], mode: SelectMode) => {
    const { selecting: s, W: w, H: h } = now.current;
    let shape = polygonSelection(w, h, points);
    if (s.settings.feather > 0) shape = featherSelection(shape, s.settings.feather, w);
    s.onChange(combine(s.selection, shape, mode));
  };

  const closePolygon = () => {
    const o = poly.current;
    poly.current = null;
    setLive(null);
    if (o && o.points.length >= 3) commit(o.points, o.mode);
  };

  const addCorner = (p: Pt, mode: SelectMode) => {
    const o = poly.current;
    if (!o) {
      poly.current = { mode, points: [p] };
      return setLive({ kind: "polygon", points: [p], rubber: p });
    }
    const k = scale();
    const dist = (q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) * k;
    if (o.points.length >= 3 && dist(o.points[0]) < 8) return closePolygon();
    // The second click of a double-click (which closes it) adds no corner.
    if (dist(o.points[o.points.length - 1]) < 3) return;
    o.points.push(p);
    setLive({ kind: "polygon", points: o.points.slice(), rubber: p });
  };

  const polyOpen = live?.kind === "polygon";
  useEffect(() => {
    if (!polyOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable], [role=menu], [role=menubar]")) return;
      if (e.ctrlKey || e.altKey || e.metaKey || document.querySelector("dialog[open]")) return;
      const o = poly.current;
      if (!o) return;
      if (e.key === "Enter") closePolygon();
      else if (e.key === "Escape") {
        poly.current = null;
        setLive(null);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        o.points.pop();
        if (!o.points.length) poly.current = null;
        setLive((l) => (o.points.length && l?.kind === "polygon" ? { ...l, points: o.points.slice() } : null));
      } else return;
      // Keeps the app's own shortcuts (Delete = delete layer, Escape) off while a polygon is open.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
    // closePolygon only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polyOpen]);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    const p = at(e);
    const { tool, settings, selection } = now.current.selecting;
    if (tool === "wand") return now.current.selecting.onWand(p, modeOf(e, settings.mode));
    if (tool === "polygon") return addCorner(p, poly.current?.mode ?? modeOf(e, settings.mode));
    e.currentTarget.setPointerCapture(e.pointerId);
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    drag.current = {
      kind: plain && selection && selectedAt(selection, p, W, H) ? "move" : tool,
      mode: modeOf(e, settings.mode),
      shift: e.shiftKey,
      alt: e.altKey,
      start: p,
      end: p,
      points: [p],
      client: [e.clientX, e.clientY],
      moved: false,
    };
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) {
      if (poly.current) setLive({ kind: "polygon", points: poly.current.points.slice(), rubber: at(e) });
      return;
    }
    const p = at(e);
    d.end = p;
    if (d.kind === "lasso") {
      // Every point the pointer passed, not just one per frame, so quick strokes stay smooth.
      const passed = e.nativeEvent.getCoalescedEvents?.() ?? [];
      d.points.push(...(passed.length ? passed : [e.nativeEvent]).map(at));
    }
    if (!d.moved && Math.hypot(e.clientX - d.client[0], e.clientY - d.client[1]) >= 3) d.moved = true;
    if (!d.moved) return;
    if (d.kind === "lasso") setLive({ kind: "lasso", points: d.points.slice() });
    else if (d.kind === "move") setLive({ kind: "move", offset: [p[0] - d.start[0], p[1] - d.start[1]] });
    else setLive({ kind: d.kind, corners: corners(d.start, p, e.shiftKey && !d.shift, e.altKey && !d.alt) });
  };

  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setLive(null);
    const s = now.current.selecting;
    // A click without a drag deselects (as Photoshop), unless it was adding to or cutting from the selection.
    if (!d.moved) return void ((d.kind === "move" || d.mode === "new") && s.onChange(null));
    if (d.kind === "move") return void (s.selection && s.onChange(moveSelection(s.selection, d.end[0] - d.start[0], d.end[1] - d.start[1], W, H)));
    const [a, b] = corners(d.start, d.end, e.shiftKey && !d.shift, e.altKey && !d.alt);
    commit(d.kind === "lasso" ? d.points : d.kind === "marquee" ? rectPoints(a, b) : ellipsePoints(a, b), d.mode);
  };

  const cancel = () => {
    drag.current = null;
    if (!poly.current) setLive(null);
  };

  return (
    <div
      ref={ref}
      className="preview__paint is-select"
      role="application"
      aria-label="Select part of the picture"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (poly.current) closePolygon();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {selecting.selection && <SelectionOutline selection={selecting.selection} width={W} height={H} offset={live?.kind === "move" ? live.offset : undefined} />}
      {live && live.kind !== "move" && <LiveShape live={live} width={W} height={H} />}
    </div>
  );
}
