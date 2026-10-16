/**
 * A conversation with the Gemini editing assistant (`generateContent`, which every Gemini
 * model supports). Each user message carries the current timeline; Gemini answers with tool
 * calls, which are applied to a copy of the project and handed to the editor as one undo
 * step, until it replies in words.
 */
import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import { ShortIds } from "./tools";
import { runTurn, type Answer, type Content } from "./conversation";
import { friendlyError, reliable } from "./reliable";

export interface ModelInfo {
  id: string;
  label: string;
}

export type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "action"; text: string }
  | { kind: "error"; text: string };

const message = (err: unknown) => (typeof err === "string" ? err : err instanceof Error ? err.message : String(err));

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw new Error(message(err));
  }
}

export const hasKey = () => invoke<boolean>("assistant_has_key");
export const setKey = (key: string | null) => call<void>("assistant_set_key", { key });
/** The models this key can use, as Google lists them. */
export const listModels = () => call<ModelInfo[]>("assistant_models").catch((err: Error) => Promise.reject(new Error(friendlyError(err.message))));

/** "gemini-3.8-flash" → 3.8, for picking the newest of a family. */
const version = (id: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);

export interface Recommendation extends ModelInfo {
  /** Why to pick it, in a few words. */
  why: string;
}

/**
 * Two or three good choices from everything the key can use: the newest stable Flash (fast,
 * generous free limits), the newest flagship (smartest) and the newest Flash-Lite (cheapest).
 */
export function recommendedModels(models: ModelInfo[]): Recommendation[] {
  const stable = models.filter((m) => !/preview|exp|latest|\d{3,}$/i.test(m.id)).sort((a, b) => version(b.id) - version(a.id));
  const picks: Recommendation[] = [];
  const add = (m: ModelInfo | undefined, why: string) => m && !picks.some((p) => p.id === m.id) && picks.push({ ...m, why });
  add(stable.find((m) => /flash/.test(m.id) && !/lite/.test(m.id)), "fast, recommended");
  add(stable.find((m) => !/flash|lite|nano/.test(m.id)), "smartest, may need a paid plan");
  add(stable.find((m) => /lite/.test(m.id)), "quickest and cheapest");
  // Nothing matched the usual names: the first few, so there's always something to pick.
  if (picks.length === 0) models.slice(0, 3).forEach((m) => add(m, ""));
  return picks;
}

/**
 * Models to fall back on when the chosen one is busy or not in the user's plan: the stable
 * Flash models, newest first (they're in the free plan and good at editing).
 */
export function fallbackModels(models: ModelInfo[]): string[] {
  return models
    .filter((m) => /flash/.test(m.id) && !/preview|exp|latest|\d{3,}$/i.test(m.id))
    .sort((a, b) => version(b.id) - version(a.id) || Number(/lite/.test(a.id)) - Number(/lite/.test(b.id)))
    .map((m) => m.id);
}

/** A sensible default: the first recommendation. */
export const preferredModel = (models: ModelInfo[]): string | undefined => recommendedModels(models)[0]?.id;


interface Options {
  api: ProjectApi;
  /** The project as it is right now (read at the moment of each step). */
  current: () => Project;
  playhead: () => number;
  seek: (t: number) => void;
  model: string;
  /** Tried in order when `model` is busy or not in the plan. */
  fallbacks: string[];
}

export function useAssistant({ api, current, playhead, seek, model, fallbacks }: Options) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  /** The whole conversation as Gemini sees it; its own turns are kept exactly as received. */
  const history = useRef<Content[]>([]);
  const ids = useRef(new ShortIds());

  const add = (entry: ChatEntry) => setEntries((list) => [...list, entry]);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || busy || !model) return;
      add({ kind: "user", text: prompt });
      setBusy(true);
      try {
        const reply = await runTurn({
          model,
          prompt,
          history: history.current,
          ids: ids.current,
          generate: reliable(
            (m, body) => call<Answer>("assistant_generate", { model: m, body }),
            fallbacks,
            (from, to, why) => add({ kind: "action", text: `${to} answered instead of ${from}. ${why}` }),
          ),
          current,
          playhead,
          seek,
          // All edits made for this message become one undo step.
          commit: api.commit,
          onAction: (line) => add({ kind: "action", text: line }),
        });
        add({ kind: "assistant", text: reply });
      } catch (err) {
        add({ kind: "error", text: message(err) });
      } finally {
        setBusy(false);
      }
    },
    [api, busy, current, model, fallbacks, playhead, seek],
  );

  /** Starts over: Gemini forgets the conversation. */
  const reset = useCallback(() => {
    history.current = [];
    setEntries([]);
  }, []);

  return { entries, busy, send, reset };
}
