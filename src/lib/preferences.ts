/** Settings → Preferences: small on/off choices, remembered on this PC. */
export type Preference = "finishSound" | "importToTimeline" | "captionsOnGpu";

const DEFAULTS: Record<Preference, boolean> = {
  // Craftora's sound when a download or export finishes.
  finishSound: true,
  // Files imported from this PC go straight onto the timeline (else they wait under In this project).
  importToTimeline: false,
  // whisper uses the graphics card when there is one (speech.rs); off: the processor only.
  captionsOnGpu: true,
};

export function preference(name: Preference): boolean {
  try {
    const saved = localStorage.getItem(`craftora.${name}`);
    return saved === null ? DEFAULTS[name] : saved === "1";
  } catch {
    return DEFAULTS[name];
  }
}

export function setPreference(name: Preference, on: boolean) {
  try {
    localStorage.setItem(`craftora.${name}`, on ? "1" : "0");
  } catch {
    /* not saved: the default stays */
  }
}
