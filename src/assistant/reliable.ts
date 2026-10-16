/**
 * Keeping the assistant answering when Gemini is busy or a model isn't in the user's plan:
 * retry briefly, then fall back to the next good model, and explain errors in plain words.
 * Errors from Rust look like "HTTP 503: <Google's message>".
 */
import type { Answer, Generate } from "./conversation";

type Problem =
  /** Google's servers are overloaded; usually gone within seconds. */
  | "busy"
  /** This model can't be used now with this key: not in the plan, or its limit is used up. */
  | "unavailable"
  /** Anything else (bad key, bad request): switching models won't help. */
  | "fatal";

const status = (message: string) => Number(/^HTTP (\d{3})/.exec(message)?.[1] ?? 0);

function classify(message: string): Problem {
  const code = status(message);
  if (code === 503 || code === 500 || code === 502 || code === 504 || /overloaded|high demand/i.test(message)) return "busy";
  if (code === 429 || code === 404) return "unavailable";
  return "fatal";
}

/** A Gemini error in words a user can act on. */
export function friendlyError(raw: string, model?: string): string {
  const name = model ? `${model} ` : "This model ";
  const code = status(raw);
  if (code === 0) return raw;
  if (code === 400 && /api key/i.test(raw)) return "Gemini didn't accept the API key. Remove it and paste it again (from Google AI Studio).";
  if (code === 401 || code === 403) return "Gemini refused the request. Check that the API key is still active in Google AI Studio.";
  if (code === 429 && /limit: 0/.test(raw)) return `${name}isn't included in your free plan. Pick a Flash model, or add billing in Google AI Studio.`;
  if (code === 429) return `${name}has reached its free limit for now. Try another model, or wait (the limits reset daily).`;
  if (code === 404) return `${name}isn't available to your key.`;
  if (classify(raw) === "busy") return "Gemini is very busy right now (on Google's side). Try again in a minute.";
  return raw.replace(/^HTTP \d{3}: /, "Gemini: ");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wraps `send` (one request to one model) so a turn survives busy servers and unusable
 * models: up to 3 tries per model a few seconds apart, then the next model in `fallbacks`.
 * Once another model has answered, it stays in use for the rest of the turn.
 */
export function reliable(
  send: Generate,
  fallbacks: string[],
  onSwitch: (from: string, to: string, why: string) => void,
  wait: (ms: number) => Promise<void> = sleep,
): Generate {
  let active: string | null = null;
  return async (model: string, body: unknown): Promise<Answer> => {
    const order = [active ?? model, ...[model, ...fallbacks].filter((m) => m !== (active ?? model))];
    const unique = order.filter((m, i) => order.indexOf(m) === i);
    let last = "";
    /** Why each model was given up on, for the message when another one answers. */
    const reasons = new Map<string, string>();
    for (const candidate of unique) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const answer = await send(candidate, body);
          const from = active ?? model;
          if (candidate !== from) onSwitch(from, candidate, reasons.get(from) ?? "");
          active = candidate;
          return answer;
        } catch (err) {
          last = err instanceof Error ? err.message : String(err);
          const problem = classify(last);
          if (problem === "fatal") throw new Error(friendlyError(last, candidate));
          if (problem === "busy" && attempt < 2) {
            await wait(1500 * (attempt + 1));
            continue;
          }
          reasons.set(candidate, friendlyError(last, candidate));
          break;
        }
      }
    }
    throw new Error(
      unique.length > 1
        ? `Every model tried (${unique.join(", ")}) was busy or out of free use. Try again in a minute.`
        : friendlyError(last, model),
    );
  };
}
