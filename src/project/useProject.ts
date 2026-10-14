import { useCallback, useReducer } from "react";
import { applyEdit, type EditAction } from "./actions";
import type { MediaItem, Project } from "./model";

const HISTORY_LIMIT = 100;

interface State {
  project: Project;
  past: Project[];
  future: Project[];
}

type Action =
  | { type: "edit"; edit: EditAction; transient: boolean }
  /** Records an undo step before a drag; the drag's own edits are transient. */
  | { type: "checkpoint" }
  | { type: "undo" }
  | { type: "redo" }
  /** Another project replaces this one (opened, or new); history starts over. */
  | { type: "reset"; project: Project }
  /** Fresh preview links or a found/missing file: not an edit, so it applies to every undo step. */
  | { type: "refreshMedia"; mediaId: string; patch: Partial<MediaItem> };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "edit": {
      const project = applyEdit(state.project, action.edit);
      if (project === state.project) return state;
      if (action.transient) return { ...state, project };
      return { project, past: [...state.past, state.project].slice(-HISTORY_LIMIT), future: [] };
    }
    case "checkpoint":
      return { ...state, past: [...state.past, state.project].slice(-HISTORY_LIMIT), future: [] };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { project: previous, past: state.past.slice(0, -1), future: [state.project, ...state.future] };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { project: next, past: [...state.past, state.project], future: state.future.slice(1) };
    }
    case "reset":
      return { project: action.project, past: [], future: [] };
    case "refreshMedia": {
      const fix = (p: Project): Project => ({
        ...p,
        media: p.media.map((m) => (m.id === action.mediaId ? { ...m, ...action.patch } : m)),
      });
      return { project: fix(state.project), past: state.past.map(fix), future: state.future.map(fix) };
    }
  }
}

/** The project plus Undo/Redo. Every change goes through `edit` with a named action. */
export function useProject(initial: () => Project) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ project: initial(), past: [], future: [] }));
  return {
    project: state.project,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    edit: useCallback((edit: EditAction) => dispatch({ type: "edit", edit, transient: false }), []),
    /** For live updates during a drag, after `checkpoint`. */
    editLive: useCallback((edit: EditAction) => dispatch({ type: "edit", edit, transient: true }), []),
    checkpoint: useCallback(() => dispatch({ type: "checkpoint" }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    reset: useCallback((project: Project) => dispatch({ type: "reset", project }), []),
    refreshMedia: useCallback((mediaId: string, patch: Partial<MediaItem>) => dispatch({ type: "refreshMedia", mediaId, patch }), []),
  };
}

export type ProjectApi = ReturnType<typeof useProject>;
