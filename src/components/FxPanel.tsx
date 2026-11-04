import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { LOOKS, PICTURE_EFFECTS, TIME_EFFECTS, lookFilter, type FxItem } from "../project/effects";
import { TRANSITION_KINDS } from "../project/model";
import { beginFxDrag } from "./TimelineEditor";
import "./FxPanel.css";

export type FxTab = "filters" | "effects" | "transitions";

/**
 * A tab of tiles (Craftora's cat doing each one on a loop) to drag onto the timeline; clicking a
 * tile (or Enter) puts it at the playhead instead.
 */
export function FxPanel({ tab, onPick }: { tab: FxTab; onPick: (item: FxItem) => void }) {
  const tile = (item: FxItem, label: string, look?: string) => (
    <button
      key={`${item.kind}-${item.id}`}
      type="button"
      className={`fx-tile is-${item.kind === "filter" ? "filter" : item.id}`}
      title={`Drag onto the timeline, or click to add at the playhead`}
      onPointerDown={(e: ReactPointerEvent) => {
        if (e.button === 0) beginFxDrag(item, e);
      }}
      onClick={() => onPick(item)}
    >
      <span className="fx-tile__stage">
        <img src="/craftora.svg" alt="" draggable={false} style={look ? ({ "--look": look } as CSSProperties) : undefined} />
        {item.kind === "transition" && <img className="is-next" src="/craftora.svg" alt="" draggable={false} />}
      </span>
      <span className="fx-tile__name">{label}</span>
    </button>
  );

  return (
    <section className="fx-panel" aria-label={tab === "filters" ? "Filters" : tab === "effects" ? "Effects" : "Transitions"}>
      {tab === "filters" && (
        <>
          <p className="fx-panel__hint">Drag a filter onto the timeline and stretch it over the part you want. It colours every picture under it, not text.</p>
          <div className="fx__grid">{LOOKS.map((look) => tile({ kind: "filter", id: look.id }, look.label, lookFilter(look.id)))}</div>
        </>
      )}
      {tab === "effects" && (
        <>
          <p className="fx-panel__hint">Drag an effect onto the timeline and stretch it over the part you want. It changes every picture under it.</p>
          <div className="fx__grid">{PICTURE_EFFECTS.map((effect) => tile({ kind: "effect", id: effect.id }, effect.label))}</div>
          <h3 className="section-label">Speed and direction</h3>
          <p className="fx-panel__hint">
            Drop one on a video clip where it should start: that part plays slower, faster or backwards. Drag the edges of that part to take in
            more or less of the clip.
          </p>
          <div className="fx__grid">{TIME_EFFECTS.map((effect) => tile({ kind: "time", id: effect.id }, effect.label))}</div>
        </>
      )}
      {tab === "transitions" && (
        <>
          <p className="fx-panel__hint">Drop a transition on the join between two clips. Craftora turns on the track's magnet so they sit back to back.</p>
          <div className="fx__grid">{TRANSITION_KINDS.map((t) => tile({ kind: "transition", id: t.kind }, t.label))}</div>
        </>
      )}
    </section>
  );
}
