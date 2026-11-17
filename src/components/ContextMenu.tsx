import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import "./ContextMenu.css";

export type MenuItem = { label: string; icon?: IconName; onClick: () => void; danger?: boolean } | "sep";

/** A menu that just opened, moved up and left by as much as it would run out of the window (a ref callback). */
function keepInside(el: HTMLElement | null) {
  if (!el) return;
  el.style.translate = "";
  const r = el.getBoundingClientRect();
  const dx = Math.max(8 - r.left, Math.min(0, window.innerWidth - 8 - r.right));
  const dy = Math.max(8 - r.top, Math.min(0, window.innerHeight - 8 - r.bottom));
  el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}

/**
 * A right-click menu at (x, y), like the timeline's clip menu: arrows move through it, Escape or a click anywhere
 * else closes it, and picking an item closes it first.
 */
export function ContextMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: MenuItem[]; onClose: () => void }) {
  return createPortal(
    <>
      <div
        className="ctx-menu__catcher"
        onPointerDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={(el) => {
          keepInside(el);
          el?.querySelector<HTMLButtonElement>("button")?.focus();
        }}
        className="ctx-menu"
        role="menu"
        aria-label={label}
        style={{ left: x, top: y }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
          }
        }}
      >
        {items.map((item, i) =>
          item === "sep" ? (
            <hr key={i} />
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "is-danger" : undefined}
              onClick={() => {
                onClose();
                item.onClick();
              }}
            >
              {item.icon && <Icon name={item.icon} size={13} />}
              {item.label}
            </button>
          ),
        )}
      </div>
    </>,
    document.body,
  );
}
