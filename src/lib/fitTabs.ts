/**
 * Which tabs fit in one row (indexes, in order): as many as fit from the start, plus the open one wherever it is, with
 * room left for a More button when any are left out. `widths` are the tabs' own widths, `gap` the space between.
 */
export function fitTabs(widths: number[], room: number, moreWidth: number, gap: number, open: number): number[] {
  const all = widths.map((_, i) => i);
  if (widths.reduce((sum, w) => sum + w + gap, -gap) <= room) return all;
  let left = room - moreWidth - (open >= 0 ? widths[open] + gap : 0);
  const shown = open >= 0 ? [open] : [];
  for (const i of all) {
    if (i === open) continue;
    if (widths[i] + gap > left) break;
    shown.push(i);
    left -= widths[i] + gap;
  }
  return shown.sort((a, b) => a - b);
}
