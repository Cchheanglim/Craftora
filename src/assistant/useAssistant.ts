/**
 * A conversation with the editing assistant on the user's own AI (Gemini, OpenAI or Claude, see
 * `providers.ts`). Each user message carries the current timeline; the AI answers with tool
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
import { fromAnthropic, fromOpenAI, toAnthropic, toOpenAI, type Provider, type Request } from "./providers";

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

export const hasKey = (provider: Provider) => invoke<boolean>("assistant_has_key", { provider });
export const setKey = (provider: Provider, key: string | null) => call<void>("assistant_set_key", { provider, key });
/** The models this key can use, as the provider lists them. */
export const listModels = (provider: Provider) =>
  call<ModelInfo[]>("assistant_models", { provider }).catch((err: Error) => Promise.reject(new Error(friendlyError(err.message, undefined, provider))));

/** One request to `provider`, translated from and back to the conversation's (Gemini's) shape. */
function generateWith(provider: Provider): (model: string, body: unknown) => Promise<Answer> {
  const send = <T,>(model: string, body: unknown) => call<T>("assistant_generate", { provider, model, body });
  if (provider === "openai") return async (model, body) => fromOpenAI(await send(model, toOpenAI(model, body as Request)));
  if (provider === "anthropic") return async (model, body) => fromAnthropic(await send(model, toAnthropic(model, body as Request)));
  return (model, body) => send<Answer>(model, body);
}

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
export function recommendedModels(models: ModelInfo[], provider: Provider = "gemini"): Recommendation[] {
  if (provider !== "gemini") return otherRecommendations(models, provider);
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

/** Claude: Opus first (smartest), then quicker Sonnet and Haiku. OpenAI: the newest full and mini GPT. */
function otherRecommendations(models: ModelInfo[], provider: Provider): Recommendation[] {
  const pick = (id: RegExp | ((m: ModelInfo) => boolean), why: string) => {
    const m = models.find((x) => (typeof id === "function" ? id(x) : id.test(x.id)));
    return m ? [{ ...m, why }] : [];
  };
  const picks =
    provider === "anthropic"
      ? [...pick(/^claude-opus-5$/, "smartest, recommended"), ...pick(/^claude-sonnet-5$/, "faster, cheaper"), ...pick(/^claude-haiku-4-5$/, "quickest and cheapest")]
      : [
          ...pick((m) => /^gpt-\d/.test(m.id) && !/mini|nano|\d{4}-\d{2}/.test(m.id), "smartest, recommended"),
          ...pick((m) => /^gpt-\d.*mini$/.test(m.id), "faster, cheaper"),
        ];
  return picks.length ? picks : models.slice(0, 3).map((m) => ({ ...m, why: "" }));
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
export const preferredModel = (models: ModelInfo[], provider: Provider = "gemini"): string | undefined => recommendedModels(models, provider)[0]?.id;


interface Options {
  api: ProjectApi;
  /** The project as it is right now (read at the moment of each step). */
  current: () => Project;
  playhead: () => number;
  seek: (t: number) => void;
  provider: Provider;
  model: string;
  /** Tried in order when `model` is busy or not in the plan. */
  fallbacks: string[];
}

export function useAssistant({ api, current, playhead, seek, provider, model, fallbacks }: Options) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  /** The whole conversation (in Gemini's shape); the AI's own turns are kept exactly as received. */
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
            generateWith(provider),
            fallbacks,
            (from, to, why) => add({ kind: "action", text: `${to} answered instead of ${from}. ${why}` }),
            undefined,
            provider,
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
    [api, busy, current, provider, model, fallbacks, playhead, seek],
  );

  /** Starts over: the AI forgets the conversation. */
  const reset = useCallback(() => {
    history.current = [];
    setEntries([]);
  }, []);

  return { entries, busy, send, reset };
}
