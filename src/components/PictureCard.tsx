import type { MouseEvent, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import "./PictureCard.css";

/**
 * The pages' shared pieces (Home, Projects, Exports, Media library): a picture card in a grid, the tabs over it and
 * the search box beside them.
 */
export function PictureCard({
  thumb,
  tag,
  tagOpen,
  badge,
  name,
  meta,
  onOpen,
  onDoubleOpen,
  selected,
  onTick,
  actions,
  overlay,
  picked,
  onPick,
  onMenu,
  renaming,
  onRename,
}: {
  /** Usually a `<Thumb>`: it fills the picture. */
  thumb: ReactNode;
  /** "Video", "Picture", "Sound"…: first on the line under the name, so it never covers the picture. */
  tag?: string;
  /** The tag is a status in red over the picture's top-left instead ("Open now": the project open in the editor). */
  tagOpen?: boolean;
  /** Length or size, bottom-right on the picture. */
  badge?: string;
  name: string;
  meta?: ReactNode;
  /** A click (its event has Ctrl/Shift for picking several). */
  onOpen?: (e: MouseEvent) => void;
  /** A double-click (when a click only selects). */
  onDoubleOpen?: () => void;
  /** Selected (Media library): the red outline and a ticked box; `onTick` adds or drops it (the box shows on hover). */
  selected?: boolean;
  onTick?: () => void;
  /** Small buttons over the picture's top-right corner, shown on hover (`PictureAction`s). */
  actions?: ReactNode;
  /** A button always shown over the picture's bottom-left corner (a sound's Play). */
  overlay?: ReactNode;
  /** Picking several: whether this one is ticked (the card ticks instead of opening). Leave out otherwise. */
  picked?: boolean;
  onPick?: () => void;
  /** Right-click (or the keyboard's menu key): the card's menu. */
  onMenu?: (e: MouseEvent) => void;
  /** The name is a box to type a new one in: Enter or leaving it keeps it (`onRename(name)`), Escape doesn't (null). */
  renaming?: boolean;
  onRename?: (name: string | null) => void;
}) {
  const body = (
    <>
      <span className="pcard__pic">
        {thumb}
        {tag && tagOpen && <span className="pcard__tag is-open">{tag}</span>}
        {badge && <span className="pcard__badge mono">{badge}</span>}
        {picked !== undefined && (
          <span className="pcard__box" aria-hidden="true">
            {picked && <Icon name="check" size={14} />}
          </span>
        )}
      </span>
      <span className="pcard__text">
        {renaming ? (
          <input
            className="pcard__rename"
            defaultValue={name}
            aria-label="Name"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.dataset.cancel = "1";
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => onRename?.(e.currentTarget.dataset.cancel ? null : e.currentTarget.value)}
          />
        ) : (
          <span className="pcard__name truncate">{name}</span>
        )}
        {(meta || (tag && !tagOpen)) && (
          <span className="pcard__meta truncate">
            {tag && !tagOpen ? (meta ? <>{tag} · {meta}</> : tag) : meta}
          </span>
        )}
      </span>
    </>
  );
  return (
    <li
      className={picked === undefined ? (selected ? "pcard is-picked" : "pcard") : picked ? "pcard is-picking is-picked" : "pcard is-picking"}
      onContextMenu={onMenu}
    >
      {renaming ? (
        // Not a button while its name is being typed (a box inside a button can't be typed in properly).
        <div className="pcard__main">{body}</div>
      ) : picked === undefined ? (
        <button type="button" className="pcard__main" onClick={onOpen} onDoubleClick={onDoubleOpen}>
          {body}
        </button>
      ) : (
        <label className="pcard__main">
          <input type="checkbox" className="sr-only" checked={picked} onChange={onPick} />
          {body}
        </label>
      )}
      {actions && picked === undefined && <span className="pcard__actions">{actions}</span>}
      {overlay && picked === undefined && <span className="pcard__overlay">{overlay}</span>}
      {onTick && picked === undefined && (
        <button type="button" className="pcard__box pcard__tick" role="checkbox" aria-checked={Boolean(selected)} aria-label={`Select ${name}`} onClick={onTick}>
          {selected && <Icon name="check" size={14} />}
        </button>
      )}
    </li>
  );
}

/** A small square button over a card's picture. `on`: a toggle that's on (a filled star). */
export function PictureAction({ icon, label, onClick, on }: { icon: IconName; label: string; onClick: () => void; on?: boolean }) {
  return (
    <button type="button" className={on ? "pcard__action is-on" : "pcard__action"} aria-label={label} aria-pressed={on} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  );
}

/** Tabs over a grid (All / Videos / Pictures…). */
export function PageTabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="pc-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="pc-tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The search box at the end of the tabs row. */
export function PageSearch({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="pc-search">
      <Icon name="search" size={16} />
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
    </div>
  );
}
