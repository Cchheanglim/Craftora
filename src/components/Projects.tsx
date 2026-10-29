import { useState } from "react";
import type { ProjectEntry } from "../lib/storage";
import { Icon } from "./Icon";
import { ProjectList } from "./Home";
import { useConfirm } from "./ConfirmDialog";
import { HiddenFold, useHidden } from "./Hidden";
import "./Library.css";

interface ProjectsProps {
  /** Saved projects, most recent first. */
  projects: ProjectEntry[];
  /** The project open in the editor, if it has anything in it. */
  currentId: string | null;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onDeleteProject: (id: string) => void;
}

export function Projects({ projects, currentId, onOpenProject, onNewProject, onDeleteProject }: ProjectsProps) {
  // Ticked projects while picking several; null when not picking.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const { ask, dialog } = useConfirm();
  const hidden = useHidden("projects");
  const shown = projects.filter((p) => !hidden.isHidden(p.id));
  const hiddenProjects = projects.filter((p) => hidden.isHidden(p.id));
  const ticked = selected ? projects.filter((p) => selected.has(p.id)) : [];
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
  return (
    <section className="library" aria-labelledby="projects-title">
      {dialog}
      <header className="library__head">
        <h1 id="projects-title">Projects</h1>
        <p>Everything you've edited, with its timeline and settings.</p>
      </header>
      <div className="library__group">
        {selected ? (
          <div className="library__bar">
            <span className="library__count">{ticked.length} selected</span>
            <button type="button" className="btn btn--ghost" onClick={() => setSelected(new Set(shown.map((p) => p.id)))}>
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
          </div>
        ) : (
          <div className="library__bar">
            <button type="button" className="btn btn--secondary" onClick={onNewProject}>
              <Icon name="plus" size={14} />
              New project
            </button>
            {projects.length > 0 && (
              <button type="button" className="btn btn--ghost" onClick={() => setSelected(new Set())}>
                <Icon name="check" size={14} />
                Select
              </button>
            )}
          </div>
        )}
        {projects.length > 0 && shown.length === 0 ? (
          <p className="library__muted">Every project is hidden.</p>
        ) : (
          <ProjectList
            projects={shown}
            currentId={currentId}
            onOpenProject={onOpenProject}
            onDeleteProject={onDeleteProject}
            selected={selected ?? undefined}
            onToggle={toggle}
            hidden={hidden}
          />
        )}
      </div>
      <HiddenFold count={hiddenProjects.length} note="Hidden here and on Home. The projects are still saved.">
        <ProjectList projects={hiddenProjects} currentId={currentId} onOpenProject={onOpenProject} onDeleteProject={onDeleteProject} hidden={hidden} />
      </HiddenFold>
    </section>
  );
}
