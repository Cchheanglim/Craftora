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
import { ShortIds, SYSTEM_INSTRUCTION, TOOLS, describe, runTool } from "./tools";

export interface ModelInfo {
  id: string;
  label: string;
}

/** Rounds of tool calls per message before giving up (stops runaway loops). */
const MAX_ROUNDS = 8;

export type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "action"; text: string }
  | { kind: "error"; text: string };

interface Part {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  // Other fields (such as thoughtSignature) are kept and sent back untouched.
  [key: string]: unknown;
}

interface Content {
  role: "user" | "model";
  parts: Part[];
}

interface Answer {
  candidates?: { content?: Content; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

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
export const listModels = () => call<ModelInfo[]>("assistant_models");

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
  add(stable.find((m) => !/flash|lite|nano/.test(m.id)), "smartest, slower");
  add(stable.find((m) => /lite/.test(m.id)), "quickest and cheapest");
  // Nothing matched the usual names: the first few, so there's always something to pick.
  if (picks.length === 0) models.slice(0, 3).forEach((m) => add(m, ""));
  return picks;
}

/** A sensible default: the first recommendation. */
export const preferredModel = (models: ModelInfo[]): string | undefined => recommendedModels(models)[0]?.id;

const FUNCTION_DECLARATIONS = [{ functionDeclarations: TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters })) }];

interface Options {
  api: ProjectApi;
  /** The project as it is right now (read at the moment of each step). */
  current: () => Project;
  playhead: () => number;
  seek: (t: number) => void;
  model: string;
}

export function useAssistant({ api, current, playhead, seek, model }: Options) {
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
      const start = history.current.length;
      // All edits made for this message become one undo step.
      let committed = false;
      try {
        history.current.push({ role: "user", parts: [{ text: `${prompt}\n\nCurrent timeline:\n${describe(current(), playhead(), ids.current)}` }] });
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const answer = await call<Answer>("assistant_generate", {
            model,
            body: { systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }, contents: history.current, tools: FUNCTION_DECLARATIONS },
          });
          const candidate = answer.candidates?.[0];
          if (!candidate?.content?.parts?.length) {
            const why = answer.promptFeedback?.blockReason ?? candidate?.finishReason;
            throw new Error(why ? `Gemini didn't answer (${why}). Try rewording the request.` : "Gemini sent an empty answer. Try again.");
          }
          history.current.push({ role: "model", parts: candidate.content.parts });
          const calls = candidate.content.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
          if (calls.length === 0) {
            const reply = candidate.content.parts
              .filter((p) => p.text && !p.thought)
              .map((p) => p.text)
              .join("")
              .trim();
            add({ kind: "assistant", text: reply || "Done." });
            return;
          }
          let project = current();
          const responses: Part[] = calls.map((fc, i) => {
            const outcome = runTool(fc.name, fc.args ?? {}, { project, ids: ids.current, seek });
            project = outcome.project;
            if (outcome.summary) add({ kind: "action", text: outcome.summary });
            // The last result carries the updated timeline, so the next round uses real ids.
            const response = i === calls.length - 1 ? { ...outcome.result, timeline: describe(project, playhead(), ids.current) } : outcome.result;
            return { functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response } };
          });
          if (project !== current()) {
            api.commit(project, committed);
            committed = true;
          }
          history.current.push({ role: "user", parts: responses });
        }
        add({ kind: "error", text: "The assistant kept going without finishing, so it was stopped. Your edits so far are kept (Ctrl+Z undoes them)." });
      } catch (err) {
        // Forget the failed exchange so the next message starts from a clean conversation.
        history.current.length = start;
        add({ kind: "error", text: message(err) });
      } finally {
        setBusy(false);
      }
    },
    [api, busy, current, model, playhead, seek],
  );

  /** Starts over: Gemini forgets the conversation. */
  const reset = useCallback(() => {
    history.current = [];
    setEntries([]);
  }, []);

  return { entries, busy, send, reset };
}
