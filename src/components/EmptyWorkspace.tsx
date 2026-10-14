import { Icon } from "./Icon";
import "./EmptyWorkspace.css";

interface EmptyWorkspaceProps {
  fetching: boolean;
  onTrySample: () => void;
  /** Opens a file from this PC; absent in the browser preview. */
  onOpenFile?: () => void;
}

/** First launch, before any link or file has been opened. */
export function EmptyWorkspace({ fetching, onTrySample, onOpenFile }: EmptyWorkspaceProps) {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <div className="empty__body">
        <h1 id="empty-title">{onOpenFile ? "Paste a link or open a file" : "Paste a link to start"}</h1>
        <p>
          Put a video or audio link in the field above and press <strong>Fetch</strong>
          {onOpenFile && (
            <>
              , or open a file that's already on this PC. Files work without internet; drop one anywhere on the
              window
            </>
          )}
          . Then pick the part you want and the format to save it in.
        </p>
        <ol className="empty__steps">
          <li>
            <Icon name="link" size={15} />
            <span>Fetch a link or open a file</span>
          </li>
          <li>
            <Icon name="scissors" size={15} />
            <span>Set In and Out</span>
          </li>
          <li>
            <Icon name="folder" size={15} />
            <span>Add to queue; files land in Videos\Craftora</span>
          </li>
        </ol>
        <div className="empty__actions">
          {onOpenFile && (
            <button type="button" className="btn btn--secondary" onClick={onOpenFile} disabled={fetching}>
              <Icon name="folder" size={14} />
              Open a file
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onTrySample} disabled={fetching}>
            {fetching ? "Opening…" : "Try a sample: Big Buck Bunny"}
          </button>
        </div>
      </div>
    </section>
  );
}
