import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { errorText } from "../lib/engine";
import { hasKey, localModels, scanAgents, setKey } from "../assistant/useAssistant";
import { PROVIDERS, type Provider } from "../assistant/providers";
import { sourceOf, switchOff, switchedOff, type Found, type Source } from "../assistant/agents";
import { KeySetup, LOCAL_KEY, localServer, withSaved } from "./AssistantPanel";
import { useConfirm } from "./ConfirmDialog";
import { Icon } from "./Icon";
import "./AiConnections.css";

/** The "Local AI server" row, which connects one by its address. */
const SERVER_ROW = "__server__";

interface Row {
  id: string;
  name: string;
  status: string;
  /** Usable now: a green dot. */
  ready: boolean;
  /** Programs found but not usable, listed dimmed with no details. */
  dim?: boolean;
  details?: ReactNode;
}

/** Settings → Assistant: the AIs the assistant can use, and the ones that can be added. */
export function AiConnections() {
  const [keys, setKeys] = useState<Provider[] | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [tab, setTab] = useState<"connected" | "discover">("connected");
  const [open, setOpen] = useState<string | null>(null);
  const [off, setOff] = useState(switchedOff);
  const [scanning, setScanning] = useState(false);
  const { ask, dialog } = useConfirm();

  const scan = () =>
    scanAgents()
      .catch(() => [] as Found[])
      .then((list) => setFound(withSaved(list)));

  useEffect(() => {
    void Promise.all(PROVIDERS.map((p) => hasKey(p.id).catch(() => false))).then((has) => setKeys(PROVIDERS.filter((_, i) => has[i]).map((p) => p.id)));
    void scan();
  }, []);

  const rescan = () => {
    setScanning(true);
    void scan().finally(() => setScanning(false));
  };

  const show = (next: typeof tab, row: string | null = null) => {
    setTab(next);
    setOpen(row);
  };

  const toggle = (source: Source) => {
    const on = !off.includes(source);
    switchOff(source, on);
    setOff(switchedOff());
  };

  const removeKey = async (provider: Provider, name: string) => {
    const ok = await ask({
      title: `Remove your ${name} API key?`,
      message: `Craftora deletes the key from this PC. To use ${name} again you'll need to paste it again (it stays in your ${name} account until you delete it there).`,
      confirmLabel: "Remove key",
      danger: true,
    });
    if (!ok) return;
    await setKey(provider, null);
    setKeys((list) => (list ?? []).filter((p) => p !== provider));
    setOpen(null);
  };

  if (!keys || !found)
    return (
      <div className="ai-conn__box">
        <p className="ai-conn__empty">Looking for AIs on this PC…</p>
      </div>
    );

  const connected: Row[] = [
    ...PROVIDERS.filter((p) => keys.includes(p.id)).map((p) => ({
      id: p.id,
      name: p.name,
      status: `API key saved · ${p.company}`,
      ready: true,
      details: (
        <button type="button" className="btn btn--secondary" onClick={() => void removeKey(p.id, p.name)}>
          Remove key
        </button>
      ),
    })),
    ...found
      .filter((f) => f.ready)
      .map((f) => ({
        id: sourceOf(f),
        name: f.name,
        status: f.kind === "program" ? "Installed · uses its own sign-in" : `Answering at ${f.detail}`,
        ready: true,
        details: (
          <>
            <span className="mono ai-conn__path">{f.detail}</span>
            {f.kind === "program" && <p className="ai-conn__muted">Craftora runs it in an empty folder and blocks its file and command tools.</p>}
          </>
        ),
      })),
  ];
  const discover: Row[] = [
    ...PROVIDERS.filter((p) => !keys.includes(p.id)).map((p) => ({
      id: p.id,
      name: p.name,
      status: "Needs an API key",
      ready: false,
      details: (
        <KeySetup
          provider={p.id}
          picker={false}
          onProvider={(next) => setOpen(next)}
          onSaved={() => {
            setKeys((list) => [...(list ?? []).filter((k) => k !== p.id), p.id]);
            show("connected", p.id);
          }}
        />
      ),
    })),
    ...found.filter((f) => !f.ready).map((f) => ({ id: sourceOf(f), name: f.name, status: f.detail, ready: false, dim: true })),
    {
      id: SERVER_ROW,
      name: "Local AI server",
      status: "Ollama, LM Studio or any address on this PC",
      ready: false,
      details: (
        <ServerForm
          onConnected={(address) => {
            const server = localServer(address);
            setFound((list) => [...(list ?? []).filter((f) => sourceOf(f) !== sourceOf(server)), server]);
            show("connected", sourceOf(server));
          }}
        />
      ),
    },
  ];
  const rows = tab === "connected" ? connected : discover;

  return (
    <div className="ai-conn">
      {dialog}
      <div className="ai-conn__head">
        <div className="segmented" role="group" aria-label="AIs">
          <button type="button" aria-pressed={tab === "connected"} onClick={() => show("connected")}>
            Connected
          </button>
          <button type="button" aria-pressed={tab === "discover"} onClick={() => show("discover")}>
            Discover and add
            <span className="ai-conn__count">{discover.length}</span>
          </button>
        </div>
        <button type="button" className="btn btn--secondary" onClick={rescan} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan again"}
        </button>
      </div>
      <ul className="ai-conn__box">
        {rows.length === 0 && <li className="ai-conn__empty">No AI connected yet. Add one under Discover and add.</li>}
        {rows.map((row) => {
          const isOpen = open === row.id && Boolean(row.details);
          const on = !off.includes(row.id as Source);
          return (
            <li key={row.id} className={row.dim ? "ai-conn__row is-dim" : "ai-conn__row"}>
              <div className="ai-conn__line">
                <button
                  type="button"
                  className="ai-conn__open"
                  aria-expanded={row.details ? isOpen : undefined}
                  disabled={!row.details}
                  onClick={() => setOpen(isOpen ? null : row.id)}
                >
                  <span className={isOpen ? "ai-conn__chevron is-open" : "ai-conn__chevron"}>
                    <Icon name="chevronRight" size={14} />
                  </span>
                  <span className="ai-conn__text">
                    <span className="ai-conn__name">{row.name}</span>
                    <span className="ai-conn__status">
                      <span className={row.ready ? "ai-conn__dot is-ready" : "ai-conn__dot"} aria-hidden="true" />
                      <span className="truncate" title={row.status}>
                        {row.status}
                      </span>
                    </span>
                  </span>
                </button>
                {tab === "connected" && (
                  <button
                    type="button"
                    role="switch"
                    className="ai-conn__switch"
                    aria-checked={on}
                    aria-label={`Show ${row.name} in the assistant`}
                    title={on ? "In the assistant's list: click to leave it out" : "Left out of the assistant's list: click to show it"}
                    onClick={() => toggle(row.id as Source)}
                  >
                    <span />
                  </button>
                )}
              </div>
              {isOpen && <div className="ai-conn__details">{row.details}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Connects a local AI server by its address, once it answers with its models. */
function ServerForm({ onConnected }: { onConnected: (address: string) => void }) {
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    const raw = address.trim();
    const target = raw.includes("://") ? raw : `http://${raw}`;
    setChecking(true);
    setError(null);
    try {
      await localModels(target);
      try {
        localStorage.setItem(LOCAL_KEY, target);
      } catch {
        /* not essential: it's listed until Craftora closes */
      }
      setAddress("");
      onConnected(target);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <form className="ai-conn__form" onSubmit={(e) => void connect(e)}>
      <label htmlFor="ai-conn-address" className="sr-only">
        Address of a local AI server
      </label>
      <input
        id="ai-conn-address"
        className="field mono"
        placeholder="e.g. localhost:11434"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "ai-conn-address-error" : undefined}
      />
      <button type="submit" className="btn btn--secondary" disabled={checking || !address.trim()}>
        {checking ? "Checking…" : "Connect"}
      </button>
      {error && (
        <p id="ai-conn-address-error" className="ai-conn__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
