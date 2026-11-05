/**
 * AI agent programs (Claude Code, Codex, Gemini CLI, Antigravity) take one text prompt and print
 * one text answer, with no function-calling API. So the request becomes one prompt that lists the
 * tools and asks for a JSON reply, and that reply is read back into an Answer with tool calls.
 */
import type { Answer, Part } from "./conversation";
import type { Request } from "./providers";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const RULES = `You are running inside Craftora, a video editor. Do NOT use your own tools (files, shell, web); use only the editing tools listed below.
To edit, reply with tool calls. You then get the results plus the updated timeline back, and reply again.
When you are finished, reply with an empty "calls" list and your answer for the user in "say".`;

const FORMAT = `Reply with ONLY one JSON object, no code fences, no other text:
{"say": "<words for the user, may be empty>", "calls": [{"name": "<tool name>", "args": { ... }}]}`;

/** Turns a request (Gemini's shape) into one text prompt for an agent program. */
export function toAgentPrompt(r: Request): string {
  const tools = r.tools
    .flatMap((t) => t.functionDeclarations)
    .map((d) => `- ${d.name}: ${d.description}\n  parameters: ${JSON.stringify(d.parameters)}`);
  const history: string[] = [];
  for (const c of r.contents) {
    const parts = c.parts.filter((p) => !p.thought);
    if (c.role === "model") {
      const say = parts.filter((p) => p.text).map((p) => p.text).join("");
      const calls = parts.filter((p) => p.functionCall).map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
      history.push(`[You]\n${JSON.stringify({ say, calls })}`);
      continue;
    }
    for (const p of parts) {
      if (p.functionResponse) history.push(`[Tool result: ${p.functionResponse.name}]\n${JSON.stringify(p.functionResponse.response)}`);
      else if (p.text) history.push(`[User]\n${p.text}`);
    }
  }
  return [
    r.systemInstruction.parts.map((p) => p.text).join("\n"),
    RULES,
    `Tools:\n${tools.join("\n")}`,
    FORMAT,
    `Conversation so far:\n\n${history.join("\n\n")}`,
    "Reply now with the JSON object only.",
  ].join("\n\n");
}

/** Reads an agent program's text reply: a `{say, calls}` JSON object, or else plain words. */
export function fromAgentText(text: string): Answer {
  const trimmed = text.trim();
  if (!trimmed) return { candidates: [{ finishReason: "empty" }] };
  let reply: unknown;
  // From the first { to the last }: covers bare JSON, ```json fences, and chatter around it.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      reply = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      reply = undefined;
    }
  }
  let parts: Part[] = [{ text: trimmed }];
  if (isObject(reply) && ("say" in reply || "calls" in reply)) {
    parts = [];
    if (typeof reply.say === "string" && reply.say) parts.push({ text: reply.say });
    const calls = Array.isArray(reply.calls) ? reply.calls : [];
    for (const call of calls) {
      if (!isObject(call) || typeof call.name !== "string") continue;
      parts.push({ functionCall: { id: `call_${parts.filter((p) => p.functionCall).length + 1}`, name: call.name, args: isObject(call.args) ? call.args : {} } });
    }
    // Finished with nothing to add: an empty reply, which the chat shows as "Done.".
    if (parts.length === 0) parts.push({ text: "" });
  }
  return { candidates: [{ content: { role: "model", parts }, finishReason: "stop" }] };
}
