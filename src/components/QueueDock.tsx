import { useEffect, useRef, useState } from "react";
import type { Job } from "../types";
import type { Queue } from "../state/useQueue";
import { formatSize } from "../project/exportPlan";
import { formatClock } from "../lib/timecode";
import { playableFile, revealFile, stopRecording } from "../lib/engine";
import { PlayFile } from "./PlayFile";
import { Thumb } from "./Thumb";
import { Icon } from "./Icon";
import { useConfirm } from "./ConfirmDialog";
import "./QueueDock.css";

interface QueueDockProps {
  queue: Queue;
  /** Id of the job added most recently, highlighted once as it lands. */
  freshId: string | null;
}

const isActive = (j: Job) => j.status === "downloading" || j.status === "encoding";

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** The Queue button at the top right (next to Import), with the list of downloads and exports under it. */
export function QueueDock({ queue, freshId }: QueueDockProps) {
  const { jobs } = queue;
  const running = jobs.filter(isActive).length;
  const waiting = jobs.filter((j) => j.status === "waiting").length;
  const paused = jobs.filter((j) => j.status === "paused").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const [open, setOpen] = useState(false);
  // A new failure opens the list, to show why.
  const [failedBefore, setFailedBefore] = useState(failed);
  if (failed !== failedBefore) {
    setFailedBefore(failed);
    if (failed > failedBefore) setOpen(true);
  }
  // Closes on a click anywhere else, or Escape. (Its confirm dialogs are inside it.)
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  const finished = jobs.filter((j) => j.status === "finished").length;
  const unfinished = jobs.filter((j) => j.status !== "finished" && j.status !== "failed");
  const overall = unfinished.length
    ? unfinished.reduce((sum, j) => sum + (j.progress ?? 0), 0) / unfinished.length
    : 0;

  const counts = [
    running && `${running} running`,
    waiting && `${waiting} waiting`,
    paused && `${paused} paused`,
    failed && `${failed} failed`,
    finished && `${finished} finished`,
  ].filter(Boolean);

  return (
    <div ref={boxRef} className="queue">
      <button
        type="button"
        className={failed ? "btn btn--secondary queue__button is-failed" : "btn btn--secondary queue__button"}
        aria-expanded={open}
        aria-controls="queue-panel"
        title={counts.length ? `Queue: ${counts.join(", ")}` : "Queue: your downloads and exports"}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={failed ? "alert" : "download"} size={14} />
        Queue
        {unfinished.length > 0 && <span className="queue__badge mono">{unfinished.length}</span>}
        {unfinished.length > 0 && (
          <span className="queue__overall" aria-hidden="true">
            <span style={{ width: `${overall}%` }} />
          </span>
        )}
      </button>
      {open && (
        <section id="queue-panel" className="queue__panel" aria-label="Queue">
          <header className="queue__head">
            <h2>Queue</h2>
            <span className="queue__counts">{counts.length ? counts.join(" · ") : "Empty"}</span>
            <div className="queue__actions">
              {jobs.some((j) => queue.canPauseJob(j) && (isActive(j) || j.status === "waiting")) ? (
                <button type="button" className="btn btn--ghost" onClick={queue.pauseAll}>
                  Pause all
                </button>
              ) : (
                paused > 0 && (
                  <button type="button" className="btn btn--ghost" onClick={queue.resumeAll}>
                    Resume all
                  </button>
                )
              )}
              {finished > 0 && (
                <button type="button" className="btn btn--ghost" onClick={queue.clearFinished}>
                  Clear finished
                </button>
              )}
              <button type="button" className="btn btn--icon" aria-label="Close the queue" onClick={() => setOpen(false)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          </header>
          <div className="queue__list">
            {jobs.length === 0 ? (
              <p className="queue__empty">Nothing queued. Exports and downloads run here while you keep editing.</p>
            ) : (
              <ul>
                {jobs.map((job) => (
                  <QueueRow key={job.id} job={job} queue={queue} fresh={job.id === freshId} />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export function QueueRow({ job, queue, fresh }: { job: Job; queue: Queue; fresh: boolean }) {
  const [copied, setCopied] = useState(false);
  // Downloads can be named before they finish (some start by themselves on fetch).
  const [naming, setNaming] = useState(false);
  const canName = Boolean(job.prefetch) && job.status !== "finished" && job.status !== "failed";
  const shownTitle = job.rename ?? job.title;
  const { ask, dialog } = useConfirm();
  const cancel = async () => {
    // A job that hasn't started loses nothing; a running one (or a paused download) loses its progress.
    const running = job.status === "downloading" || job.status === "encoding" || (job.status === "paused" && Boolean(job.prefetch));
    const what = job.prefetch || job.record ? "download" : "export";
    const ok =
      !running ||
      (await ask({
        title: `Cancel this ${what}?`,
        message: `“${job.title}” stops now and what it has done so far is thrown away. You can add it to the queue again later.`,
        confirmLabel: `Cancel ${what}`,
        danger: true,
      }));
    if (ok) queue.cancel(job.id);
  };
  const stop = async () => {
    const ok = await ask({
      title: "Stop recording?",
      message: `Everything recorded of “${job.title}” so far is kept, but Craftora can't pick the stream up again where it stopped.`,
      confirmLabel: "Stop recording",
      danger: true,
    });
    if (ok) void stopRecording(job.id);
  };
  const done = job.status === "finished";
  // Sites that don't list a file's size show 0 until yt-dlp reads the real one.
  const sizeSoFar = job.totalBytes ? job.totalBytes / 1_000_000 : job.sizeMb;
  const failed = job.status === "failed";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(job.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <li className={fresh ? "queue__row is-fresh" : "queue__row"}>
      {dialog}
      <div className="queue__name">
        <Thumb
          src={job.thumbnail}
          icon={job.kind === "audio" ? "music" : "film"}
          play={job.status === "finished" && job.kind !== "audio" && job.outputPath ? () => playableFile(job.outputPath!) : undefined}
        />
        <div>
          {naming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = new FormData(e.currentTarget).get("name")?.toString().trim();
                queue.edit(job.id, { rename: name && name !== job.title ? name : undefined });
                setNaming(false);
              }}
            >
              <input
                name="name"
                className="field queue__rename"
                defaultValue={shownTitle}
                aria-label={`File name for ${job.title}`}
                maxLength={80}
                spellCheck={false}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                onKeyDown={(e) => e.key === "Escape" && setNaming(false)}
                onInput={(e) => (e.currentTarget.value = e.currentTarget.value.replace(/[\\/:*?"<>|%\u0000-\u001f]/g, ""))}
              />
            </form>
          ) : (
            <div className="truncate" title={job.rename ? `Saved as “${job.rename}” when it finishes` : undefined}>
              {shownTitle}
            </div>
          )}
          <div className="queue__summary truncate">
            <MixedNumbers text={job.summary} />
          </div>
        </div>
      </div>

      <div className="queue__progress">
        {done ? (
          <span className="queue__done">
            <Icon name="check" size={14} />
            Finished <span>· {job.finishedAt ? ago(job.finishedAt) : ""}</span>
          </span>
        ) : job.record && job.status === "downloading" ? (
          <button type="button" className="btn btn--icon" aria-label={`Stop recording ${job.title}`} title="Stop recording" onClick={() => void stop()}>
            <Icon name="stop" size={14} />
          </button>
        ) : failed ? (
          <span className="queue__failed" title={job.error}>
            <Icon name="alert" size={14} />
            <span className="truncate">{job.error ?? "Failed"}</span>
          </span>
        ) : (
          <>
            <span
              className={`queue__bar${job.status === "paused" ? " is-paused" : ""}${
                job.progress === null && job.status !== "waiting" ? " is-indeterminate" : ""
              }`}
              role="progressbar"
              aria-label={`${job.title} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress === null ? undefined : Math.round(job.progress)}
            >
              <span style={{ width: job.progress === null ? undefined : `${job.progress}%` }} />
            </span>
            <span className="queue__status">
              <span className="truncate">{statusText(job)}</span>
              <span className="mono">{progressText(job)}</span>
            </span>
          </>
        )}
      </div>

      <span className="queue__size mono">{done ? formatSize(job.sizeMb) : sizeSoFar > 0 ? `~${formatSize(sizeSoFar)}` : ""}</span>

      <div className="queue__row-actions">
        {canName && !naming && (
          <button type="button" className="btn btn--icon" aria-label={`Rename ${shownTitle}`} title="Rename: the file gets this name when it finishes" onClick={() => setNaming(true)}>
            <Icon name="pencil" size={14} />
          </button>
        )}
        {queue.canPauseJob(job) && isActive(job) && (
          <button type="button" className="btn btn--icon" aria-label={`Pause ${job.title}`} onClick={() => queue.pause(job.id)}>
            <Icon name="pause" size={14} />
          </button>
        )}
        {job.status === "paused" && (
          <button type="button" className="btn btn--icon" aria-label={`Resume ${job.title}`} onClick={() => queue.resume(job.id)}>
            <Icon name="play" size={14} />
          </button>
        )}
        {failed && (
          <button type="button" className="btn btn--icon" aria-label={`Retry ${job.title}`} title="Retry" onClick={() => queue.retry(job.id)}>
            <Icon name="rotate" size={14} />
          </button>
        )}
        {done && !job.prefetch && job.outputPath && <PlayFile path={job.outputPath} name={job.fileName} />}
        {done && job.outputPath && (
          <>
            <button
              type="button"
              className="btn btn--icon"
              aria-label={`Show ${job.fileName} in folder`}
              title="Show in folder"
              onClick={() => void revealFile(job.outputPath!)}
            >
              <Icon name="folder" size={14} />
            </button>
          </>
        )}
        {done ? (
          <button type="button" className="btn btn--icon" aria-label={copied ? "Command copied" : `Copy command for ${job.title}`} onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={14} />
          </button>
        ) : failed ? (
          <button type="button" className="btn btn--icon" aria-label={`Remove ${job.title}`} title="Remove" onClick={() => queue.remove(job.id)}>
            <Icon name="x" size={14} />
          </button>
        ) : (
          <button type="button" className="btn btn--icon" aria-label={`Cancel ${job.title}`} title="Cancel" onClick={() => void cancel()}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
    </li>
  );
}

/** Words in the UI face, times and sizes in mono. */
function MixedNumbers({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d[\d:.]*)/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="mono">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

const mb = (bytes: number) => formatSize(bytes / 1_000_000);

function statusText(job: Job): string {
  switch (job.status) {
    case "downloading": {
      // An export from a link fetches its video first; it isn't a download, so it doesn't say so.
      const verb = job.prefetch || job.record ? "Downloading" : "Getting the video";
      if (job.downloadedBytes !== undefined) {
        const of = job.totalBytes ? ` of ${mb(job.totalBytes)}` : "";
        const speed = job.speedBps ? ` · ${mb(job.speedBps)}/s` : "";
        return `${verb} · ${mb(job.downloadedBytes)}${of}${speed}`;
      }
      if (job.spec) return `${verb}…`;
      if (job.record) return "Recording live";
      return `${verb} · ${formatSize((job.sizeMb * (job.progress ?? 0)) / 100)} of ${formatSize(job.sizeMb)}`;
    }
    case "encoding":
      return job.phase === "processing" ? "Finishing with FFmpeg" : job.phase === "cutting" ? "Cutting with FFmpeg" : "Encoding with FFmpeg";
    case "paused":
      // An export can't go on from the middle of a cut or an encode.
      return !job.prefetch && (job.spec || job.render) ? "Paused · starts again when resumed" : "Paused";
    default:
      return job.after?.length ? "Waiting for its video to download" : "Waiting";
  }
}

function progressText(job: Job): string {
  if (job.status === "waiting" || job.progress === null) return "";
  const eta = job.status === "downloading" && job.etaSeconds ? ` · ${formatClock(job.etaSeconds)}` : "";
  return `${Math.round(job.progress)}%${eta}`;
}
