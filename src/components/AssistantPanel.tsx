import { useEffect, useRef, useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { inDesktopApp } from "../lib/engine";
import type { Project } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import { MODELS, hasKey, setKey, useAssistant } from "../assistant/useAssistant";
import { Icon } from "./Icon";
import "./AssistantPanel.css";

const KEY_PAGE = "https://aistudio.google.com/apikey";
const EXAMPLES = [
  "Add the title “My trip” for the first 3 seconds, big and yellow",
  "Put crossfades between all the clips on Video 1",
  "Make the picture-in-picture small, in the top right corner",
  "Speed up the second clip 2× and fade out the end",
];
const MODEL_KEY = "craftora.assistantModel";

interface AssistantPanelProps {
  api: ProjectApi;
  current: () => Project;
  playhead: () => number;
  seek: (t: number) => void;
}

function rememberedModel(): string {
  try {
    const saved = localStorage.getItem(MODEL_KEY);
    return MODELS.some((m) => m.id === saved) ? saved! : MODELS[0].id;
  } catch {
    return MODELS[0].id;
  }
}

/** Chat with the AI editing assistant, which edits the timeline with the editor's own actions. */
export function AssistantPanel({ api, current, playhead, seek }: AssistantPanelProps) {
  const [keyState, setKeyState] = useState<"checking" | "missing" | "ready">("checking");
  const [model, setModel] = useState(rememberedModel);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const { entries, busy, send, reset } = useAssistant({ api, current, playhead, seek, model });

  useEffect(() => {
    if (!inDesktopApp) return;
    hasKey()
      .then((ok) => setKeyState(ok ? "ready" : "missing"))
      .catch(() => setKeyState("missing"));
  }, []);

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
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* not essential */
    }
  };

  if (!inDesktopApp) {
    return (
      <section className="asst" aria-label="Assistant">
        <p className="asst__note">The assistant needs the desktop app. Run Craftora with bun tauri dev to use it.</p>
      </section>
    );
  }
  if (keyState === "checking") return <section className="asst" aria-label="Assistant" />;
  if (keyState === "missing") return <KeySetup onSaved={() => setKeyState("ready")} />;

  return (
    <section className="asst" aria-label="Assistant">
      <header className="asst__head">
        <label htmlFor="asst-model" className="sr-only">
          Model
        </label>
        <select id="asst-model" className="field" value={model} onChange={(e) => chooseModel(e.target.value)} disabled={busy}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--ghost" onClick={reset} disabled={busy || entries.length === 0} title="Start a new conversation">
          New chat
        </button>
      </header>

      <div ref={logRef} className="asst__log" aria-live="polite">
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
          <button
            type="button"
            className="asst__link"
            onClick={() => {
              void setKey(null).then(() => setKeyState("missing"));
            }}
          >
            Remove API key
          </button>
          <button type="submit" className="btn btn--secondary" disabled={busy || !draft.trim()}>
            Send
            <kbd>↵</kbd>
          </button>
        </div>
      </form>
    </section>
  );
}

function KeySetup({ onSaved }: { onSaved: () => void }) {
  const [key, setKeyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await setKey(key);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="asst" aria-labelledby="asst-setup-title">
      <form className="asst__setup" onSubmit={save}>
        <h2 id="asst-setup-title">Set up the assistant</h2>
        <p>
          The assistant uses Google's Gemini API, which needs an API key. You can create one for free in Google AI Studio. A Google AI
          Pro subscription covers the Gemini app, not the API, so the key is separate.
        </p>
        <button type="button" className="btn btn--secondary" onClick={() => void openUrl(KEY_PAGE)}>
          <Icon name="link" size={13} />
          Get a key in Google AI Studio
        </button>
        <label htmlFor="asst-key">Paste your API key</label>
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
        {error ? (
          <p id="asst-key-error" className="asst__error" role="alert">
            {error}
          </p>
        ) : (
          <p id="asst-key-detail" className="asst__fine">
            Kept in Windows Credential Manager on this PC, and only ever sent to Google. Your timeline (clip names and times, not the
            media itself) goes to Google with each message.
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={saving || !key.trim()}>
          {saving ? "Saving…" : "Save key"}
        </button>
      </form>
    </section>
  );
}
