import { useEffect, useState, type FormEvent } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { checkAddress, errorText, getAdBlock, getProxy, inDesktopApp, setAdBlock, setProxy, type ProxyState } from "../lib/engine";
import { Icon } from "./Icon";
import { Links, UpdateControls, type LinkSettings } from "./Home";
import type { Updates } from "../lib/updates";
import type { Theme } from "../lib/theme";
import { setShowHiddenLists, showHiddenLists } from "./Hidden";
import "./Library.css";

const THEMES: [Theme, string][] = [
  ["classic", "Classic"],
  ["dark", "Dark glass"],
  ["light", "Light glass"],
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

export function Settings({ theme, onTheme, outputDir, onChooseOutputDir, downloadsDir, onChooseDownloadsDir, maxRunning, onMaxRunning, links, updates }: SettingsProps) {
  return (
    <section className="library" aria-labelledby="settings-title">
      <header className="library__head">
        <h1 id="settings-title">Settings</h1>
        <p>How Craftora looks, where files go, and how links are fetched.</p>
      </header>

      <div className="library__group">
        <h2 className="section-label">Theme</h2>
        <div className="segmented library__choice" role="group" aria-label="Theme">
          {THEMES.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={theme === id} onClick={() => onTheme(id)}>
              {label}
            </button>
          ))}
        </div>
        <p className="library__muted">
          Classic is Craftora's flat dark look. The glass themes are see-through and glow softly with the colours of the video
          playing.
        </p>
      </div>

      <div className="library__group">
        <h2 className="section-label">Saving</h2>
        <div className="library__save">
          <span>Exports go to</span>
          <span className="mono truncate">{outputDir}</span>
          {onChooseOutputDir && (
            <button type="button" className="btn btn--secondary" onClick={onChooseOutputDir}>
              <Icon name="folder" size={14} />
              Change
            </button>
          )}
        </div>
        <div className="library__save">
          <span>Downloads go to</span>
          <span className="mono truncate">{downloadsDir}</span>
          {onChooseDownloadsDir && (
            <button type="button" className="btn btn--secondary" onClick={onChooseDownloadsDir}>
              <Icon name="folder" size={14} />
              Change
            </button>
          )}
        </div>
      </div>

      <div className="library__group">
        <h2 className="section-label">Downloads and exports at the same time</h2>
        <div className="segmented library__choice" role="group" aria-label="Downloads and exports at the same time">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" aria-pressed={maxRunning === n} onClick={() => onMaxRunning(n)}>
              {n}
            </button>
          ))}
        </div>
        <p className="library__muted">More at once finishes a long queue sooner but makes each job slower. Live recordings don't count.</p>
      </div>



      <div className="library__group">
        <h2 className="section-label">Updates</h2>
        <p className="library__muted">
          Craftora{updates.version ? ` ${updates.version}` : ""}
          {import.meta.env.DEV ? " (development build)" : ""}
        </p>
        <div className="home__about">
          <UpdateControls updates={updates} />
        </div>
      </div>

      {inDesktopApp && <Privacy />}

      {links && (
        <div className="library__group">
          <Links links={links} />
        </div>
      )}
    </section>
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
    <div className="library__group">
      <h2 className="section-label">Privacy</h2>
      <div className="segmented library__choice" role="group" aria-label="Hidden items">
        <button type="button" aria-pressed={showHidden} onClick={() => chooseShowHidden(true)}>
          Show hidden items
        </button>
        <button type="button" aria-pressed={!showHidden} onClick={() => chooseShowHidden(false)}>
          Don't show them
        </button>
      </div>
      <p className="library__muted">
        Things you hide on Projects, Media library, Downloads, History and Exports go into a folded Hidden list at the bottom of each
        page. Choose Don't show them and those lists disappear completely, so nobody using this PC can open them. Nothing is deleted:
        choose Show hidden items to find and unhide them again.
      </p>
      {adBlock !== null && (
        <>
          <div className="segmented library__choice" role="group" aria-label="Ads and trackers">
            <button type="button" aria-pressed={adBlock} onClick={() => chooseAdBlock(true)}>
              Block ads and trackers
            </button>
            <button type="button" aria-pressed={!adBlock} onClick={() => chooseAdBlock(false)}>
              Don't block
            </button>
          </div>
          <p className="library__muted">
            In the sign-in window, where you browse websites: Microsoft Edge's own blocking of the ad and tracking networks it
            knows. If a site's login or video player stops working, try Don't block. Pop-ups, downloads and links that start other
            programs stay blocked either way, to keep malware out. A change applies to pages you open from then on.
          </p>
        </>
      )}
      {state && (
        <>
          <form className="library__save" onSubmit={submit}>
            <label htmlFor="proxy">Proxy</label>
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
          <p className="library__muted">
            Fetching, downloads, previews, pictures, captions and the AI assistant go through this proxy, so websites see its
            address instead of yours. Only http:// proxies: FFmpeg can't use SOCKS ones. A VPN app needs nothing here, it already
            covers your whole PC. <strong>Check</strong> asks Cloudflare which address it sees.
          </p>
          {message && <p className="library__muted">{message}</p>}
          {state.proxy !== state.window && (
            <p className="library__save">
              <span>Restart Craftora so its own window (signing in, some previews and pictures) uses this too.</span>
              <button type="button" className="btn btn--secondary" onClick={() => void relaunch()}>
                Restart now
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
