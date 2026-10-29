/**
 * Keeping the assistant answering when the AI service is busy or a model isn't in the user's plan:
 * retry briefly, then fall back to the next good model, and explain errors in plain words.
 * Errors from Rust look like "HTTP 503: <the provider's message>".
 */
import type { Answer, Generate } from "./conversation";
import { PROVIDERS, providerName, type Provider } from "./providers";

type Problem =
  /** The provider's servers are overloaded; usually gone within seconds. */
  | "busy"
  /** This model can't be used now with this key: not in the plan, or its limit is used up. */
  | "unavailable"
  /** Anything else (bad key, bad request): switching models won't help. */
  | "fatal";

const status = (message: string) => Number(/^HTTP (\d{3})/.exec(message)?.[1] ?? 0);

function classify(message: string): Problem {
  const code = status(message);
  if ([500, 502, 503, 504, 529].includes(code) || /overloaded|high demand/i.test(message)) return "busy";
  if (code === 429 || code === 404) return "unavailable";
  return "fatal";
}

/** An error from the AI service in words a user can act on. */
export function friendlyError(raw: string, model?: string, provider: Provider = "gemini"): string {
  const name = model ? `${model} ` : "This model ";
  const ai = providerName(provider);
  const site = provider === "gemini" ? "Google AI Studio" : provider === "openai" ? "the OpenAI platform" : "the Claude Console";
  const company = PROVIDERS.find((p) => p.id === provider)?.company ?? ai;
  const code = status(raw);
  if (code === 0) return raw;
  if ((code === 400 && /api key/i.test(raw)) || code === 401) return `${ai} didn't accept the API key. Remove it and paste it again (from ${site}).`;
  if (code === 403) return `${ai} refused the request. Check that the API key is still active in ${site}.`;
  if (code === 429 && /limit: 0/.test(raw)) return `${name}isn't included in your free plan. Pick a Flash model, or add billing in ${site}.`;
  if (code === 429 && /quota|credit|billing/i.test(raw)) return `Your ${ai} account is out of credit. Add some in ${site}.`;
  if (code === 429) return `${name}has reached its limit for now. Try another model, or wait a little.`;
  if (code === 402 || /credit balance/i.test(raw)) return `Your ${ai} account is out of credit. Add some in ${site}.`;
  if (code === 404) return `${name}isn't available to your key.`;
  if (classify(raw) === "busy") return `${ai} is very busy right now (on ${company}'s side). Try again in a minute.`;
  return raw.replace(/^HTTP \d{3}: /, `${ai}: `);
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
  provider: Provider = "gemini",
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
          if (problem === "fatal") throw new Error(friendlyError(last, candidate, provider));
          if (problem === "busy" && attempt < 2) {
            await wait(1500 * (attempt + 1));
            continue;
          }
          reasons.set(candidate, friendlyError(last, candidate, provider));
          break;
        }
      }
    }
    throw new Error(
      unique.length > 1
        ? `Every model tried (${unique.join(", ")}) was busy or out of free use. Try again in a minute.`
        : friendlyError(last, model, provider),
    );
  };
}
