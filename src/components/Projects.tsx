import { useState, type ReactNode } from "react";
import type { ProjectEntry } from "../lib/storage";
import { formatClock } from "../lib/timecode";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";
import { ago, projectVideo } from "./Home";
import { PageSearch, PageTabs, PictureAction, PictureCard } from "./PictureCard";
import { useConfirm } from "./ConfirmDialog";
import { HiddenFold, useHidden } from "./Hidden";
import { useProjectMenu } from "./ProjectMenu";
import "./Library.css";
import "./Projects.css";

interface ProjectsProps {
  /** Saved projects, most recent first. */
  projects: ProjectEntry[];
  /** The project open in the editor, if it has anything in it. */
  currentId: string | null;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onNewImage: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDuplicateProject: (id: string) => void;
}

type ProjectTab = "all" | "videos" | "pictures";

const TABS: { id: ProjectTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "videos", label: "Videos" },
  { id: "pictures", label: "Pictures" },
];

export function Projects({ projects, currentId, onOpenProject, onNewProject, onNewImage, onDeleteProject, onRenameProject, onDuplicateProject }: ProjectsProps) {
  // Ticked projects while picking several; null when not picking.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [tab, setTab] = useState<ProjectTab>("all");
  const [query, setQuery] = useState("");
  const { ask, dialog } = useConfirm();
  const hidden = useHidden("projects");
  const { menu, cardProps, remove: deleteProject } = useProjectMenu({ onOpenProject, onRenameProject, onDuplicateProject, onDeleteProject }, hidden);

  const shown = projects.filter((p) => !hidden.isHidden(p.id));
  const hiddenProjects = projects.filter((p) => hidden.isHidden(p.id));
  const q = query.trim().toLowerCase();
  const visible = shown.filter((p) => {
    if (tab === "videos" && p.image) return false;
    if (tab === "pictures" && !p.image) return false;
    return !q || p.name.toLowerCase().includes(q);
  });
  const ticked = selected ? shown.filter((p) => selected.has(p.id)) : [];

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });


  const deleteTicked = async () => {
    const n = ticked.length;
    const ok = await ask({
      title: `Delete ${n} project${n === 1 ? "" : "s"}?`,
      message: "They and their edits are deleted for good. Your video files and finished exports aren't touched.",
      confirmLabel: `Delete ${n} project${n === 1 ? "" : "s"}`,
      danger: true,
    });
    if (!ok) return;
    for (const p of ticked) onDeleteProject(p.id);
    setSelected(null);
  };

  const renderCard = (p: ProjectEntry, picking: boolean, actions?: ReactNode) => {
    const isOpen = p.id === currentId;
    return (
      <PictureCard
        key={p.id}
        thumb={<Thumb src={p.thumbnail} icon={p.image ? "image" : "scissors"} play={() => projectVideo(p.id)} />}
        tag={isOpen ? "Open now" : p.image ? "Picture" : "Video"}
        tagOpen={isOpen}
        badge={p.image ? undefined : formatClock(p.duration)}
        name={p.name}
        meta={`Edited ${ago(p.savedAt)}`}
        onOpen={picking ? undefined : () => onOpenProject(p.id)}
        picked={picking && selected ? selected.has(p.id) : undefined}
        onPick={picking ? () => toggle(p.id) : undefined}
        actions={actions}
        {...(picking ? {} : cardProps(p))}
      />
    );
  };

  const emptyText =
    projects.length === 0
      ? "Your projects save themselves as you edit and show up here."
      : shown.length === 0
        ? "Every project is hidden."
        : "Nothing matches.";

  return (
    <section className="pc-page" aria-labelledby="projects-title">
      {dialog}
      {menu}
      <header className="pc-head">
        <div>
          <h1 id="projects-title">Projects</h1>
          <p>Everything you've edited, with its timeline and settings.</p>
        </div>
        <div className="pc-head__actions">
          {selected ? (
            <>
              <span className="projects__count">{ticked.length} selected</span>
              <button type="button" className="btn btn--ghost" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>
                Select all
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={ticked.length === 0}
                onClick={() => {
                  hidden.setHidden(
                    ticked.map((p) => p.id),
                    true,
                  );
                  setSelected(null);
                }}
              >
                <Icon name="eyeOff" size={14} />
                Hide
              </button>
              <button type="button" className="btn btn--secondary" disabled={ticked.length === 0} onClick={() => void deleteTicked()}>
                <Icon name="trash" size={14} />
                Delete
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setSelected(null)}>
                Done
              </button>
            </>
          ) : (
            <>
              {projects.length > 0 && (
                <button type="button" className="btn btn--secondary" onClick={() => setSelected(new Set())}>
                  <Icon name="check" size={14} />
                  Select
                </button>
              )}
              <button type="button" className="btn btn--secondary" onClick={onNewImage}>
                <Icon name="image" size={14} />
                New image
              </button>
              <button type="button" className="btn btn--primary" onClick={onNewProject}>
                <Icon name="plus" size={14} />
                New video
              </button>
            </>
          )}
        </div>
      </header>

      <div className="projects__list">
        <div className="pc-bar">
          <div className="pc-bar__start">
            <PageTabs tabs={TABS} value={tab} onChange={setTab} label="Show" />
          </div>
          <div className="pc-bar__end">
            <PageSearch id="projects-search" value={query} onChange={setQuery} placeholder="Search projects" />
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="pc-muted">{emptyText}</p>
        ) : (
          <ul className="pc-grid">
            {visible.map((p) =>
              renderCard(
                p,
                selected !== null,
                <>
                  <PictureAction icon="eyeOff" label={`Hide ${p.name}`} onClick={() => hidden.setHidden([p.id], true)} />
                  <PictureAction icon="trash" label={`Delete ${p.name}`} onClick={() => void deleteProject(p)} />
                </>,
              ),
            )}
          </ul>
        )}
      </div>

      <HiddenFold count={hiddenProjects.length} note="Hidden here and on Home. The projects are still saved.">
        <ul className="pc-grid">
          {hiddenProjects.map((p) =>
            renderCard(p, false, <PictureAction icon="eye" label={`Unhide ${p.name}`} onClick={() => hidden.setHidden([p.id], false)} />),
          )}
        </ul>
      </HiddenFold>
    </section>
  );
}
