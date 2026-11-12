import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorText, inDesktopApp } from "../lib/engine";
import type { Project } from "../project/model";
import type { ProjectApi } from "../project/useProject";
import {
  fallbackModels,
  hasKey,
  listModels,
  localModels,
  preferredModel,
  recommendedModels,
  scanAgents,
  setKey,
  useAssistant,
  type ModelInfo,
} from "../assistant/useAssistant";
import { PROVIDERS, providerName, type Provider } from "../assistant/providers";
import { OWN_MODEL, isKeyed, sourceOf, switchedOff, targetOf, type Found, type Source } from "../assistant/agents";
import { Icon } from "./Icon";
import { useConfirm } from "./ConfirmDialog";
import { Select } from "./Select";
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
const reportUrl = (name: string, model: string) =>
  `https://github.com/Cchheanglim/Craftora/issues/new?${new URLSearchParams({
    title: "Report an AI assistant reply",
    body: `AI: ${name}\nModel: ${model || "unknown"}\n\nWhat did the assistant say or do? (paste the reply here)\n\n\nWhy is it wrong or inappropriate?\n`,
  })}`;
const PROVIDER_KEY = "craftora.assistantProvider";
/** The local AI server address the user connected by hand. */
export const LOCAL_KEY = "craftora.localAddress";
/** The model list's last entry, which opens the search instead of picking a model. */
const SEARCH = "__search__";
/** The AI list's last entry, which opens the setup screen instead of picking an AI. */
const CONNECT = "__connect__";

interface AssistantPanelProps {
  api: ProjectApi;
  current: () => Project;
  playhead: () => number;
  seek: (t: number) => void;
  /** A request from the timeline's AI edit box: sent once an AI is ready (after it's set up, if it isn't yet). */
  request?: { id: string; text: string } | null;
  /** The request was sent: the timeline can forget it. */
  onRequested?: () => void;
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
const modelKey = (source: Source) => (source === "gemini" ? MODEL_KEY : `${MODEL_KEY}.${source}`);

export const localServer = (address: string): Found => ({ id: address, name: "Local AI server", kind: "server", ready: true, detail: address });
/** The scan plus the address connected by hand, which the scan may not try. */
export function withSaved(list: Found[]): Found[] {
  const address = remembered(LOCAL_KEY);
  return address && !list.some((f) => f.kind === "server" && f.id === address) ? [...list, localServer(address)] : list;
}
function rememberedSource(): Source {
  const saved = remembered(PROVIDER_KEY) ?? "";
  return isKeyed(saved as Source) || /^(program|server):/.test(saved) ? (saved as Source) : "gemini";
}

/** Chat with the AI editing assistant, which edits the timeline with the editor's own actions. */
export function AssistantPanel({ api, current, playhead, seek, request, onRequested }: AssistantPanelProps) {
  /** The AIs with a saved key; null while checking. */
  const [keys, setKeys] = useState<Provider[] | null>(null);
  /** AI programs and local servers on this PC; null while scanning. */
  const [found, setFound] = useState<Found[] | null>(null);
  const [provider, setProvider] = useState<Source>(rememberedSource);
  const [off] = useState(switchedOff);
  const ready = Boolean(keys && found && (isKeyed(provider) ? keys.includes(provider) : found.some((f) => sourceOf(f) === provider && f.ready)));
  /** The setup screen, opened from the chat to connect another AI. */
  const [connecting, setConnecting] = useState(false);
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
  useEffect(() => {
    if (!request || !ready || !model || busy) return;
    onRequested?.();
    void send(request.text);
  }, [request, ready, model, busy, send, onRequested]);
  const { ask, dialog } = useConfirm();
  const recommended = models ? (isKeyed(provider) ? recommendedModels(models, provider) : models.map((m) => ({ ...m, why: "" }))) : [];
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (models ?? []).filter((m) => words.every((w) => `${m.id} ${m.label}`.toLowerCase().includes(w)));
  const name = isKeyed(provider) ? providerName(provider) : (found?.find((f) => sourceOf(f) === provider)?.name ?? targetOf(provider));
  // The key form needs an AI service; with a program or server in use it starts on Gemini.
  const keyed: Provider = isKeyed(provider) ? provider : "gemini";

  const startOver = async () => {
    const ok = await ask({
      title: "Start a new chat?",
      message: "The assistant forgets this conversation. Edits it already made stay on your timeline.",
      confirmLabel: "New chat",
    });
    if (ok) reset();
  };

  const removeKey = async () => {
    if (!isKeyed(provider)) return;
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
  const chooseProvider = (next: Source) => {
    if (next === provider) return;
    setProvider(next);
    remember(PROVIDER_KEY, next);
    reset();
  };

  const use = (next: Source) => {
    chooseProvider(next);
    setConnecting(false);
  };

  const scan = () =>
    scanAgents()
      .catch(() => [] as Found[])
      .then((list) => setFound(withSaved(list)));

  // A server address that answered: keep it, list it, and use it.
  const useAddress = (address: string) => {
    remember(LOCAL_KEY, address);
    const source: Source = `server:${address}`;
    setFound((list) => {
      const now = list ?? [];
      return now.some((f) => sourceOf(f) === source && f.ready) ? now : [...now.filter((f) => sourceOf(f) !== source), localServer(address)];
    });
    use(source);
  };

  useEffect(() => {
    if (!inDesktopApp) return;
    void Promise.all(PROVIDERS.map((p) => hasKey(p.id).catch(() => false))).then((has) => {
      const saved = PROVIDERS.filter((_, i) => has[i]).map((p) => p.id);
      setKeys(saved);
      // The AI used last, or else one that has a key.
      setProvider((now) => (!isKeyed(now) || saved.includes(now) || saved.length === 0 ? now : saved[0]));
    });
    void scan();
  }, []);

  // Once it's ready, ask the AI which models it can use.
  useEffect(() => {
    if (!ready) return;
    setModels(null);
    setModelsError(null);
    setModel("");
    // Agent programs use whatever model they're set up with.
    if (provider.startsWith("program:")) {
      setModels([OWN_MODEL]);
      setModel(OWN_MODEL.id);
      return;
    }
    let live = true;
    (isKeyed(provider) ? listModels(provider) : localModels(targetOf(provider)))
      .then((list) => {
        if (!live) return;
        setModels(list);
        const saved = remembered(modelKey(provider));
        setModel(list.some((m) => m.id === saved) ? saved! : ((isKeyed(provider) ? preferredModel(list, provider) : list[0]?.id) ?? ""));
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
  if (!keys || !found) return <section className="asst" aria-label="Assistant" />;
  if (!ready || connecting)
    return (
      <Setup
        found={found}
        provider={keyed}
        onUse={use}
        onScan={scan}
        onAddress={useAddress}
        onBack={ready ? () => setConnecting(false) : undefined}
        onProvider={chooseProvider}
        onSaved={() => {
          setKeys((list) => [...(list ?? []).filter((p) => p !== keyed), keyed]);
          use(keyed);
        }}
      />
    );

  return (
    <section className="asst" aria-label="Assistant">
      {dialog}
      <header className="asst__head">
        <label htmlFor="asst-provider" className="sr-only">
          AI
        </label>
        {/* Switched off in Settings → Assistant: hidden here, unless it's the one in use. */}
        <Select<string>
          id="asst-provider"
          className="asst__provider"
          value={provider}
          disabled={busy}
          options={[
            ...PROVIDERS.filter((p) => p.id === provider || !off.includes(p.id)).map((p) => ({
              value: p.id as string,
              label: `${p.name}${keys.includes(p.id) ? "" : " (add key)"}`,
            })),
            ...found
              .filter((f) => f.ready && (sourceOf(f) === provider || !off.includes(sourceOf(f))))
              .map((f) => ({ value: sourceOf(f) as string, label: f.name })),
            { value: CONNECT, label: "Connect another AI…" },
          ]}
          onChange={(next) => (next === CONNECT ? setConnecting(true) : chooseProvider(next as Source))}
        />
        {!provider.startsWith("program:") && (
          <>
            <label htmlFor="asst-model" className="sr-only">
              Model
            </label>
            <Select
              id="asst-model"
              value={model}
              disabled={busy || !models?.length}
              options={[
                ...(!models ? [{ value: "", label: modelsError ? "Couldn't load models" : "Loading models…" }] : []),
                ...(models?.length === 0 ? [{ value: "", label: isKeyed(provider) ? "No usable models for this key" : "No models found" }] : []),
                ...recommended.map((m) => ({ value: m.id, label: `${m.label}${m.why ? ` (${m.why})` : ""}` })),
                ...(model && !recommended.some((m) => m.id === model) ? [{ value: model, label: models?.find((m) => m.id === model)?.label ?? model }] : []),
                ...(models && models.length > recommended.length ? [{ value: SEARCH, label: `Search all ${models.length} models…` }] : []),
              ]}
              onChange={(next) => (next === SEARCH ? setSearching(true) : chooseModel(next))}
            />
          </>
        )}
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
            {isKeyed(provider) ? (
              <button type="button" className="asst__link" onClick={() => void removeKey()}>
                Remove {name} key
              </button>
            ) : (
              <button type="button" className="asst__link" onClick={() => setConnecting(true)}>
                Use another AI
              </button>
            )}
            <button
              type="button"
              className="asst__link"
              title="Tell us about a wrong or inappropriate reply"
              onClick={() => void openUrl(reportUrl(name, model))}
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

interface SetupProps {
  found: Found[];
  /** The AI service the key form shows. */
  provider: Provider;
  onUse: (source: Source) => void;
  onScan: () => Promise<void>;
  /** A local server address that answered. */
  onAddress: (address: string) => void;
  /** Back to the chat; only when the current AI is ready. */
  onBack?: () => void;
  onProvider: (p: Provider) => void;
  onSaved: () => void;
}

/** Connecting an AI: one already on this PC, or an AI service with an API key. */
function Setup({ found, provider, onUse, onScan, onAddress, onBack, onProvider, onSaved }: SetupProps) {
  const [view, setView] = useState<"pc" | "key">(() => (found.some((f) => f.ready) ? "pc" : "key"));
  const [scanning, setScanning] = useState(false);
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rescan = () => {
    setScanning(true);
    void onScan().finally(() => setScanning(false));
  };

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    const raw = address.trim();
    const target = raw.includes("://") ? raw : `http://${raw}`;
    setChecking(true);
    setError(null);
    try {
      await localModels(target);
      setAddress("");
      onAddress(target);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="asst" aria-labelledby="asst-setup-title">
      <div className="asst__setup">
        <div className="asst__setup-head">
          <h2 id="asst-setup-title">Connect your AI</h2>
          {onBack && (
            <button type="button" className="btn btn--ghost" onClick={onBack}>
              Back to chat
            </button>
          )}
        </div>
        <div className="segmented" role="group" aria-label="How to connect">
          <button type="button" aria-pressed={view === "pc"} onClick={() => setView("pc")}>
            On this PC
          </button>
          <button type="button" aria-pressed={view === "key"} onClick={() => setView("key")}>
            API key
          </button>
        </div>
        {view === "pc" ? (
          <>
            <p>Use an AI program or server you already have. It uses its own sign-in, so no key is needed.</p>
            {found.length > 0 ? (
              <ul className="asst__found">
                {found.map((f) => (
                  <li key={sourceOf(f)} className={f.ready ? undefined : "is-off"}>
                    <span>
                      {f.name}
                      {/* A program's install path is long and says little; it's kept on hover. */}
                      <span className="mono" title={f.detail}>
                        {f.kind === "program" && f.ready ? "Installed" : f.detail}
                      </span>
                    </span>
                    {f.ready && (
                      <button type="button" className="btn btn--secondary" onClick={() => onUse(sourceOf(f))}>
                        Use
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="asst__fine">None found.</p>
            )}
            <button type="button" className="btn btn--ghost asst__scan" onClick={rescan} disabled={scanning}>
              {scanning ? "Scanning…" : "Scan again"}
            </button>
            <form className="asst__form" onSubmit={(e) => void connect(e)}>
              <label htmlFor="asst-address">Address of a local AI server</label>
              <div className="asst__row">
                <input
                  id="asst-address"
                  className="field mono"
                  placeholder="e.g. localhost:11434"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "asst-address-error" : undefined}
                />
                <button type="submit" className="btn btn--secondary" disabled={checking || !address.trim()}>
                  {checking ? "Checking…" : "Connect"}
                </button>
              </div>
              {error && (
                <p id="asst-address-error" className="asst__error" role="alert">
                  {error}
                </p>
              )}
            </form>
            <ul className="asst__safety">
              <li>Each message sends your timeline (clip names, times and the words in text and captions) to that program or server, and on to its AI service. Not your videos, sound or files.</li>
              <li>Craftora runs AI programs in an empty folder and blocks their file and command tools, so they can't change your files.</li>
              <li>AI programs are slower than an API key: a reply can take half a minute.</li>
            </ul>
          </>
        ) : (
          <KeySetup provider={provider} onProvider={onProvider} onSaved={onSaved} />
        )}
      </div>
    </section>
  );
}

/** `picker`: the choice of AI service above the form; off where each service has its own row (Settings). */
export function KeySetup({ provider, onProvider, onSaved, picker = true }: { provider: Provider; onProvider: (p: Provider) => void; onSaved: () => void; picker?: boolean }) {
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
    <form className="asst__form" onSubmit={save}>
      {picker && (
        <>
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
        </>
      )}
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
  );
}
