import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorText, inDesktopApp } from "../lib/engine";
import type { Project } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import { fallbackModels, hasKey, listModels, preferredModel, recommendedModels, setKey, useAssistant, type ModelInfo } from "../assistant/useAssistant";
import { PROVIDERS, providerName, type Provider } from "../assistant/providers";
import { Icon } from "./Icon";
import { useConfirm } from "./ConfirmDialog";
import "./AssistantPanel.css";

const EXAMPLES = [
  "Add the title “My trip” for the first 3 seconds, big and yellow",
  "Put crossfades between all the clips on Video 1",
  "Make the picture-in-picture small, in the top right corner",
  "Speed up the second clip 2× and fade out the end",
];
const MODEL_KEY = "craftora.assistantModel";
/**
 * Reporting a reply (Microsoft Store policy 11.16: users can report generated content). Opens a new
 * GitHub issue naming the AI and model; the user pastes the reply themselves, so nothing is sent
 * without them seeing it.
 */
const reportUrl = (provider: Provider, model: string) =>
  `https://github.com/Cchheanglim/Craftora/issues/new?${new URLSearchParams({
    title: "Report an AI assistant reply",
    body: `AI: ${providerName(provider)}\nModel: ${model || "unknown"}\n\nWhat did the assistant say or do? (paste the reply here)\n\n\nWhy is it wrong or inappropriate?\n`,
  })}`;
const PROVIDER_KEY = "craftora.assistantProvider";
/** The model list's last entry, which opens the search instead of picking a model. */
const SEARCH = "__search__";

interface AssistantPanelProps {
  api: ProjectApi;
  current: () => Project;
  playhead: () => number;
  seek: (t: number) => void;
}

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not essential */
  }
}
// Gemini keeps the old key, so a model picked before other AIs existed stays picked.
const modelKey = (provider: Provider) => (provider === "gemini" ? MODEL_KEY : `${MODEL_KEY}.${provider}`);

/** Chat with the AI editing assistant, which edits the timeline with the editor's own actions. */
export function AssistantPanel({ api, current, playhead, seek }: AssistantPanelProps) {
  /** The AIs with a saved key; null while checking. */
  const [keys, setKeys] = useState<Provider[] | null>(null);
  const [provider, setProvider] = useState<Provider>(() => PROVIDERS.find((p) => p.id === remembered(PROVIDER_KEY))?.id ?? "gemini");
  const ready = Boolean(keys?.includes(provider));
  const [model, setModel] = useState("");
  /** The models this key can use; null while loading. */
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  /** The "any model" search, open or closed, and what's typed in it. */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  // Falling back to another model is for Gemini's free plan; other AIs use the model picked.
  const fallbacks = useMemo(() => (models && provider === "gemini" ? fallbackModels(models) : []), [models, provider]);
  const { entries, busy, send, reset } = useAssistant({ api, current, playhead, seek, provider, model, fallbacks });
  const { ask, dialog } = useConfirm();
  const recommended = models ? recommendedModels(models, provider) : [];
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (models ?? []).filter((m) => words.every((w) => `${m.id} ${m.label}`.toLowerCase().includes(w)));

  const startOver = async () => {
    const ok = await ask({
      title: "Start a new chat?",
      message: "The assistant forgets this conversation. Edits it already made stay on your timeline.",
      confirmLabel: "New chat",
    });
    if (ok) reset();
  };

  const removeKey = async () => {
    const name = providerName(provider);
    const ok = await ask({
      title: `Remove your ${name} API key?`,
      message: `Craftora deletes the key from this PC. To use ${name} again you'll need to paste it again (it stays in your ${name} account until you delete it there).`,
      confirmLabel: "Remove key",
      danger: true,
    });
    if (ok) await setKey(provider, null).then(() => setKeys((list) => (list ?? []).filter((p) => p !== provider)));
  };

  // Switching AI starts a new chat: each keeps its conversation in its own form.
  const chooseProvider = (next: Provider) => {
    if (next === provider) return;
    setProvider(next);
    remember(PROVIDER_KEY, next);
    reset();
  };

  useEffect(() => {
    if (!inDesktopApp) return;
    void Promise.all(PROVIDERS.map((p) => hasKey(p.id).catch(() => false))).then((has) => {
      const saved = PROVIDERS.filter((_, i) => has[i]).map((p) => p.id);
      setKeys(saved);
      // The AI used last, or else one that has a key.
      setProvider((now) => (saved.includes(now) || saved.length === 0 ? now : saved[0]));
    });
  }, []);

  // Once there's a key, ask the provider which models it can use.
  useEffect(() => {
    if (!ready) return;
    setModels(null);
    setModelsError(null);
    setModel("");
    let live = true;
    listModels(provider)
      .then((list) => {
        if (!live) return;
        setModels(list);
        const saved = remembered(modelKey(provider));
        setModel(list.some((m) => m.id === saved) ? saved! : (preferredModel(list, provider) ?? ""));
      })
      .catch((err) => live && setModelsError(errorText(err)));
    return () => {
      live = false;
    };
  }, [ready, provider]);

  // Follow the conversation as it grows.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [entries, busy]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() || busy) return;
    void send(draft);
    setDraft("");
  };

  const chooseModel = (id: string) => {
    setModel(id);
    remember(modelKey(provider), id);
  };

  if (!inDesktopApp) {
    return (
      <section className="asst" aria-label="Assistant">
        <p className="asst__note">The assistant needs the desktop app. Run Craftora with bun tauri dev to use it.</p>
      </section>
    );
  }
  if (!keys) return <section className="asst" aria-label="Assistant" />;
  if (!ready)
    return (
      <KeySetup
        provider={provider}
        onProvider={chooseProvider}
        onSaved={() => setKeys((list) => [...(list ?? []).filter((p) => p !== provider), provider])}
      />
    );

  return (
    <section className="asst" aria-label="Assistant">
      {dialog}
      <header className="asst__head">
        <label htmlFor="asst-provider" className="sr-only">
          AI
        </label>
        <select id="asst-provider" className="field asst__provider" value={provider} onChange={(e) => chooseProvider(e.target.value as Provider)} disabled={busy}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {keys.includes(p.id) ? "" : " (add key)"}
            </option>
          ))}
        </select>
        <label htmlFor="asst-model" className="sr-only">
          Model
        </label>
        <select
          id="asst-model"
          className="field"
          value={model}
          onChange={(e) => {
            if (e.target.value === SEARCH) setSearching(true);
            else chooseModel(e.target.value);
          }}
          disabled={busy || !models?.length}
        >
          {!models && <option value="">{modelsError ? "Couldn't load models" : "Loading models…"}</option>}
          {models?.length === 0 && <option value="">No usable models for this key</option>}
          {recommended.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.why ? ` (${m.why})` : ""}
            </option>
          ))}
          {model && !recommended.some((m) => m.id === model) && <option value={model}>{models?.find((m) => m.id === model)?.label ?? model}</option>}
          {models && models.length > recommended.length && <option value={SEARCH}>Search all {models.length} models…</option>}
        </select>
        <button type="button" className="btn btn--ghost" onClick={() => void startOver()} disabled={busy || entries.length === 0} title="Start a new conversation">
          New chat
        </button>
      </header>
      {searching && models && (
        <div className="asst__search">
          <div className="asst__search-field">
            <Icon name="search" size={13} />
            <label htmlFor="asst-model-search" className="sr-only">
              Search models
            </label>
            <input
              id="asst-model-search"
              className="field"
              placeholder="Type a model name, e.g. pro or 2.5"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearching(false)}
              autoFocus
            />
            <button type="button" className="btn btn--ghost" onClick={() => setSearching(false)}>
              Close
            </button>
          </div>
          <ul className="asst__results">
            {matches.slice(0, 50).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  aria-pressed={m.id === model}
                  onClick={() => {
                    chooseModel(m.id);
                    setSearching(false);
                    setQuery("");
                  }}
                >
                  <span>{m.label}</span>
                  <span className="mono">{m.id}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="asst__fine">No model matches “{query}”.</li>}
          </ul>
        </div>
      )}

      <div ref={logRef} className="asst__log" aria-live="polite">
        {modelsError && (
          <p className="asst__msg is-error">
            <Icon name="alert" size={12} />
            <span>Couldn't load your models: {modelsError}</span>
          </p>
        )}
        {entries.length === 0 ? (
          <div className="asst__empty">
            <p>Tell the assistant what to change. It edits your timeline directly, and Ctrl+Z undoes it.</p>
            <ul>
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button type="button" onClick={() => setDraft(ex)}>
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
            <p className="asst__fine">It reads clip names, times and settings, but can't watch or listen to your media.</p>
          </div>
        ) : (
          entries.map((entry, i) => (
            <p key={i} className={`asst__msg is-${entry.kind}`}>
              {entry.kind === "action" && <Icon name="check" size={12} />}
              {entry.kind === "error" && <Icon name="alert" size={12} />}
              <span>{entry.text}</span>
            </p>
          ))
        )}
        {busy && <p className="asst__msg is-thinking">Thinking…</p>}
      </div>

      <form className="asst__compose" onSubmit={submit}>
        <label htmlFor="asst-input" className="sr-only">
          Message the assistant
        </label>
        <textarea
          id="asst-input"
          className="field"
          rows={3}
          value={draft}
          placeholder="e.g. Cut the first clip at 0:12 and delete the start"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="asst__actions">
          <span className="asst__links">
            <button type="button" className="asst__link" onClick={() => void removeKey()}>
              Remove {providerName(provider)} key
            </button>
            <button
              type="button"
              className="asst__link"
              title="Tell us about a wrong or inappropriate reply"
              onClick={() => void openUrl(reportUrl(provider, model))}
            >
              Report a reply
            </button>
          </span>
          <button type="submit" className="btn btn--secondary" disabled={busy || !draft.trim() || !model}>
            Send
            <kbd>↵</kbd>
          </button>
        </div>
      </form>
    </section>
  );
}

function KeySetup({ provider, onProvider, onSaved }: { provider: Provider; onProvider: (p: Provider) => void; onSaved: () => void }) {
  const [key, setKeyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const info = PROVIDERS.find((p) => p.id === provider)!;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await setKey(provider, key);
      // Try the key before keeping it: a wrong one is removed again straight away.
      try {
        await listModels(provider);
      } catch (err) {
        await setKey(provider, null).catch(() => {});
        throw err;
      }
      setKeyText("");
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="asst" aria-labelledby="asst-setup-title">
      <form className="asst__setup" onSubmit={save}>
        <h2 id="asst-setup-title">Connect your AI</h2>
        <p>The assistant works with your own account at one of these AI services. Pick one and paste its API key.</p>
        <div className="segmented" role="group" aria-label="AI service">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === provider}
              onClick={() => {
                onProvider(p.id);
                setKeyText("");
                setError(null);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="asst__fine">{info.keyHelp}</p>
        <button type="button" className="btn btn--secondary" onClick={() => void openUrl(info.keyPage)}>
          <Icon name="link" size={13} />
          Get a {info.name} key
        </button>
        <label htmlFor="asst-key">Paste your {info.name} API key</label>
        <input
          id="asst-key"
          type="password"
          className="field mono"
          value={key}
          onChange={(e) => setKeyText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "asst-key-error" : "asst-key-detail"}
        />
        {error && (
          <p id="asst-key-error" className="asst__error" role="alert">
            {error}
          </p>
        )}
        <ul id="asst-key-detail" className="asst__safety">
          <li>Craftora checks the key with {info.company} first, and only keeps it if it works.</li>
          <li>It's stored encrypted in Windows Credential Manager on this PC, and never shown again, not even to Craftora's screens.</li>
          <li>It's only ever sent to {info.company}, over a secure connection. Never to Craftora or anyone else.</li>
          <li>Each message sends your timeline to {info.company}: clip names, times and the words in text and captions. Not your videos, sound or files.</li>
          <li>{info.company} bills your account for what you use. Remove the key any time.</li>
        </ul>
        <button type="submit" className="btn btn--primary" disabled={saving || !key.trim()}>
          {saving ? "Checking the key…" : "Save key"}
        </button>
      </form>
    </section>
  );
}
