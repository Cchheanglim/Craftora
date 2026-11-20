import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import "./ContextMenu.css";

/** `items`: a sub-menu that opens beside it (pointing at it, or Right arrow), instead of `onClick`. */
export type MenuItem = { label: string; icon?: IconName; onClick?: () => void; danger?: boolean; items?: MenuItem[] } | "sep";

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
            const menu = (e.target as HTMLElement).closest(".ctx-menu") ?? e.currentTarget;
            const buttons = [...menu.querySelectorAll<HTMLButtonElement>(":scope > button, :scope > .ctx-menu__sub > button")];
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
          }
        }}
      >
        <MenuItems items={items} onClose={onClose} />
      </div>
    </>,
    document.body,
  );
}

function MenuItems({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return items.map((item, i) =>
    item === "sep" ? (
      <hr key={i} />
    ) : item.items ? (
      <span key={item.label} className="ctx-menu__sub" onPointerEnter={(e) => flipIfOutside(e.currentTarget)}>
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "Enter") {
              e.preventDefault();
              flipIfOutside(e.currentTarget.parentElement!);
              e.currentTarget.nextElementSibling?.querySelector<HTMLButtonElement>("button")?.focus();
            }
          }}
        >
          {item.icon && <Icon name={item.icon} size={13} />}
          {item.label}
          <Icon name="chevronRight" size={12} className="ctx-menu__more" />
        </button>
        <div
          className="ctx-menu ctx-menu--sub"
          role="menu"
          aria-label={item.label}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.previousElementSibling instanceof HTMLElement && e.currentTarget.previousElementSibling.focus();
            }
          }}
        >
          <MenuItems items={item.items} onClose={onClose} />
        </div>
      </span>
    ) : (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        className={item.danger ? "is-danger" : undefined}
        onClick={() => {
          onClose();
          item.onClick?.();
        }}
      >
        {item.icon && <Icon name={item.icon} size={13} />}
        {item.label}
      </button>
    ),
  );
}

/** A sub-menu opens on the left instead when the right side has no room for it. */
function flipIfOutside(sub: HTMLElement) {
  const width = sub.querySelector<HTMLElement>(".ctx-menu--sub")?.offsetWidth || 200;
  sub.classList.toggle("is-left", sub.getBoundingClientRect().right + width + 8 > window.innerWidth);
}
