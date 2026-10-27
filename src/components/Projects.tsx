import type { ProjectEntry } from "../lib/storage";
import { Icon } from "./Icon";
import { ProjectList } from "./Home";
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
  return (
    <section className="library" aria-labelledby="projects-title">
      <header className="library__head">
        <h1 id="projects-title">Projects</h1>
        <p>Everything you've edited, with its timeline and settings.</p>
      </header>
      <div className="library__group">
        <button type="button" className="btn btn--secondary library__new" onClick={onNewProject}>
          <Icon name="plus" size={14} />
          New project
        </button>
        <ProjectList projects={projects} currentId={currentId} onOpenProject={onOpenProject} onDeleteProject={onDeleteProject} />
      </div>
    </section>
  );
}
