import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { MediaSource } from "../types";
import { checkSite, errorText } from "../lib/engine";
import { formatClock } from "../lib/timecode";
import { formatSize } from "../project/exportPlan";
import { mediaFromSource } from "../project/model";
import { siteVerdict, type Verdict } from "./Home";
import { Icon } from "./Icon";
import "./ConfirmDialog.css";
import "./FetchDetails.css";

/**
 * What a fetched link holds, shown before anything from it is added or downloaded: `review`
 * resolves true when the user adds it; Escape, clicking outside or Cancel resolve false.
 * Render `dialog` once. `canCheckSite`: a VirusTotal key is there to check the website.
 */
export function useFetchReview(canCheckSite: boolean) {
  const [request, setRequest] = useState<{ source: MediaSource; link: string; resolve: (ok: boolean) => void } | null>(null);
  const review = useCallback((source: MediaSource, link: string) => new Promise<boolean>((resolve) => setRequest({ source, link, resolve })), []);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  const dialog = request ? <FetchDetails source={request.source} link={request.link} canCheckSite={canCheckSite} onClose={close} /> : null;
  return { review, dialog };
}

function FetchDetails({ source, link, canCheckSite, onClose }: { source: MediaSource; link: string; canCheckSite: boolean; onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  const [pictureFailed, setPictureFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const check = async () => {
    setChecking(true);
    try {
      setVerdict(siteVerdict(await checkSite(link)));
    } catch (err) {
      setVerdict({ tone: "warn", text: errorText(err) });
    } finally {
      setChecking(false);
    }
  };

  const { hasVideo, hasAudio } = mediaFromSource(source);
  const qualities = [...new Set(source.streams.filter((s) => s.kind === "video").map((s) => s.label))];
  const largest = Math.max(0, ...source.streams.map((s) => s.sizeMb));
  const rows: [string, ReactNode][] = [
    ["Website", websiteOf(link)],
    ["By", source.uploader || "Not given"],
    ["Length", source.live ? "Live now" : source.duration > 0 ? <span className="mono">{formatClock(source.duration)}</span> : "Not known yet"],
    ["What's in it", source.image ? "A picture" : hasVideo ? (hasAudio ? "Video with sound" : "Video without sound") : "Sound only"],
    ["Qualities", qualities.length ? qualities.join(", ") : hasVideo ? "One" : "Sound only"],
    ["Size", largest > 0 ? `Up to ${formatSize(largest)} (best quality)` : "Not listed by the website"],
    ["Captions", source.captions?.label ?? "None"],
    ...(source.chapters?.length ? [["Chapters", String(source.chapters.length)] as [string, ReactNode]] : []),
    [
      "When added",
      source.live
        ? "Craftora records it while it plays, into your Downloads folder."
        : source.downloadFirst || !source.previewUrl
          ? "Its website only lets the download in: Craftora downloads it to your Downloads folder."
          : "It plays from the website while you edit. It's downloaded only when you export it or pick Download for editing.",
    ],
  ];

  return (
    <dialog
      ref={ref}
      className="confirm fetch-details"
      aria-labelledby="fetch-details-title"
      // Escape closes a modal dialog by itself; treat it as Cancel.
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside its box) cancels.
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div className="confirm__box">
        <div className="fetch-details__picture">
          {source.thumbnail && !pictureFailed ? (
            <img src={source.thumbnail} alt="" referrerPolicy="no-referrer" onError={() => setPictureFailed(true)} />
          ) : (
            <span className="fetch-details__no-picture">
              <Icon name={hasVideo ? "film" : "music"} size={20} />
              No picture
            </span>
          )}
        </div>
        <h2 id="fetch-details-title">{source.title || "Untitled"}</h2>
        <p className="fetch-details__link mono" title={link}>
          {link}
        </p>
        <dl className="fetch-details__facts">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="confirm__note">
          Nothing from this link is on your PC yet. Everything Craftora downloads must really be a video or sound file, and your
          antivirus scans it before it's kept.
        </p>
        {verdict && (
          <p className={`fetch-details__verdict is-${verdict.tone}`} role={verdict.tone === "warn" ? "alert" : "status"}>
            <Icon name={verdict.tone === "ok" ? "check" : "alert"} size={13} />
            {verdict.text}
          </p>
        )}
        <div className="confirm__actions">
          {canCheckSite && !verdict && (
            <button type="button" className="btn btn--ghost fetch-details__check" onClick={() => void check()} disabled={checking}>
              <Icon name="shield" size={14} />
              {checking ? "Checking…" : "Check the website"}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => onClose(false)} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => onClose(true)}>
            Add to project
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** "youtube.com" from a link; the link itself if it has no website name. */
function websiteOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}
