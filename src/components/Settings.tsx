import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { checkAddress, errorText, getAdBlock, getProxy, inDesktopApp, setAdBlock, setProxy, type ProxyState } from "../lib/engine";
import { Icon } from "./Icon";
import { AiConnections } from "./AiConnections";
import { Links, UpdateControls, type LinkSettings } from "./Home";
import type { Updates } from "../lib/updates";
import type { Colour, Theme } from "../lib/theme";
import { preference, setPreference, type Preference } from "../lib/preferences";
import { setShowHiddenLists, showHiddenLists } from "./Hidden";
import "./Settings.css";

const COLOURS: [Colour, string][] = [
  ["red", "Craftora red"],
  ["lively", "Lively"],
  ["light", "Light"],
];

interface SettingsProps {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  outputDir: string;
  /** Picks the save folder; absent in the browser preview. */
  onChooseOutputDir?: () => void;
  downloadsDir: string;
  /** Picks the downloads folder; absent in the browser preview. */
  onChooseDownloadsDir?: () => void;
  /** What a new project exports as. */
  /** How many downloads and exports run at the same time. */
  maxRunning: number;
  onMaxRunning: (count: number) => void;
  /** Settings for fetching links; absent in the browser preview. */
  links?: LinkSettings;
  updates: Updates;
}

/** A section: its heading row, then its rows. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-group">
      <div className="pc-bar">
        <div className="pc-bar__start">
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

/** One setting: its name and what it does on the left, the control on the right. */
function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row__text">
        <span className="set-row__label">{label}</span>
        {hint && <div className="set-row__hint">{hint}</div>}
      </div>
      {children && <div className="set-row__control">{children}</div>}
    </div>
  );
}

/** A switch of two or more buttons; `value` is the pressed one. */
function Choice<T extends string | number | boolean>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented set-choice" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={String(id)} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Settings({ theme, onTheme, outputDir, onChooseOutputDir, downloadsDir, onChooseDownloadsDir, maxRunning, onMaxRunning, links, updates }: SettingsProps) {
  return (
    <section className="pc-page" aria-labelledby="settings-title">
      <header className="pc-head">
        <div>
          <h1 id="settings-title">Settings</h1>
          <p>How Craftora looks, where files go, and how links are fetched.</p>
        </div>
      </header>

      <Group title="Look">
        <Row label="Colour" hint="Lively gives videos, pictures and links their own colours.">
          <Choice label="Colour" options={COLOURS} value={theme.colour} onChange={(colour) => onTheme({ ...theme, colour })} />
        </Row>
        <Row label="Glass" hint="Makes the panels see-through, glowing softly with the colours of the video playing.">
          <Choice
            label="Glass"
            options={[
              [false, "Off"],
              [true, "On"],
            ]}
            value={theme.glass}
            onChange={(glass) => onTheme({ ...theme, glass })}
          />
        </Row>
      </Group>

      <Group title="Saving">
        <Row label="Exports go to" hint={<span className="mono">{outputDir}</span>}>
          {onChooseOutputDir && (
            <button type="button" className="btn btn--secondary" onClick={onChooseOutputDir}>
              <Icon name="folder" size={14} />
              Change
            </button>
          )}
        </Row>
        <Row label="Downloads go to" hint={<span className="mono">{downloadsDir}</span>}>
          {onChooseDownloadsDir && (
            <button type="button" className="btn btn--secondary" onClick={onChooseDownloadsDir}>
              <Icon name="folder" size={14} />
              Change
            </button>
          )}
        </Row>
        <Row
          label="Downloads and exports at the same time"
          hint="More at once finishes a long queue sooner but makes each job slower. Live recordings don't count."
        >
          <Choice
            label="Downloads and exports at the same time"
            options={[1, 2, 3, 4].map((n): [number, string] => [n, String(n)])}
            value={maxRunning}
            onChange={onMaxRunning}
          />
        </Row>
      </Group>

      <Preferences />

      {inDesktopApp && (
        <Group title="Assistant">
          <p className="set-row__hint">The AIs the assistant can use. Switch one off to leave it out of the assistant's list; its key stays saved.</p>
          <AiConnections />
        </Group>
      )}

      <Group title="Updates">
        <Row
          label={`Craftora${updates.version ? ` ${updates.version}` : ""}${import.meta.env.DEV ? " (development build)" : ""}`}
          hint={
            <span className="home__about">
              <UpdateControls updates={updates} />
            </span>
          }
        />
      </Group>

      {inDesktopApp && <Privacy />}

      {links && (
        <section className="set-group">
          <Links links={links} />
        </section>
      )}
    </section>
  );
}

/** Small on/off choices (lib/preferences.ts), each a two-button switch like the others here. */
function Preferences() {
  const [chosen, setChosen] = useState(() => ({
    finishSound: preference("finishSound"),
    importToTimeline: preference("importToTimeline"),
    captionsOnGpu: preference("captionsOnGpu"),
    showCat: preference("showCat"),
  }));
  const choose = (name: Preference, on: boolean) => {
    setPreference(name, on);
    setChosen((c) => ({ ...c, [name]: on }));
  };
  // The Export picture window keeps its own two (imageEnhance, imageAi).
  const rows: [Exclude<Preference, "imageEnhance" | "imageAi">, string, string, [string, string]][] = [
    ["finishSound", "Sound when a download or export finishes", "Plays whether Craftora is in front or not.", ["On", "Off"]],
    ["importToTimeline", "Files imported from this PC", "Just import: they wait under In this project. Links you fetch always go onto the timeline.", ["Add to timeline", "Just import"]],
    ["captionsOnGpu", "Make captions with", "Graphics card: faster, with a more accurate speech model (190 MB, downloaded once). A PC without a graphics card of its own uses the processor.", ["Graphics card", "Processor"]],
    ["showCat", "The cat in the GIFs tab", "Off: no cat and no speech bubble; an empty GIFs tab just says so.", ["Show", "Hide"]],
  ];
  return (
    <Group title="Preferences">
      {rows.map(([name, label, hint, [yes, no]]) => (
        <Row key={name} label={label} hint={hint}>
          <Choice
            label={label}
            options={[
              [true, yes],
              [false, no],
            ]}
            value={chosen[name]}
            onChange={(on) => choose(name, on)}
          />
        </Row>
      ))}
    </Group>
  );
}

/** A proxy for every connection Craftora makes, and a check of the address websites see. */
function Privacy() {
  const [showHidden, setShowHidden] = useState(showHiddenLists);
  const chooseShowHidden = (on: boolean) => {
    setShowHidden(on);
    setShowHiddenLists(on);
  };
  const [adBlock, setAdBlockState] = useState<boolean | null>(null);
  const chooseAdBlock = (on: boolean) => {
    setAdBlockState(on);
    void setAdBlock(on).catch((err) => setMessage(errorText(err)));
  };
  const [state, setState] = useState<ProxyState | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    void getAdBlock().then(setAdBlockState).catch(() => {});
    void getProxy().then((s) => {
      setState(s);
      setDraft(s.proxy ?? "");
    });
  }, []);
  const save = async (proxy: string | null) => {
    try {
      const next = await setProxy(proxy);
      setState(next);
      setDraft(next.proxy ?? "");
      setMessage(next.proxy ? `Saved. Connections now go through ${next.proxy}.` : "Proxy off. Connections go directly.");
    } catch (err) {
      setMessage(errorText(err));
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(draft.trim() || null);
  };
  const check = async () => {
    setChecking(true);
    try {
      setMessage(`Websites see your connection as ${await checkAddress()}.`);
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setChecking(false);
    }
  };
  return (
    <Group title="Privacy">
      <Row
        label="Hidden items"
        hint="Things you hide on Projects, Media library, Downloads, History and Exports go into a folded Hidden list at the bottom of each page. Choose Don't show and those lists disappear completely, so nobody using this PC can open them. Nothing is deleted: choose Show to find and unhide them again."
      >
        <Choice
          label="Hidden items"
          options={[
            [true, "Show"],
            [false, "Don't show"],
          ]}
          value={showHidden}
          onChange={chooseShowHidden}
        />
      </Row>
      {adBlock !== null && (
        <Row
          label="Ads and trackers"
          hint="In the sign-in window, where you browse websites: Microsoft Edge's own blocking of the ad and tracking networks it knows. If a site's login or video player stops working, try Don't block. Pop-ups, downloads and links that start other programs stay blocked either way, to keep malware out. A change applies to pages you open from then on."
        >
          <Choice
            label="Ads and trackers"
            options={[
              [true, "Block"],
              [false, "Don't block"],
            ]}
            value={adBlock}
            onChange={chooseAdBlock}
          />
        </Row>
      )}
      {state && (
        <div className="set-row set-row--stack">
          <div className="set-row__text">
            <label className="set-row__label" htmlFor="proxy">
              Proxy
            </label>
            <p className="set-row__hint">
              Fetching, downloads, previews, pictures, captions and the AI assistant go through this proxy, so websites see its
              address instead of yours. Only http:// proxies: FFmpeg can't use SOCKS ones. A VPN app needs nothing here, it already
              covers your whole PC. <strong>Check</strong> asks Cloudflare which address it sees.
            </p>
          </div>
          <form className="set-proxy" onSubmit={submit}>
            <input
              id="proxy"
              className="field mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="http://127.0.0.1:8080"
              spellCheck={false}
            />
            <button type="submit" className="btn btn--secondary" disabled={draft.trim() === (state.proxy ?? "")}>
              Save
            </button>
            {state.proxy && (
              <button type="button" className="btn btn--ghost" onClick={() => void save(null)}>
                Turn off
              </button>
            )}
            <button type="button" className="btn btn--ghost" disabled={checking} onClick={() => void check()}>
              <Icon name="shield" size={14} />
              {checking ? "Checking…" : "Check"}
            </button>
          </form>
          {message && <p className="set-row__hint">{message}</p>}
          {state.proxy !== state.window && (
            <div className="set-proxy">
              <span className="set-row__hint">Restart Craftora so its own window (signing in, some previews and pictures) uses this too.</span>
              <button type="button" className="btn btn--secondary" onClick={() => void relaunch()}>
                Restart now
              </button>
            </div>
          )}
        </div>
      )}
    </Group>
  );
}
