/**
 * Formats seconds into precise HH:MM:SS.ms format for FFmpeg and visual timecodes
 */
export function formatTimecode(seconds: number, includeMs = true): string {
  if (isNaN(seconds) || seconds < 0) return includeMs ? '00:00:00.00' : '00:00:00';
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (includeMs) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(ms)}`;
  }
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

/**
 * Parses HH:MM:SS.ms or MM:SS to seconds
 */
export function parseTimecode(tc: string): number {
  if (!tc) return 0;
  const parts = tc.trim().split(':');
  let seconds = 0;

  if (parts.length === 3) {
    const [h, m, s] = parts;
    seconds = parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
  } else if (parts.length === 2) {
    const [m, s] = parts;
    seconds = parseFloat(m) * 60 + parseFloat(s);
  } else if (parts.length === 1) {
    seconds = parseFloat(parts[0]);
  }

  return isNaN(seconds) ? 0 : Math.max(0, seconds);
}

/**
 * Builds the exact yt-dlp & FFmpeg shell command
 */
export function buildExecutableCommand(
  url: string,
  startTime: number,
  endTime: number,
  isLossless: boolean,
  mirror: boolean,
  reverse: boolean,
  outputExt: string,
  audioOnly: boolean
): string {
  const startStr = formatTimecode(startTime, true);
  const endStr = formatTimecode(endTime, true);
  const duration = Math.max(0, endTime - startTime);
  const durationStr = formatTimecode(duration, true);

  if (audioOnly) {
    return `yt-dlp -x --audio-format ${outputExt} --postprocessor-args "ffmpeg:-ss ${startStr} -to ${endStr}" "${url}" -o "%(title)s_clip.${outputExt}"`;
  }

  // Video commands
  const filters: string[] = [];
  if (mirror) filters.push('hflip');
  if (reverse) filters.push('reverse');

  if (filters.length > 0) {
    const vfArg = filters.join(',');
    const afArg = reverse ? ' -af areverse' : '';
    return `ffmpeg -ss ${startStr} -to ${endStr} -i $(yt-dlp -g -f best "${url}") -vf "${vfArg}"${afArg} -c:v libx264 -crf 18 -c:a aac output_transformed.${outputExt}`;
  }

  if (isLossless) {
    return `ffmpeg -ss ${startStr} -to ${endStr} -i $(yt-dlp -g -f "bv*+ba/b" "${url}") -c copy output_lossless.${outputExt}`;
  }

  return `ffmpeg -ss ${startStr} -to ${endStr} -i $(yt-dlp -g -f "bv*+ba/b" "${url}") -c:v libx264 -preset fast -c:a aac output_cut.${outputExt}`;
}
