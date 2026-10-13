import { useState } from "react";
import type { Job } from "../types";
import type { Queue } from "../state/useQueue";
import { formatSize } from "../lib/exportPlan";
import { Icon } from "./Icon";
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

export function QueueDock({ queue, freshId }: QueueDockProps) {
  const [open, setOpen] = useState(true);
  const { jobs } = queue;
  const running = jobs.filter(isActive).length;
  const waiting = jobs.filter((j) => j.status === "waiting").length;
  const paused = jobs.filter((j) => j.status === "paused").length;
  const finished = jobs.filter((j) => j.status === "finished").length;
  const unfinished = jobs.filter((j) => j.status !== "finished");
  const overall = unfinished.length ? unfinished.reduce((sum, j) => sum + j.progress, 0) / unfinished.length : 0;

  const counts = [
    running && `${running} running`,
    waiting && `${waiting} waiting`,
    paused && `${paused} paused`,
    finished && `${finished} finished`,
  ].filter(Boolean);

  return (
    <section className="queue" aria-label="Queue">
      <header className="queue__head">
        <h2>Queue</h2>
        <span className="queue__counts">{counts.length ? counts.join(" · ") : "Empty"}</span>
        {!open && unfinished.length > 0 && (
          <span className="queue__overall" aria-hidden="true">
            <span style={{ width: `${overall}%` }} />
          </span>
        )}
        <div className="queue__actions">
          {running + waiting > 0 ? (
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
          <button
            type="button"
            className="btn btn--icon"
            aria-label={open ? "Hide queue" : "Show queue"}
            aria-expanded={open}
            aria-controls="queue-list"
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="chevronDown" className={open ? undefined : "queue__chevron--closed"} />
          </button>
        </div>
      </header>

      {open && (
        <div id="queue-list" className="queue__list">
          {jobs.length === 0 ? (
            <p className="queue__empty">Nothing queued. Set a range and press Add to queue; jobs run here while you keep trimming.</p>
          ) : (
            <ul>
              {jobs.map((job) => (
                <QueueRow key={job.id} job={job} queue={queue} fresh={job.id === freshId} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function QueueRow({ job, queue, fresh }: { job: Job; queue: Queue; fresh: boolean }) {
  const [copied, setCopied] = useState(false);
  const done = job.status === "finished";

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
      <div className="queue__name">
        <Icon name={job.kind === "audio" ? "music" : "film"} size={15} />
        <div>
          <div className="truncate">{job.title}</div>
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
        ) : (
          <>
            <span
              className={`queue__bar${job.status === "paused" ? " is-paused" : ""}`}
              role="progressbar"
              aria-label={`${job.title} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(job.progress)}
            >
              <span style={{ width: `${job.progress}%` }} />
            </span>
            <span className="queue__status">
              <span>{statusText(job)}</span>
              <span className="mono">{job.status === "waiting" ? "" : `${Math.round(job.progress)}%`}</span>
            </span>
          </>
        )}
      </div>

      <span className="queue__size mono">{formatSize(job.sizeMb)}</span>

      <div className="queue__row-actions">
        {(job.status === "downloading" || job.status === "encoding") && (
          <button type="button" className="btn btn--icon" aria-label={`Pause ${job.title}`} onClick={() => queue.pause(job.id)}>
            <Icon name="pause" size={14} />
          </button>
        )}
        {job.status === "paused" && (
          <button type="button" className="btn btn--icon" aria-label={`Resume ${job.title}`} onClick={() => queue.resume(job.id)}>
            <Icon name="play" size={14} />
          </button>
        )}
        {done ? (
          <button type="button" className="btn btn--icon" aria-label={copied ? "Command copied" : `Copy command for ${job.title}`} onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={14} />
          </button>
        ) : (
          <button type="button" className="btn btn--icon" aria-label={`Cancel ${job.title}`} onClick={() => queue.cancel(job.id)}>
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

function statusText(job: Job): string {
  const done = formatSize((job.sizeMb * job.progress) / 100);
  switch (job.status) {
    case "downloading":
      return `Downloading · ${done} of ${formatSize(job.sizeMb)}`;
    case "encoding":
      return "Encoding with FFmpeg";
    case "paused":
      return "Paused";
    case "failed":
      return job.error ?? "Failed";
    default:
      return "Waiting";
  }
}
