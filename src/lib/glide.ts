import { useEffect } from "react";

/**
 * Mouse-wheel scrolling that glides, like a phone: each notch moves a target and the list eases
 * towards it, so it carries on a moment and settles softly. Touchpads glide already and are left
 * alone, as are Ctrl/Shift wheels (zoom, sideways), the timeline, and lists at their end.
 */
export function useGlideScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // `at`: where the glide last put the list, to notice when something else moves it.
    const glides = new WeakMap<HTMLElement, { target: number; running: boolean; at: number }>();
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      // A wheel notch is about 100; a touchpad sends many small steps of its own.
      if (e.deltaMode !== 0 || Math.abs(e.deltaY) < 50 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const box = scroller(e.target, Math.sign(e.deltaY));
      if (!box) return;
      e.preventDefault();
      const glide = glides.get(box) ?? { target: box.scrollTop, running: false, at: box.scrollTop };
      // Moved some other way since (the scrollbar, a jump to a line): start from where it is.
      if (!glide.running) glide.target = box.scrollTop;
      glide.target = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, glide.target + e.deltaY));
      glides.set(box, glide);
      if (glide.running) return;
      glide.running = true;
      glide.at = box.scrollTop;
      const step = () => {
        const left = glide.target - box.scrollTop;
        // Done, gone, or moved some other way meanwhile (a touchpad, the scrollbar, the transcript
        // following the line): it stops there instead of pulling the list back.
        if (Math.abs(left) < 1 || !box.isConnected || Math.abs(box.scrollTop - glide.at) > 2) {
          glide.running = false;
          return;
        }
        // At least a pixel a frame: scroll positions are whole pixels (at 110% zoom, too), and
        // smaller steps rounded away to nothing, so a glide never ended and held the list still.
        const before = box.scrollTop;
        box.scrollTop += Math.sign(left) * Math.max(1, Math.abs(left) * 0.18);
        glide.at = box.scrollTop;
        if (box.scrollTop === before) {
          glide.running = false;
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
}

/** The nearest list under the pointer that can still scroll that way. */
function scroller(target: EventTarget | null, direction: number): HTMLElement | null {
  // From any element: the pointer is often over an icon's drawing.
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.classList.contains("tl")) return null;
    if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    const room = direction > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
    return room > 1 ? el : null;
  }
  return null;
}
