const pad = (n: number) => String(n).padStart(2, "0");

/** 84.5 → "00:01:24.50". Hundredths match what FFmpeg accepts for -ss / -to. */
export function formatTimecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const hundredths = Math.floor(((s % 1) * 100) + 1e-6);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(hundredths)}`;
}

/** 84.5 → "01:24", 3725 → "1:02:05". Truncates like formatTimecode, so labels agree. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds + 1e-6));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

/**
 * Accepts "hh:mm:ss.cc", "mm:ss", "ss" (decimals allowed in the last part).
 * Returns null when the text is not a valid time.
 */
export function parseTimecode(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length === 0 || parts.length > 3) return null;
  let total = 0;
  for (const [i, raw] of parts.entries()) {
    const part = raw.trim();
    const isLast = i === parts.length - 1;
    if (!(isLast ? /^\d+(\.\d+)?$/ : /^\d+$/).test(part)) return null;
    total = total * 60 + Number(part);
  }
  return total;
}
