/**
 * The AI services the assistant can use with the user's own key. The conversation is kept in
 * Gemini's shape (`conversation.ts`); for OpenAI and Claude each request is translated into their
 * shape and each answer back. Plain functions, so they're tested without the app.
 */
import type { Answer, Content, Part } from "./conversation";

export type Provider = "gemini" | "openai" | "anthropic";

export const PROVIDERS: { id: Provider; name: string; company: string; keyPage: string; keyHelp: string }[] = [
  {
    id: "gemini",
    name: "Gemini",
    company: "Google",
    keyPage: "https://aistudio.google.com/apikey",
    keyHelp: "Free to start in Google AI Studio. A Google AI Pro subscription covers the Gemini app, not the API, so the key is separate.",
  },
  {
    id: "openai",
    name: "ChatGPT",
    company: "OpenAI",
    keyPage: "https://platform.openai.com/api-keys",
    keyHelp: "From the OpenAI platform; it needs API credit. A ChatGPT Plus subscription covers the ChatGPT app, not the API.",
  },
  {
    id: "anthropic",
    name: "Claude",
    company: "Anthropic",
    keyPage: "https://console.anthropic.com/settings/keys",
    keyHelp: "From the Claude Console; it needs API credit. A Claude Pro subscription covers the Claude app, not the API.",
  },
];

export const providerName = (id: Provider) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

/** The request `runTurn` builds, in Gemini's shape. */
export interface Request {
  systemInstruction: { parts: { text: string }[] };
  contents: Content[];
  tools: { functionDeclarations: { name: string; description: string; parameters: unknown }[] }[];
}

const declarations = (r: Request) => r.tools.flatMap((t) => t.functionDeclarations);
const said = (parts: Part[]) =>
  parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");
const parse = (json: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(json || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};

// ---- OpenAI: Chat Completions --------------------------------------------------------------

export function toOpenAI(model: string, r: Request): unknown {
  const messages: unknown[] = [{ role: "system", content: r.systemInstruction.parts.map((p) => p.text).join("\n") }];
  for (const c of r.contents) {
    if (c.role === "model") {
      const calls = c.parts
        .filter((p) => p.functionCall)
        .map((p) => ({ id: p.functionCall!.id, type: "function", function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) } }));
      messages.push({ role: "assistant", content: said(c.parts) || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const p of c.parts) {
      if (p.functionResponse) messages.push({ role: "tool", tool_call_id: p.functionResponse.id, content: JSON.stringify(p.functionResponse.response) });
      else if (p.text) messages.push({ role: "user", content: p.text });
    }
  }
  const tools = declarations(r).map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }));
  return { model, messages, tools };
}

interface OpenAIAnswer {
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
  }[];
}

export function fromOpenAI(answer: OpenAIAnswer): Answer {
  const choice = answer.choices?.[0];
  const message = choice?.message;
  const parts: Part[] = [];
  const text = message?.content || message?.refusal;
  if (text) parts.push({ text });
  for (const call of message?.tool_calls ?? []) parts.push({ functionCall: { id: call.id, name: call.function.name, args: parse(call.function.arguments) } });
  return { candidates: [{ content: { role: "model", parts }, finishReason: choice?.finish_reason }] };
}

// ---- Anthropic: Messages -------------------------------------------------------------------

/** The newest Claude models: a declined request is re-run on another Claude model by Anthropic. */
const FALLBACK_MODELS = /^claude-(opus-5|opus-5-5|fable-5-1)$/;

type Block = { type: string; [key: string]: unknown };

export function toAnthropic(model: string, r: Request): unknown {
  const messages = r.contents.map((c) => {
    if (c.role === "model") {
      // Claude's own turns go back exactly as received (thinking blocks and their signatures too).
      const content = c.parts.map((p) =>
        p.claude ? (p.claude as Block) : p.functionCall ? { type: "tool_use", id: p.functionCall.id, name: p.functionCall.name, input: p.functionCall.args ?? {} } : { type: "text", text: p.text ?? "" },
      );
      return { role: "assistant", content };
    }
    const content = c.parts.map((p) =>
      p.functionResponse
        ? { type: "tool_result", tool_use_id: p.functionResponse.id, content: JSON.stringify(p.functionResponse.response) }
        : { type: "text", text: p.text ?? "" },
    );
    return { role: "user", content };
  });
  const tools = declarations(r).map(({ name, description, parameters }) => ({ name, description, input_schema: parameters }));
  return {
    model,
    max_tokens: 16000,
    system: r.systemInstruction.parts.map((p) => p.text).join("\n"),
    messages,
    tools,
    ...(FALLBACK_MODELS.test(model) ? { fallbacks: "default" } : {}),
  };
}

interface AnthropicAnswer {
  content?: Block[];
  stop_reason?: string;
}

export function fromAnthropic(answer: AnthropicAnswer): Answer {
  // A refusal comes back as an ordinary answer: say so instead of reading its (empty) content.
  if (answer.stop_reason === "refusal") return { candidates: [{ finishReason: "refusal" }] };
  const parts: Part[] = (answer.content ?? []).map((block) => {
    if (block.type === "text") return { text: String(block.text ?? ""), claude: block };
    if (block.type === "tool_use") return { functionCall: { id: String(block.id), name: String(block.name), args: (block.input as Record<string, unknown>) ?? {} }, claude: block };
    // Thinking and other blocks: not shown, but kept to send back unchanged.
    return { thought: true, claude: block };
  });
  return { candidates: [{ content: { role: "model", parts }, finishReason: answer.stop_reason }] };
}
