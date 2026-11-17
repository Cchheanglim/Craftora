/**
 * The look (Settings → Look): a colour (Craftora red, the default; Lively; Light) and whether panels are see-through
 * glass (styles/themes.css). Remembered on this PC.
 */
export type Colour = "red" | "lively" | "light";
export interface Theme {
  colour: Colour;
  glass: boolean;
}

const COLOUR_KEY = "craftora.colour";
const GLASS_KEY = "craftora.glass";
/** Before Colour + Glass: "classic", "dark" (dark glass) or "light" (light glass). */
const OLD_KEY = "craftora.theme";

export function savedTheme(): Theme {
  try {
    const colour = localStorage.getItem(COLOUR_KEY);
    if (colour === "red" || colour === "lively" || colour === "light") return { colour, glass: localStorage.getItem(GLASS_KEY) === "1" };
    const old = localStorage.getItem(OLD_KEY);
    if (old === "dark") return { colour: "red", glass: true };
    if (old === "light") return { colour: "light", glass: true };
  } catch {
    /* the default look */
  }
  return { colour: "red", glass: false };
}

/** Puts `theme` on the page; with `smooth`, colours and corners ease over instead of jumping. */
export function applyTheme(theme: Theme, smooth = false) {
  const root = document.documentElement;
  if (smooth) {
    root.classList.add("is-retheming");
    window.setTimeout(() => root.classList.remove("is-retheming"), 700);
  }
  if (theme.colour === "red") delete root.dataset.colour;
  else root.dataset.colour = theme.colour;
  // data-theme is the glass (themes.css): its light glass goes with the Light colour, its dark glass with the others.
  if (theme.glass) root.dataset.theme = theme.colour === "light" ? "light" : "dark";
  else delete root.dataset.theme;
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(COLOUR_KEY, theme.colour);
    localStorage.setItem(GLASS_KEY, theme.glass ? "1" : "0");
  } catch {
    /* the look still changes for this session */
  }
}
