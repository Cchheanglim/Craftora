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
          <p className="fx-panel__hint">Drag a filter onto a clip to colour all of it (split the clip first for just a part), or onto an empty spot and stretch it. It colours every picture under it, not text.</p>
          <div className="fx__grid">{LOOKS.map((look) => tile({ kind: "filter", id: look.id }, look.label, lookFilter(look.id)))}</div>
        </>
      )}
      {tab === "effects" && (
        <>
          <p className="fx-panel__hint">Drag an effect onto a clip to cover all of it, or onto an empty spot and stretch it. It changes every picture under it.</p>
          <div className="fx__grid">{PICTURE_EFFECTS.map((effect) => tile({ kind: "effect", id: effect.id }, effect.label))}</div>
          <h3 className="section-label">Speed and direction</h3>
          <p className="fx-panel__hint">Drop one on a clip: it plays slower, faster or backwards. Split the clip first to change just a part.</p>
          <div className="fx__grid">{TIME_EFFECTS.map((effect) => tile({ kind: "time", id: effect.id }, effect.label))}</div>
        </>
      )}
      {tab === "transitions" && (
        <>
          <p className="fx-panel__hint">Click the + where two clips meet, then pick a transition here; or drag one onto that join.</p>
          <div className="fx__grid">{TRANSITION_KINDS.map((t) => tile({ kind: "transition", id: t.kind }, t.label))}</div>
        </>
      )}
    </section>
  );
}
