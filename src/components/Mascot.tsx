import { useEffect, useRef, useState } from "react";
import { createAnimatable, createScope, createTimeline, createTimer, utils } from "animejs";
import "@fontsource/pixelify-sans/latin-400.css";
import "./Mascot.css";

/**
 * Craftora's cat as a cute pixel sprite for empty states. Fur and collar are theme tokens (it follows Craftora red,
 * Lively, Light and glass); the pinks and the eyes stay the same everywhere. The eyes look toward the pointer while it's
 * inside the panel the cat sits in, a whole pixel at a time, and it blinks now and then (not with reduced motion).
 * It says `say` in a pixel speech bubble: typed out once with its mouth moving, then a happy squint. `mood` sets its face
 * afterwards: calm, excited (^ ^ eyes and an open smile) or shy (a wink).
 */
// 16 × 13 pixels: F fur, P pink (inner ears, cheeks, nose), C collar. Eyes and mouth are drawn on top (EYES, MOUTHS).
const ART = [
  ".FF..........FF.",
  ".FPF........FPF.",
  ".FPPFFFFFFFFPPF.",
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
  "FFFFFFFFFFFFFFFF",
  "FPPFFFFPPFFFFPPF",
  "FFFFFFFFFFFFFFFF",
  ".FFFFFFFFFFFFFF.",
  "..FFFFFFFFFFFF..",
  "...CCCCCCCCCC...",
];
const CLASS: Record<string, string> = { F: "mascot__fur", P: "mascot__pink", C: "mascot__collar" };
/** One rect per run of the same pixel kind in a row. */
const RUNS = ART.flatMap((row, y) => {
  const runs: { x: number; y: number; w: number; kind: string }[] = [];
  for (let x = 0; x < row.length; ) {
    let end = x;
    while (end < row.length && row[end] === row[x]) end++;
    if (row[x] !== ".") runs.push({ x, y, w: end - x, kind: row[x] });
    x = end;
  }
  return runs;
});
/** Each eye: 2 × 3 dark pixels with a white shine at its top right; the left edge of each. */
const EYES = [3, 11];

type Phase = "talking" | "happy" | "idle";
export type MascotMood = "calm" | "excited" | "shy";
const stillMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Mascot({ say, mood = "calm" }: { say: string; mood?: MascotMood }) {
  const root = useRef<SVGSVGElement>(null);
  const [blinking, setBlinking] = useState(false);
  const [shown, setShown] = useState(() => (stillMotion() ? say.length : 0));
  const [phase, setPhase] = useState<Phase>(() => (stillMotion() ? "idle" : "talking"));
  // Typed out once per line, a letter every 55 ms; then a happy squint for a moment.
  useEffect(() => {
    if (stillMotion()) return;
    setShown(0);
    setPhase("talking");
    let squint = 0;
    const typing = createTimer({
      delay: 350,
      duration: say.length * 55,
      onUpdate: (t) => setShown(Math.ceil(t.progress * say.length)),
      onComplete: () => {
        setShown(say.length);
        setPhase("happy");
        squint = window.setTimeout(() => setPhase("idle"), 900);
      },
    });
    return () => {
      typing.revert();
      window.clearTimeout(squint);
    };
  }, [say]);
  // Talking: the mouth opens on most letters and closes on spaces and every third one.
  const talking = phase === "talking" && shown > 0 && shown % 3 !== 0 && say[shown - 1] !== " ";
  const open = talking || (phase === "idle" && mood === "excited");
  useEffect(() => {
    const svg = root.current;
    const area = svg?.closest<HTMLElement>(".gif-panel");
    if (!svg || !area) return;
    // The eyes move in whole pixels (1 svg unit), easing between them like a sprite stepping. translateX/Y, not x/y:
    // on SVG shapes those would set their own attributes.
    const look = createAnimatable(svg.querySelectorAll(".mascot__eye"), { translateX: 140, translateY: 140, ease: "out(3)", modifier: utils.round(0) });
    const follow = (e: PointerEvent) => {
      const box = svg.getBoundingClientRect();
      const dx = e.clientX - (box.left + box.width / 2);
      const dy = e.clientY - (box.top + box.height * 0.45);
      const step = (d: number, reach: number) => (Math.abs(d) < reach ? 0 : Math.sign(d));
      look.translateX(step(dx, box.width * 0.35));
      look.translateY(step(dy, box.height * 0.4));
    };
    const rest = () => {
      look.translateX(0);
      look.translateY(0);
    };
    area.addEventListener("pointermove", follow);
    area.addEventListener("pointerleave", rest);
    const scope = createScope({ mediaQueries: { reduce: "(prefers-reduced-motion: reduce)" } }).add((self) => {
      if (self?.matches.reduce) return;
      createTimeline({ loop: true, loopDelay: 4200, delay: 1800 })
        .call(() => setBlinking(true))
        .call(() => setBlinking(false), 160);
    });
    return () => {
      area.removeEventListener("pointermove", follow);
      area.removeEventListener("pointerleave", rest);
      look.revert();
      scope.revert();
    };
  }, []);
  return (
    <div className="mascot-say">
      <p className="mascot-bubble">
        <span aria-hidden="true">{say.slice(0, shown)}</span>
        {/* The rest takes its space already, so the bubble doesn't grow while typing. */}
        <span aria-hidden="true" className="mascot-bubble__rest">{say.slice(shown)}</span>
        <span className="sr-only">{say}</span>
        <svg className="mascot-bubble__tail" viewBox="0 0 6 4" shapeRendering="crispEdges" aria-hidden="true">
          <rect className="mascot-bubble__fill" x={0} y={0} width={6} height={1} />
          <rect className="mascot-bubble__line" x={0} y={1} width={1} height={1} />
          <rect className="mascot-bubble__fill" x={1} y={1} width={4} height={1} />
          <rect className="mascot-bubble__line" x={5} y={1} width={1} height={1} />
          <rect className="mascot-bubble__line" x={1} y={2} width={1} height={1} />
          <rect className="mascot-bubble__fill" x={2} y={2} width={2} height={1} />
          <rect className="mascot-bubble__line" x={4} y={2} width={1} height={1} />
          <rect className="mascot-bubble__line" x={2} y={3} width={2} height={1} />
        </svg>
      </p>
      <svg ref={root} className={["mascot", blinking && "is-blinking", (phase === "happy" || (phase === "idle" && mood === "excited")) && "is-happy", phase === "idle" && mood === "shy" && "is-shy"].filter(Boolean).join(" ")} viewBox="0 0 16 13" shapeRendering="crispEdges" aria-hidden="true">
        {RUNS.map((r) => (
          <rect key={`${r.x}-${r.y}`} className={CLASS[r.kind]} x={r.x} y={r.y} width={r.w} height={1} />
        ))}
        {EYES.map((x) => (
          <g key={x} className={x === EYES[1] ? "mascot__eye is-right" : "mascot__eye"}>
            <rect className="mascot__eye-dark" x={x} y={4} width={2} height={3} />
            <rect className="mascot__shine" x={x + 1} y={4} width={1} height={1} />
            {/* Closed: a happy line along the bottom of the eye. */}
            <rect className="mascot__lid" x={x} y={6} width={2} height={1} />
          </g>
        ))}
        {/* Happy squint: a ^ over each eye. */}
        {[2, 10].map((x) => (
          <g key={x} className="mascot__happy">
            <rect x={x} y={5} width={1} height={1} />
            <rect x={x + 1} y={4} width={2} height={1} />
            <rect x={x + 3} y={5} width={1} height={1} />
          </g>
        ))}
        {open ? (
          <g>
            <rect className="mascot__mouth" x={7} y={9} width={2} height={1} />
            <rect className="mascot__tongue" x={7} y={10} width={2} height={1} />
          </g>
        ) : (
          <g className="mascot__mouth">
            <rect x={6} y={9} width={1} height={1} />
            <rect x={9} y={9} width={1} height={1} />
            <rect x={7} y={10} width={2} height={1} />
          </g>
        )}
      </svg>
    </div>
  );
}
