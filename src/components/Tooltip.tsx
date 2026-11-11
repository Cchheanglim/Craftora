import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./Tooltip.css";

/** How long the pointer rests on something before its tip shows, in ms. */
const DELAY = 450;
/** Space between the thing and its tip, and the least space kept from the window's edges. */
const GAP = 6;

/**
 * Every `title` in the app, shown in Craftora's own look instead of the white Windows tooltip. On hover the title moves
 * to `data-tip` (so Windows doesn't draw its own) until the pointer leaves, and the tip shows under the thing (over it near the bottom edge).
 * A thing with no other name gets the title as its `aria-label`, so screen readers still read it. The tip is a popover,
 * so it shows over open dialogs too.
 */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let target: Element | null = null;
    // Watches the hovered thing's title: a button that turns Play into Pause under the pointer gets its new tip.
    const watch = new MutationObserver(() => {
      if (!target) return;
      const text = take(target);
      setTip((t) => (t && text && text !== t.text ? { ...t, text } : t));
    });
    const hide = () => {
      window.clearTimeout(timer);
      setTip(null);
    };
    // The pointer left `target`: its title goes back, so the app's later changes to it (or its removal) still count.
    const release = () => {
      hide();
      watch.disconnect();
      if (target) give(target);
      target = null;
    };
    const over = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest("[title], [data-tip]") : null;
      if (el === target) return;
      release();
      if (!el || !take(el)) return;
      target = el;
      watch.observe(el, { attributes: true, attributeFilter: ["title"] });
      timer = window.setTimeout(() => {
        const text = el.getAttribute("data-tip");
        if (target === el && el.isConnected && text) setTip({ text, rect: el.getBoundingClientRect() });
      }, DELAY);
    };
    const out = (e: PointerEvent) => {
      if (!e.relatedTarget) release();
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    // Like the Windows tooltip: gone on a press, a key, a scroll or leaving the window. The title stays taken until the
    // pointer leaves the thing, or Windows would show its own tip on the next move.
    for (const name of ["pointerdown", "keydown", "wheel", "scroll"]) window.addEventListener(name, hide, true);
    window.addEventListener("blur", hide);
    return () => {
      release();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      for (const name of ["pointerdown", "keydown", "wheel", "scroll"]) window.removeEventListener(name, hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Placed once its size is known: centred under the thing, kept inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    if (!el.matches(":popover-open")) el.showPopover();
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(GAP, tip.rect.left + tip.rect.width / 2 - width / 2), window.innerWidth - width - GAP);
    const below = tip.rect.bottom + GAP;
    el.style.left = `${left}px`;
    el.style.top = `${below + height <= window.innerHeight - GAP ? below : Math.max(GAP, tip.rect.top - height - GAP)}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} className="tooltip" popover="manual" role="tooltip">
      {tip.text}
    </div>
  );
}

/** Moves `el`'s title (if it has one) to `data-tip`; its tip text. */
function take(el: Element): string | null {
  const title = el.getAttribute("title");
  if (title) {
    el.removeAttribute("title");
    el.setAttribute("data-tip", title);
    // Named by its title alone (an icon button): keep that name, also when the title changes.
    const named = el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || el.textContent?.trim();
    if (!named || el.hasAttribute("data-tip-name")) {
      el.setAttribute("aria-label", title);
      el.setAttribute("data-tip-name", "");
    }
  }
  return el.getAttribute("data-tip");
}

/** Undoes `take`: the tip goes back to being `el`'s title. */
function give(el: Element) {
  const tip = el.getAttribute("data-tip");
  if (tip === null) return;
  if (!el.hasAttribute("title")) el.setAttribute("title", tip);
  el.removeAttribute("data-tip");
  if (el.hasAttribute("data-tip-name")) {
    el.removeAttribute("aria-label");
    el.removeAttribute("data-tip-name");
  }
}
