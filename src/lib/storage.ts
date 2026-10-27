/**
 * What Craftora remembers between runs: projects, finished exports and the save folder.
 * The desktop app keeps them as files in its data folder (src-tauri/src/store.rs); the
 * browser preview uses localStorage instead.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Job } from "../types";
import type { Project } from "../project/model";
import { inDesktopApp } from "./engine";

/** What the project list shows. */
export interface ProjectEntry {
  id: string;
  name: string;
  /** Milliseconds since 1970. */
  savedAt: number;
  duration: number;
  clips: number;
  /** The first picture in the project (see `MediaSource.thumbnail`). */
  thumbnail?: string;
}

export interface SavedProject extends ProjectEntry {
  version: 1;
  project: Project;
}

export const DEFAULT_OUTPUT_DIR = "Videos\\Craftora";
const BROWSER_PROJECTS = "craftora.projects";
const BROWSER_HISTORY = "craftora.history";
const FETCH_HISTORY = "craftora.fetchHistory";
const PAUSED_DOWNLOADS = "craftora.pausedDownloads";

const message = (err: unknown) => (typeof err === "string" ? err : err instanceof Error ? err.message : String(err));

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw new Error(message(err));
  }
}

function browserRead<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

function browserWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the browser preview just forgets */
  }
}

export async function listProjects(): Promise<ProjectEntry[]> {
  if (inDesktopApp) return call<ProjectEntry[]>("list_projects");
  const all = browserRead<Record<string, SavedProject>>(BROWSER_PROJECTS, {});
  return Object.values(all)
    .map(({ id, name, savedAt, duration, clips, thumbnail }) => ({ id, name, savedAt, duration, clips, thumbnail }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadProject(id: string): Promise<SavedProject> {
  if (inDesktopApp) return JSON.parse(await call<string>("load_project", { id })) as SavedProject;
  const saved = browserRead<Record<string, SavedProject>>(BROWSER_PROJECTS, {})[id];
  if (!saved) throw new Error("That project isn't there any more.");
  return saved;
}

export async function saveProject(saved: SavedProject): Promise<void> {
  if (inDesktopApp) return call("save_project", { id: saved.id, contents: JSON.stringify(saved) });
  browserWrite(BROWSER_PROJECTS, { ...browserRead<Record<string, SavedProject>>(BROWSER_PROJECTS, {}), [saved.id]: saved });
}

export async function deleteProject(id: string): Promise<void> {
  if (inDesktopApp) return call("delete_project", { id });
  const all = browserRead<Record<string, SavedProject>>(BROWSER_PROJECTS, {});
  delete all[id];
  browserWrite(BROWSER_PROJECTS, all);
}

/** Finished exports, newest first. */
export async function loadHistory(): Promise<Job[]> {
  if (!inDesktopApp) return browserRead<Job[]>(BROWSER_HISTORY, []);
  try {
    const jobs = JSON.parse(await call<string>("load_history"));
    return Array.isArray(jobs) ? (jobs as Job[]) : [];
  } catch {
    return [];
  }
}

export async function saveHistory(jobs: Job[]): Promise<void> {
  if (inDesktopApp) return call("save_history", { contents: JSON.stringify(jobs) });
  browserWrite(BROWSER_HISTORY, jobs);
}

/** A link fetched before, listed in the sidebar so it can be fetched again. */
export interface FetchEntry {
  url: string;
  title: string;
  thumbnail?: string;
  /** Milliseconds since 1970. */
  fetchedAt: number;
}

// shortcut: kept in the window's localStorage (it persists in the desktop app too); move to
// store.rs next to the export history if it ever needs to survive a reset of the app's web data.
export const loadFetchHistory = (): FetchEntry[] => browserRead<FetchEntry[]>(FETCH_HISTORY, []);
export const saveFetchHistory = (entries: FetchEntry[]) => browserWrite(FETCH_HISTORY, entries);

/** A file once imported into a project, remembered for the Media library page. */
export interface LibraryEntry {
  path: string;
  name: string;
  kind: "video" | "audio" | "image";
  /** Seconds; 0 for pictures. */
  duration: number;
  /** A small JPEG data URL, when one was made. */
  thumbnail?: string;
  addedAt: number;
  /** Starred: shown under "Saved", and never dropped to make room. */
  saved?: boolean;
}
const MEDIA_LIBRARY = "craftora.mediaLibrary";
/** About 15 kB each with a picture, so the list stays far below what the window's storage holds. */
export const LIBRARY_LIMIT = 300;
export const loadMediaLibrary = (): LibraryEntry[] => browserRead<LibraryEntry[]>(MEDIA_LIBRARY, []);
export const saveMediaLibrary = (entries: LibraryEntry[]) => browserWrite(MEDIA_LIBRARY, entries);

/** Paused downloads, so they wait in the queue after Craftora is closed (their parts stay on disk). */
export const loadPausedDownloads = (): Job[] => browserRead<Job[]>(PAUSED_DOWNLOADS, []);
export const savePausedDownloads = (jobs: Job[]) => browserWrite(PAUSED_DOWNLOADS, jobs);

export async function getOutputDir(): Promise<string> {
  return inDesktopApp ? call<string>("get_output_dir") : DEFAULT_OUTPUT_DIR;
}

/** `null` goes back to the default folder. Returns where exports go now. */
export async function setOutputDir(path: string | null): Promise<string> {
  return inDesktopApp ? call<string>("set_output_dir", { path }) : DEFAULT_OUTPUT_DIR;
}
