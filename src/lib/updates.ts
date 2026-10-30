/**
 * New versions from GitHub Releases (Tauri's updater; see RELEASING.md). Updates are only
 * installed if they're signed with the project's update key.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { errorText, inDesktopApp } from "./engine";

const AUTO_KEY = "craftora.autoUpdateCheck";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string }
  | { kind: "installing"; version: string; percent: number | null }
  | { kind: "error"; message: string };

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The Microsoft Store edition (`scripts/make-msix.ps1`): the Store installs its updates. */
export const storeEdition = import.meta.env.VITE_STORE_BUILD === "1";

/** Development runs (`bun tauri dev`) never check: they aren't installed copies. */
const canUpdate = inDesktopApp && import.meta.env.PROD && !storeEdition;

export function useUpdates() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [version, setVersion] = useState<string | null>(null);
  const [auto, setAutoState] = useState(readAuto);
  const update = useRef<Update | null>(null);

  const checkNow = useCallback(async () => {
    if (!canUpdate) return;
    setStatus({ kind: "checking" });
    try {
      const found = await check();
      update.current = found;
      setStatus(found ? { kind: "available", version: found.version } : { kind: "current" });
    } catch (err) {
      setStatus({ kind: "error", message: errorText(err) });
    }
  }, []);

  /** Downloads and installs the update; the app restarts into the new version. */
  const install = useCallback(async () => {
    const found = update.current;
    if (!found) return;
    let total = 0;
    let received = 0;
    setStatus({ kind: "installing", version: found.version, percent: null });
    try {
      await found.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          setStatus({ kind: "installing", version: found.version, percent: total ? Math.round((received / total) * 100) : null });
        }
      });
      await relaunch();
    } catch (err) {
      setStatus({ kind: "error", message: errorText(err) });
    }
  }, []);

  const setAuto = useCallback((on: boolean) => {
    setAutoState(on);
    try {
      localStorage.setItem(AUTO_KEY, on ? "1" : "0");
    } catch {
      /* not essential */
    }
  }, []);

  useEffect(() => {
    if (inDesktopApp) void getVersion().then(setVersion);
    // Only once per start, and only if the user hasn't turned it off.
    if (canUpdate && readAuto()) void checkNow();
  }, [checkNow]);

  return { status, version, auto, setAuto, checkNow, install, available: canUpdate };
}

export type Updates = ReturnType<typeof useUpdates>;
