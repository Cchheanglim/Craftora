/**
 * One message to the editing assistant, start to finish: send the user's words with the
 * timeline, apply the tool calls Gemini answers with, send the results back, and repeat
 * until it replies in words. Plain functions (no React, no Tauri) so the same code runs in
 * the app and in tests; the caller supplies how to reach Gemini.
 */
import type { Project } from "../project/model";
import { ShortIds, SYSTEM_INSTRUCTION, TOOLS, describe, runTool } from "./tools";

/** Rounds of tool calls per message before giving up (stops runaway loops). */
const MAX_ROUNDS = 8;

export interface Part {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  // Other fields (such as thoughtSignature) are kept and sent back untouched.
  [key: string]: unknown;
}

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface Answer {
  candidates?: { content?: Content; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** Sends one `generateContent` request body to a model. */
export type Generate = (model: string, body: unknown) => Promise<Answer>;

export const FUNCTION_DECLARATIONS = [{ functionDeclarations: TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters })) }];

export interface TurnOptions {
  model: string;
  prompt: string;
  /** The conversation so far, extended in place (restored if the turn fails). */
  history: Content[];
  ids: ShortIds;
  generate: Generate;
  /** The project as it is right now. */
  current: () => Project;
  playhead: () => number;
  seek: (t: number) => void;
  /** Hands an edited project to the editor; `transient` after the first commit of a turn. */
  commit: (project: Project, transient: boolean) => void;
  /** One line per edit, for the chat. */
  onAction: (text: string) => void;
}

/** Runs one message; resolves with the assistant's reply. Throws (with the history restored) on errors. */
export async function runTurn(o: TurnOptions): Promise<string> {
  const start = o.history.length;
  let committed = false;
  try {
    o.history.push({ role: "user", parts: [{ text: `${o.prompt}\n\nCurrent timeline:\n${describe(o.current(), o.playhead(), o.ids)}` }] });
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const answer = await o.generate(o.model, {
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: o.history,
        tools: FUNCTION_DECLARATIONS,
      });
      const candidate = answer.candidates?.[0];
      if (!candidate?.content?.parts?.length) {
        const why = answer.promptFeedback?.blockReason ?? candidate?.finishReason;
        throw new Error(why ? `Gemini didn't answer (${why}). Try rewording the request.` : "Gemini sent an empty answer. Try again.");
      }
      o.history.push({ role: "model", parts: candidate.content.parts });
      const calls = candidate.content.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
      if (calls.length === 0) {
        const reply = candidate.content.parts
          .filter((p) => p.text && !p.thought)
          .map((p) => p.text)
          .join("")
          .trim();
        return reply || "Done.";
      }
      let project = o.current();
      const responses: Part[] = calls.map((fc, i) => {
        const outcome = runTool(fc.name, fc.args ?? {}, { project, ids: o.ids, seek: o.seek });
        project = outcome.project;
        if (outcome.summary) o.onAction(outcome.summary);
        // The last result carries the updated timeline, so the next round uses real ids.
        const response = i === calls.length - 1 ? { ...outcome.result, timeline: describe(project, o.playhead(), o.ids) } : outcome.result;
        return { functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response } };
      });
      if (project !== o.current()) {
        o.commit(project, committed);
        committed = true;
      }
      o.history.push({ role: "user", parts: responses });
    }
    throw new Error("The assistant kept going without finishing, so it was stopped. Your edits so far are kept (Ctrl+Z undoes them).");
  } catch (err) {
    // Forget the failed exchange so the next message starts from a clean conversation.
    o.history.length = start;
    throw err;
  }
}
