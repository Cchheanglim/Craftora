/**
 * Which tabs fit in one row (indexes, in order): as many as fit from the start, with room left for a More button when
 * any are left out. The open tab is never pulled into the row, so the row doesn't rearrange itself (owner: tabs jumping
 * around); More shows as pressed instead. `widths` are the tabs' own widths, `gap` the space between.
 */
export function fitTabs(widths: number[], room: number, moreWidth: number, gap: number): number[] {
  const all = widths.map((_, i) => i);
  if (widths.reduce((sum, w) => sum + w + gap, -gap) <= room) return all;
  let left = room - moreWidth;
  const shown: number[] = [];
  for (const i of all) {
    if (widths[i] + gap > left) break;
    shown.push(i);
    left -= widths[i] + gap;
  }
  return shown;
}
