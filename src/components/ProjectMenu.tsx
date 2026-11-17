import { useState, type MouseEvent } from "react";
import type { ProjectEntry } from "../lib/storage";
import { ContextMenu } from "./ContextMenu";
import { useConfirm } from "./ConfirmDialog";
import type { useHidden } from "./Hidden";

export interface ProjectActions {
  onOpenProject: (id: string) => void;
  /** An empty name goes back to the project's first file's name. */
  onRenameProject: (id: string, name: string) => void;
  onDuplicateProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
}

/**
 * A project card's right-click menu (Home and Projects): Open, Rename (typed on the card), Duplicate, Hide or Unhide,
 * Delete (asked first). Spread `cardProps(p)` onto the project's `PictureCard`; render `menu` once.
 */
export function useProjectMenu(actions: ProjectActions, hidden: ReturnType<typeof useHidden>) {
  const [at, setAt] = useState<{ x: number; y: number; project: ProjectEntry } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  const remove = async (p: ProjectEntry) => {
    const ok = await ask({
      title: `Delete “${p.name}”?`,
      message: "The project and its edits are deleted for good. Your video files and finished exports aren't touched.",
      confirmLabel: "Delete project",
      danger: true,
    });
    if (ok) actions.onDeleteProject(p.id);
  };

  const p = at?.project;
  const isHidden = p ? hidden.isHidden(p.id) : false;
  const menu = (
    <>
      {dialog}
      {at && p && (
        <ContextMenu
          x={at.x}
          y={at.y}
          label={p.name}
          onClose={() => setAt(null)}
          items={[
            { label: "Open", icon: p.image ? "image" : "scissors", onClick: () => actions.onOpenProject(p.id) },
            { label: "Rename", icon: "pencil", onClick: () => setRenamingId(p.id) },
            { label: "Duplicate", icon: "copy", onClick: () => actions.onDuplicateProject(p.id) },
            "sep",
            isHidden
              ? { label: "Unhide", icon: "eye", onClick: () => hidden.setHidden([p.id], false) }
              : { label: "Hide", icon: "eyeOff", onClick: () => hidden.setHidden([p.id], true) },
            { label: "Delete…", icon: "trash", danger: true, onClick: () => void remove(p) },
          ]}
        />
      )}
    </>
  );

  const cardProps = (project: ProjectEntry) => ({
    onMenu: (e: MouseEvent) => {
      e.preventDefault();
      setAt({ x: e.clientX, y: e.clientY, project });
    },
    renaming: renamingId === project.id,
    onRename: (name: string | null) => {
      setRenamingId(null);
      if (name !== null && name.trim() !== project.name) actions.onRenameProject(project.id, name);
    },
  });

  return { menu, cardProps, remove };
}
