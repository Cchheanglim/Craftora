import { useState, type PointerEvent, type ReactNode } from "react";
import type { MediaItem } from "../project/model";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import { beginMediaDrag } from "./TimelineEditor";
import type { FxTab } from "./FxPanel";
import type { IconName } from "./Icon";
import { IconTabs } from "./IconTabs";
import "./MediaPanel.css";

export interface MediaPanelProps {
  media: MediaItem[];
  /** Media whose preview copy is still being made. */
  preparing: Set<string>;
  /** Media id → how making its captions from the sound is going. */
  captioning: Record<string, string>;
  /** Links whose preview is being cached: how much (0–100) can already be scrubbed instantly. */
  previewReady: Record<string, number>;
  /** Links being downloaded for editing. */
  downloading: Set<string>;
  /** Downloads a link so it edits like a local file; absent in the browser preview. */
  onDownload?: (mediaId: string) => void;
  /** Absent in the browser preview. */
  onImport?: () => void;
  onAddMedia: (mediaId: string) => void;
  onRemoveMedia: (mediaId: string) => void;
  /** Replaces a media item's list picture with one picked on this PC; absent in the browser preview. */
  onChangePicture?: (mediaId: string) => void;
  /** Media used on the timeline can't be removed without removing its clips. */
  usedMedia: Set<string>;
  /** Opens the voice-over panel; absent in the browser preview. */
  onRecordVoice?: () => void;
  /** The Filters, Effects, Transitions and Shapes tiles (FxPanel), drawn in their tabs here. */
  fx: (tab: FxTab) => ReactNode;
  /** The Image editor: its own Text and Size tabs instead of Audio and Transitions. */
  still?: { text: ReactNode; size: ReactNode };
  /** The Image editor's tool strip picked this tab: shown alone, without the panel's own tab row. */
  only?: Tab;
}

export type Tab = "media" | "audio" | "text" | "size" | FxTab;
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "media", label: "Media", icon: "film" },
  { id: "audio", label: "Audio", icon: "music" },
  { id: "filters", label: "Filters", icon: "blend" },
  { id: "effects", label: "Effects", icon: "sparkle" },
  { id: "transitions", label: "Transitions", icon: "transition" },
  { id: "shapes", label: "Shapes", icon: "star" },
];
const STILL_TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "media", label: "Media", icon: "image" },
  { id: "text", label: "Text", icon: "text" },
  { id: "shapes", label: "Shapes", icon: "star" },
  { id: "filters", label: "Filters", icon: "blend" },
  { id: "effects", label: "Effects", icon: "sparkle" },
  { id: "size", label: "Size", icon: "crop" },
];

export function MediaPanel({
  media,
  preparing,
  captioning,
  previewReady,
  downloading,
  onDownload,
  onImport,
  onAddMedia,
  onRemoveMedia,
  onChangePicture,
  usedMedia,
  onRecordVoice,
  fx,
  still,
  only,
}: MediaPanelProps) {
  const [picked, setTab] = useState<Tab>("media");
  const tab = only ?? picked;
  const visuals = media.filter((m) => m.hasVideo);
  const sounds = media.filter((m) => !m.hasVideo);

  /** The status after the name, worded as the old sidebar list had it. */
  const status = (item: MediaItem) => {
    const state = item.missing
      ? "file not found"
      : downloading.has(item.id)
        ? previewReady[item.id] !== undefined
          ? `downloading, ${Math.floor(previewReady[item.id])}% ready to scrub`
          : "downloading…"
        : preparing.has(item.id)
          ? "preparing preview…"
          : captioning[item.id]
            ? captioning[item.id]
            : item.source.local
              ? "this PC"
              : "link";
    return item.source.live ? `recording live · ${state}` : state;
  };

  /** A media item's picture; clicking it picks another, where pictures can be changed. */
  const picture = (item: MediaItem) => {
    const thumb = (
      <Thumb
        src={item.source.thumbnail || (item.source.image ? item.source.previewUrl : undefined)}
        icon={item.source.image ? "image" : item.hasVideo ? "film" : "music"}
        // Streams (HLS) need hls.js, and live ones keep growing: those don't play here.
        play={item.hasVideo && !item.source.image && !item.source.previewHls && !item.source.live && item.source.previewUrl ? () => Promise.resolve(item.source.hoverUrl || item.source.previewUrl) : undefined}
      />
    );
    if (!onChangePicture) return thumb;
    return (
      <button type="button" className="media-panel__picture" aria-label={`Change the picture of ${item.name}`} onClick={() => onChangePicture(item.id)}>
        {thumb}
      </button>
    );
  };

  const drag = (item: MediaItem) => (e: PointerEvent<HTMLLIElement>) => {
    // The picture is a button too, but dragging from it still drags the media.
    if (e.button !== 0 || (e.target as HTMLElement).closest("button:not(.media-panel__picture)")) return;
    e.preventDefault(); // no text selection while dragging
    beginMediaDrag(item.id, e);
  };

  const actions = (item: MediaItem) => (
    <span className="media-panel__actions">
      {onDownload && !item.source.local && !downloading.has(item.id) && (
        <button
          type="button"
          className="btn btn--icon"
          aria-label={`Download ${item.name} for editing`}
          title="Download the whole video, so it edits smoothly and works offline"
          onClick={() => onDownload(item.id)}
        >
          <Icon name="download" size={14} />
        </button>
      )}
      <button type="button" className="btn btn--icon" aria-label={`Add ${item.name} to the timeline`} title="Add to the timeline" onClick={() => onAddMedia(item.id)}>
        <Icon name="plus" size={14} />
      </button>
      {!usedMedia.has(item.id) && (
        <button type="button" className="btn btn--icon" aria-label={`Remove ${item.name} from media`} title="Remove" onClick={() => onRemoveMedia(item.id)}>
          <Icon name="x" size={13} />
        </button>
      )}
    </span>
  );

  return (
    <section className="media-panel" aria-label="Media and audio">
      {!only && <IconTabs tabs={still ? STILL_TABS : TABS} value={tab} onPick={setTab} label="Media and audio" idPrefix="media-panel-tab" />}

      {(tab === "text" || tab === "size") && (
        <div className="media-panel__fx" id="media-panel-body" role="tabpanel" aria-labelledby={`media-panel-tab-${tab}`}>
          {still?.[tab]}
        </div>
      )}

      {tab !== "media" && tab !== "audio" && tab !== "text" && tab !== "size" && (
        <div className="media-panel__fx" id="media-panel-body" role="tabpanel" aria-labelledby={`media-panel-tab-${tab}`}>
          {fx(tab)}
        </div>
      )}

      {(tab === "media" || tab === "audio") && (
        <div className="media-panel__body" id="media-panel-body" role="tabpanel" aria-labelledby={`media-panel-tab-${tab}`}>
          {tab === "media" ? (
            <>
              {onImport && (
                <button type="button" className="media-panel__import" title="Videos and pictures from this PC, or drop them here" onClick={onImport}>
                  <span className="media-panel__import-main">
                    <Icon name="upload" size={14} />
                    Import
                  </span>
                </button>
              )}
              <h2 className="section-label media-panel__label">In this project · {visuals.length}</h2>
              {visuals.length === 0 ? (
                <p className="media-panel__hint">{still ? "Import pictures from this PC, then click one to add it as a layer." : "Import videos or pictures from this PC, or paste a link at the top."}</p>
              ) : (
                <ul className="media-panel__grid">
                  {visuals.map((item) => (
                    <li
                      key={item.id}
                      className={downloading.has(item.id) ? "media-panel__card is-downloading" : "media-panel__card"}
                      onPointerDown={drag(item)}
                      >
                      <span className="media-panel__pic">
                        {picture(item)}
                        <span className="media-panel__badge mono">{item.source.image ? "Image" : formatClock(item.source.duration)}</span>
                        {actions(item)}
                      </span>
                      <span className="media-panel__name truncate">{item.name}</span>
                      <span className="media-panel__meta">{status(item)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              {(onImport || onRecordVoice) && (
                <div className="media-panel__import-row">
                  {onImport && (
                    <button type="button" className="media-panel__import" onClick={onImport}>
                      <span className="media-panel__import-main">
                        <Icon name="upload" size={16} />
                        Import sound
                      </span>
                    </button>
                  )}
                  {onRecordVoice && (
                    <button type="button" className="media-panel__import" onClick={onRecordVoice}>
                      <span className="media-panel__import-main">
                        <Icon name="mic" size={16} />
                        Record voice-over
                      </span>
                    </button>
                  )}
                </div>
              )}
              <h2 className="section-label media-panel__label">Sound in this project · {sounds.length}</h2>
              {sounds.length === 0 ? (
                <p className="media-panel__hint">Import music, or record a voice-over.</p>
              ) : (
                <ul className="media-panel__list">
                  {sounds.map((item) => (
                    <li
                      key={item.id}
                      className={downloading.has(item.id) ? "media-panel__row is-downloading" : "media-panel__row"}
                      onPointerDown={drag(item)}
                      >
                      <span className="media-panel__tile" aria-hidden="true">
                        <Icon name={item.name.startsWith("Voice-over") ? "mic" : "music"} size={15} />
                      </span>
                      <span className="media-panel__text">
                        <span className="media-panel__name truncate">{item.name}</span>
                        <span className="media-panel__meta">
                          <span className="mono">{formatClock(item.source.duration)}</span> · {status(item)}
                        </span>
                      </span>
                      {actions(item)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
