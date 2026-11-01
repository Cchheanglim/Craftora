/**
 * The look: Classic (the flat dark design, the default) or the see-through glass themes, dark or
 * light (styles/themes.css). Remembered on this PC.
 */
export type Theme = "classic" | "dark" | "light";

const KEY = "craftora.theme";

export function savedTheme(): Theme {
  try {
    const theme = localStorage.getItem(KEY);
    return theme === "dark" || theme === "light" ? theme : "classic";
  } catch {
    return "classic";
  }
}

/** Puts `theme` on the page; with `smooth`, colours and corners ease over instead of jumping. */
export function applyTheme(theme: Theme, smooth = false) {
  const root = document.documentElement;
  if (smooth) {
    root.classList.add("is-retheming");
    window.setTimeout(() => root.classList.remove("is-retheming"), 700);
  }
  if (theme === "classic") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the look still changes for this session */
  }
}
