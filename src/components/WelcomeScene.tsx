import { useEffect, useRef } from "react";

const SAYS = "Fetch everything, meowwwww";
/** When the words start (ms after the guide opens; just after the bubble pops, see WelcomeDialog.css) and how fast they come. */
const TYPE_FROM = 2150;
const TYPE_MS = 45;

/**
 * The welcome guide's picture: Craftora's app icon comes alive. The cat rises into its tile,
 * draws the play button with the pen in its mouth, and says hello. The motion is CSS
 * (WelcomeDialog.css); this only types the words and makes the cat wink as it meows.
 * With reduced motion it's the finished picture.
 */
export function WelcomeScene() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    const words = svg?.querySelector<SVGTextElement>(".welcome__words");
    const box = svg?.querySelector(".welcome__bubble-box");
    if (!svg || !words || !box) return;
    // The bubble fits its words.
    words.textContent = SAYS;
    box.setAttribute("d", bubble(words.getComputedTextLength() + 32));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    words.textContent = "";
    const timers: number[] = [];
    const at = (ms: number, then: () => void) => timers.push(window.setTimeout(then, ms));
    for (let i = 1; i <= SAYS.length; i++) at(TYPE_FROM + i * TYPE_MS, () => (words.textContent = SAYS.slice(0, i)));
    const done = TYPE_FROM + SAYS.length * TYPE_MS;
    at(TYPE_FROM + SAYS.indexOf("meow") * TYPE_MS, () => svg.classList.add("is-winking", "is-talking"));
    at(done + 450, () => svg.classList.remove("is-talking"));
    at(done + 700, () => svg.classList.remove("is-winking"));
    return () => timers.forEach(window.clearTimeout);
  }, []);

  return (
    <svg ref={ref} className="welcome__scene" viewBox="0 0 520 200" aria-hidden="true">
      <defs>
        <linearGradient id="welcome-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5068" />
          <stop offset="1" stopColor="#c40a29" />
        </linearGradient>
        <linearGradient id="welcome-fur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c2c33" />
          <stop offset="1" stopColor="#09090b" />
        </linearGradient>
        <linearGradient id="welcome-pen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9cbd2" />
        </linearGradient>
        <linearGradient id="welcome-rim-light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".4" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".06" />
          <stop offset="1" stopColor="#fff" stopOpacity=".2" />
        </linearGradient>
        <clipPath id="welcome-clip">
          <path d={TILE} />
        </clipPath>
        <filter id="welcome-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="28" />
        </filter>
        <filter id="welcome-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="b" />
          <feComposite in="SourceAlpha" in2="b" operator="arithmetic" k2="1" k3="-1" result="edge" />
          <feFlood floodColor="#ff3a55" />
          <feComposite in2="edge" operator="in" result="glow" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="glow" />
          </feMerge>
        </filter>
        <filter id="welcome-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#5a0010" floodOpacity=".35" />
        </filter>
      </defs>

      {/* The app icon (icon-design/craftora-icon.svg), its parts moving on their own. */}
      <g className="welcome__tile">
        <g transform="translate(10 10) scale(0.17578)">
          <path d={TILE} fill="url(#welcome-tile)" />
          <g clipPath="url(#welcome-clip)">
            <circle cx="420" cy="560" r="300" fill="#ff8394" opacity=".35" filter="url(#welcome-blur)" />
            <g className="welcome__cat">
              <g className="welcome__breath">
                <g transform="translate(-10 14)">
                  <g filter="url(#welcome-shadow)">
                    <g fill="url(#welcome-fur)" filter="url(#welcome-glow)">
                      <path d="M 100 1060 C 120 900 270 830 460 830 C 650 830 800 900 820 1060 Z" />
                      <path className="welcome__ear-left" d="M 196 600 L 214 350 Q 220 316 248 334 L 400 462 Z" />
                      <path className="welcome__ear-right" d="M 724 600 L 706 350 Q 700 316 672 334 L 520 462 Z" />
                      <path d="M 160 690 C 160 530 280 430 460 430 C 640 430 760 530 760 690 C 760 810 640 890 460 890 C 280 890 160 810 160 690 Z" />
                    </g>
                  </g>
                  <path className="welcome__ear-left" d="M 232 548 L 244 386 L 352 478 Z" fill="#ff8fa1" opacity=".85" />
                  <path className="welcome__ear-right" d="M 688 548 L 676 386 L 568 478 Z" fill="#ff8fa1" opacity=".85" />
                  <path d="M 236 868 Q 460 964 684 868 L 698 920 Q 460 1016 222 920 Z" fill="#ff2b47" />
                  <path d="M 236 868 Q 460 964 684 868" fill="none" stroke="#ff8a9a" strokeWidth="8" opacity=".6" />
                  <circle cx="460" cy="990" r="32" fill="#ffc93c" />
                  <circle cx="450" cy="980" r="9" fill="#fff" opacity=".7" />
                  {/* Both eyes open here (the icon's right one is a wink); it winks once as it meows. */}
                  <g className="welcome__eye">
                    <ellipse cx="358" cy="650" rx="50" ry="58" fill="#ffc93c" />
                    <ellipse cx="358" cy="656" rx="15" ry="42" fill="#0b0b0d" />
                    <circle cx="374" cy="628" r="13" fill="#fff" />
                  </g>
                  <g className="welcome__eye welcome__eye--right">
                    <ellipse cx="562" cy="650" rx="50" ry="58" fill="#ffc93c" />
                    <ellipse cx="562" cy="656" rx="15" ry="42" fill="#0b0b0d" />
                    <circle cx="578" cy="628" r="13" fill="#fff" />
                  </g>
                  <path className="welcome__wink" d="M 518 660 Q 562 616 606 660" fill="none" stroke="#ffc93c" strokeWidth="22" strokeLinecap="round" />
                  <path d="M 442 716 L 478 716 L 460 736 Z" fill="#ff8fa1" />
                  <g className="welcome__pen">
                    <g transform="rotate(-9 460 786)">
                      <rect x="226" y="766" width="440" height="40" rx="20" fill="url(#welcome-pen)" />
                      <rect x="226" y="766" width="84" height="40" rx="20" fill="#ff2b47" />
                      <rect x="320" y="754" width="130" height="14" rx="7" fill="#9ea2ad" />
                      <path d="M 660 766 L 736 786 L 660 806 Z" fill="#9ea2ad" />
                      <path d="M 716 781 L 736 786 L 716 791 Z" fill="#1b1b1f" />
                    </g>
                  </g>
                  <path d="M 424 748 L 442 748 L 433 776 Z" fill="#fff" />
                  <path d="M 478 744 L 496 744 L 487 770 Z" fill="#fff" />
                  <path d="M 400 742 Q 430 762 460 742 Q 490 762 520 742" fill="none" stroke="#4a4a54" strokeWidth="10" strokeLinecap="round" />
                </g>
              </g>
            </g>
            {/* What it draws: the play button, then a twinkle. */}
            <path className="welcome__play" pathLength={1} d="M 756 168 L 852 226 L 756 284 Z" fill="#fff" stroke="#fff" strokeWidth="28" strokeLinejoin="round" />
            <path className="welcome__twinkle" d="M 900 300 Q 906 330 936 336 Q 906 342 900 372 Q 894 342 864 336 Q 894 330 900 300 Z" fill="#fff" opacity=".8" />
            <path d={TILE} fill="none" stroke="url(#welcome-rim-light)" strokeWidth="26" />
          </g>
        </g>
      </g>

      {/* What it says. */}
      <g className="welcome__bubble">
        <path className="welcome__bubble-box" d={bubble(270)} />
        <text className="welcome__words" x="226" y="122">
          {SAYS}
        </text>
      </g>
    </svg>
  );
}

/** The speech bubble, `width` wide: a rounded box with its tail pointing at the cat, as one outline. */
const bubble = (width: number) =>
  `M 220 92 H ${200 + width} A 10 10 0 0 1 ${210 + width} 102 V 130 A 10 10 0 0 1 ${200 + width} 140 H 220 A 10 10 0 0 1 210 130 L 197 120 L 210 110 V 102 A 10 10 0 0 1 220 92 Z`;

/** The icon's rounded square, in its own 1024 units. */
const TILE =
  "M 601.62 0 c 147.85 0 221.77 0 278.24 28.77 a 263.99 263.99 0 0 1 115.37 115.37 c 28.77 56.47 28.77 130.39 28.77 278.24 L 1024 601.62 c 0 147.85 0 221.77 -28.77 278.24 a 263.99 263.99 0 0 1 -115.37 115.37 c -56.47 28.77 -130.39 28.77 -278.24 28.77 L 422.38 1024 c -147.85 0 -221.77 0 -278.24 -28.77 a 263.99 263.99 0 0 1 -115.37 -115.37 c -28.77 -56.47 -28.77 -130.39 -28.77 -278.24 L 0 422.38 c 0 -147.85 0 -221.77 28.77 -278.24 a 263.99 263.99 0 0 1 115.37 -115.37 c 56.47 -28.77 130.39 -28.77 278.24 -28.77 Z";
