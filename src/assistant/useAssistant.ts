/**
 * A conversation with the Gemini editing assistant (Interactions API). Each user message
 * carries the current timeline; Gemini answers with tool calls, which are applied to a copy
 * of the project and handed to the editor as one undo step, until it replies in words.
 */
import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import { ShortIds, SYSTEM_INSTRUCTION, TOOLS, describe, runTool } from "./tools";

export const MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (fast)" },
  { id: "gemini-4-argon", label: "Gemini 4 Argon (smartest, slower)" },
];
/** Rounds of tool calls per message before giving up (stops runaway loops). */
const MAX_ROUNDS = 8;

export type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "action"; text: string }
  | { kind: "error"; text: string };

interface Step {
  type: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
}

interface Interaction {
  id: string;
  steps?: Step[];
  output_text?: string;
}

const message = (err: unknown) => (typeof err === "string" ? err : err instanceof Error ? err.message : String(err));

async function request(body: unknown): Promise<Interaction> {
  try {
    return await invoke<Interaction>("assistant_request", { body });
  } catch (err) {
    throw new Error(message(err));
  }
}

export const hasKey = () => invoke<boolean>("assistant_has_key");
export async function setKey(key: string | null): Promise<void> {
  try {
    await invoke("assistant_set_key", { key });
  } catch (err) {
    throw new Error(message(err));
  }
}

/** The words in Gemini's latest answer. */
function replyText(answer: Interaction): string {
  const outputs = (answer.steps ?? []).filter((s) => s.type === "model_output");
  const last = outputs[outputs.length - 1];
  const text = last?.content?.map((c) => c.text ?? "").join("").trim();
  return text || answer.output_text?.trim() || "";
}

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
  const previous = useRef<string | undefined>(undefined);
  const ids = useRef(new ShortIds());
  /** Tool calls already answered, in case an answer repeats earlier steps. */
  const handled = useRef(new Set<string>());

  const add = (entry: ChatEntry) => setEntries((list) => [...list, entry]);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || busy) return;
      add({ kind: "user", text: prompt });
      setBusy(true);
      // All edits made for this message become one undo step.
      let committed = false;
      try {
        let input: unknown = `${prompt}\n\nCurrent timeline:\n${describe(current(), playhead(), ids.current)}`;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const answer = await request({
            model,
            input,
            tools: TOOLS,
            system_instruction: SYSTEM_INSTRUCTION,
            ...(previous.current ? { previous_interaction_id: previous.current } : {}),
          });
          previous.current = answer.id;
          const calls = (answer.steps ?? []).filter((s) => s.type === "function_call" && s.id && !handled.current.has(s.id));
          if (calls.length === 0) {
            add({ kind: "assistant", text: replyText(answer) || "Done." });
            return;
          }
          let project = current();
          const results = calls.map((call) => {
            handled.current.add(call.id!);
            const outcome = runTool(call.name ?? "", call.arguments ?? {}, { project, ids: ids.current, seek });
            project = outcome.project;
            if (outcome.summary) add({ kind: "action", text: outcome.summary });
            return { call, result: outcome.result };
          });
          if (project !== current()) {
            api.commit(project, committed);
            committed = true;
          }
          // Results go back with the updated timeline, so the next round uses real ids.
          const timeline = describe(project, playhead(), ids.current);
          input = results.map(({ call, result }, i) => ({
            type: "function_result",
            name: call.name,
            call_id: call.id,
            result: [{ type: "text", text: JSON.stringify(i === results.length - 1 ? { ...result, timeline } : result) }],
          }));
        }
        add({ kind: "error", text: "The assistant kept going without finishing, so it was stopped. Your edits so far are kept (Ctrl+Z undoes them)." });
      } catch (err) {
        add({ kind: "error", text: message(err) });
      } finally {
        setBusy(false);
      }
    },
    [api, busy, current, model, playhead, seek],
  );

  /** Starts over: Gemini forgets the conversation. */
  const reset = useCallback(() => {
    previous.current = undefined;
    handled.current.clear();
    setEntries([]);
  }, []);

  return { entries, busy, send, reset };
}
