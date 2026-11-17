import { useState } from "react";
import type { Job } from "../types";
import type { Queue } from "../state/useQueue";
import { formatSize } from "../project/exportPlan";
import { errorText, openFile, playableFile, revealFile } from "../lib/engine";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import { formatClock, formatWhen } from "../lib/timecode";
import { QueueRow } from "./QueueDock";
import { useConfirm } from "./ConfirmDialog";
import { HiddenFold } from "./Hidden";
import { PageTabs, PictureAction, PictureCard } from "./PictureCard";
import "./Library.css";

interface LibraryProps {
  /** Finished exports, newest first. */
  jobs: Job[];
  /** Exports still running, waiting or failed show at the top. */
  queue: Queue;
  outputDir: string;
  /** Picks the folder new exports are saved in; absent in the browser preview. */
  onChooseOutputDir?: () => void;
  onOpenWorkspace: () => void;
  /** Hides an export from the list (and from Home), or shows it again. The file isn't touched. */
  onHide: (id: string, hidden: boolean) => void;
  /** Moves the file to the Recycle Bin and takes it off the list; absent in the browser preview. */
  onDelete?: (job: Job) => void;
}

const HIDDEN_KEY = "craftora.hideExports";

type ExportTab = "all" | "video" | "picture" | "audio";

const TABS: { id: ExportTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Videos" },
  { id: "picture", label: "Pictures" },
  { id: "audio", label: "Sound" },
];

const jobName = (job: Job) => job.outputPath?.split(/[\\/]/).pop() ?? job.fileName;

function exportKind(job: Job, name: string): { id: Exclude<ExportTab, "all">; label: string } {
  if (job.kind === "audio") return { id: "audio", label: "Sound" };
  if (/\.(png|jpe?g|webp)$/i.test(name)) return { id: "picture", label: "Picture" };
  return { id: "video", label: "Video" };
}

function exportBadge(job: Job, kindId: Exclude<ExportTab, "all">): string | undefined {
  if (kindId === "picture") {
    const dims = job.render ? `${job.render.width}×${job.render.height}` : job.summary.match(/\b\d+×\d+\b/)?.[0];
    if (dims) return dims;
  } else {
    if (job.spec) return formatClock(job.spec.end - job.spec.start);
    const clock = job.summary.match(/^(\d+:\d{2}(?::\d{2})?)(?:\s*·|$)/)?.[1];
    if (clock) return clock;
  }
  return job.sizeMb > 0 ? formatSize(job.sizeMb) : undefined;
}

export function Library({ jobs, queue, outputDir, onChooseOutputDir, onOpenWorkspace, onHide, onDelete }: LibraryProps) {
  const shown = jobs.filter((j) => !j.hidden);
  const hidden = jobs.filter((j) => j.hidden);
  const active = queue.jobs.filter((j) => !j.prefetch && !j.record && j.status !== "finished");
  const [tab, setTab] = useState<ExportTab>("all");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const { ask, dialog } = useConfirm();

  // The list can be folded away, so its pictures don't show; remembered.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(HIDDEN_KEY, open ? "1" : "0");
    } catch {
      /* not essential */
    }
  };

  const play = (id: string, path: string) => {
    setProblems((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    void openFile(path).catch((err) => {
      const msg = errorText(err);
      setProblems((prev) => ({ ...prev, [id]: /isn't there/i.test(msg) ? "Moved or deleted" : "Couldn't play" }));
    });
  };

  const remove = async (job: Job, name: string) => {
    const ok = await ask({
      title: `Delete “${name}”?`,
      message: "The file moves to the Recycle Bin and leaves this list and Home.",
      note: "Craftora can't undo this, but you can restore the file from the Recycle Bin.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) onDelete?.(job);
  };

  const visible = shown.filter((job) => tab === "all" || exportKind(job, jobName(job)).id === tab);

  const renderCard = (job: Job, isHidden: boolean) => {
    const name = jobName(job);
    const kind = exportKind(job, name);
    const meta = [job.summary, formatSize(job.sizeMb), job.finishedAt ? formatWhen(job.finishedAt) : ""].filter(Boolean).join(" · ");
    return (
      <PictureCard
        key={job.id}
        thumb={
          <Thumb
            src={job.thumbnail}
            icon={job.kind === "audio" ? "music" : "film"}
            play={job.kind !== "audio" && job.outputPath ? () => playableFile(job.outputPath!) : undefined}
          />
        }
        tag={kind.label}
        badge={exportBadge(job, kind.id)}
        name={name}
        meta={problems[job.id] ?? meta}
        onOpen={job.outputPath ? () => play(job.id, job.outputPath!) : undefined}
        actions={
          isHidden ? (
            <>
              <PictureAction icon="eye" label={`Unhide ${name}`} onClick={() => onHide(job.id, false)} />
              {onDelete && <PictureAction icon="trash" label={`Delete ${name}`} onClick={() => void remove(job, name)} />}
            </>
          ) : (
            <>
              {job.outputPath && (
                <>
                  <PictureAction icon="play" label={`Play ${name}`} onClick={() => play(job.id, job.outputPath!)} />
                  <PictureAction icon="folder" label={`Show ${name} in folder`} onClick={() => void revealFile(job.outputPath!)} />
                </>
              )}
              <PictureAction icon="eyeOff" label={`Hide ${name}`} onClick={() => onHide(job.id, true)} />
              {onDelete && <PictureAction icon="trash" label={`Delete ${name}`} onClick={() => void remove(job, name)} />}
            </>
          )
        }
      />
    );
  };

  const tabEmpty =
    tab === "video" ? "No videos yet." : tab === "picture" ? "No pictures yet." : "No sound exports yet.";

  return (
    <section className="pc-page" aria-labelledby="library-title">
      {dialog}
      <header className="pc-head">
        <div>
          <h1 id="library-title">Exports</h1>
          <p>Everything Craftora has exported.</p>
        </div>
        {outputDir && (
          <div className="pc-head__actions">
            <button type="button" className="btn btn--secondary" onClick={() => void revealFile(outputDir)}>
              <Icon name="folder" size={14} />
              Open folder
            </button>
          </div>
        )}
      </header>

      {active.length > 0 && (
        <section className="library__group" aria-labelledby="library-progress">
          <div className="pc-bar">
            <div className="pc-bar__start">
              <h2 id="library-progress">In progress</h2>
            </div>
          </div>
          <div className="queue__list">
            <ul>
              {active.map((job) => (
                <QueueRow key={job.id} job={job} queue={queue} fresh={false} />
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="library__group" aria-labelledby="library-finished">
        <div className="pc-bar">
          <div className="pc-bar__start">
            <h2 id="library-finished">Finished</h2>
            <PageTabs tabs={TABS} value={tab} onChange={setTab} label="Show" />
          </div>
          <div className="pc-bar__end">
            <span className="truncate">
              Saving to <span className="mono">{outputDir}</span>
            </span>
            {onChooseOutputDir && (
              <button type="button" className="btn btn--ghost" onClick={onChooseOutputDir}>
                Change
              </button>
            )}
            {jobs.length > 0 && (
              <button type="button" className="btn btn--ghost" aria-expanded={open} aria-controls="library-files" onClick={toggle}>
                {open ? "Hide" : "Show"}
              </button>
            )}
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="library__empty">
            <p className="pc-muted">No finished files yet.</p>
            <button type="button" className="btn btn--secondary" onClick={onOpenWorkspace}>
              <Icon name="scissors" size={14} />
              Go to Workspace
            </button>
          </div>
        ) : (
          open &&
          (shown.length === 0 ? (
            <p className="pc-muted" id="library-files">
              Every export is hidden.
            </p>
          ) : visible.length === 0 ? (
            <p className="pc-muted" id="library-files">
              {tabEmpty}
            </p>
          ) : (
            <ul className="pc-grid" id="library-files">
              {visible.map((job) => renderCard(job, false))}
            </ul>
          ))
        )}
      </section>

      {jobs.length > 0 && (
        <HiddenFold count={hidden.length} note="Hidden here and on Home. The files are still in your save folder.">
          <ul className="pc-grid" id="library-hidden">
            {hidden.map((job) => renderCard(job, true))}
          </ul>
        </HiddenFold>
      )}
    </section>
  );
}
