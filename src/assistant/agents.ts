/**
 * AI already on this PC, used instead of an API key: agent programs (Claude Code, Codex, Gemini
 * CLI, Antigravity), run once per step with their own tools off and the conversation as text
 * (`agentText.ts`), and local AI servers that take ChatGPT's request shape (Ollama, LM Studio, or
 * any address on this PC). Rust finds and runs them (`src-tauri/src/agents.rs`).
 */
import { PROVIDERS, type Provider } from "./providers";

/** One agent program or local server the scan looked for. */
export interface Found {
  /** A program ("claude", "codex", "gemini-cli", "antigravity") or a server's address. */
  id: string;
  name: string;
  kind: "program" | "server";
  /** Installed (programs) or answering (servers). */
  ready: boolean;
  /** Where it was found, or why it can't be used. */
  detail: string;
}

/** What the assistant talks to: an AI service with the user's key, an agent program, or a local server. */
export type Source = Provider | `program:${string}` | `server:${string}`;

export const isKeyed = (source: Source): source is Provider => PROVIDERS.some((p) => p.id === source);
export const sourceOf = (found: Found): Source => `${found.kind}:${found.id}`;
/** The program id or server address in `source`. */
export const targetOf = (source: Source) => source.slice(source.indexOf(":") + 1);

/** A model choice for agent programs, which use whatever model they're set up with. */
export const OWN_MODEL = { id: "default", label: "Its own model" };
