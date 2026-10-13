import { HistoryLogEntry } from '../types/media';

const STORAGE_KEY = 'craftora_download_history_v1';

// Initial realistic persistent seed data for first launch
const INITIAL_SEEDS: HistoryLogEntry[] = [
  {
    id: 'hist-20261012-001',
    title: 'Big Buck Bunny (Lossless Clip 00:00:15 - 00:01:45)',
    sourceUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    outputPath: 'C:/Users/User/Videos/Craftora/BigBuckBunny_clip_01.mp4',
    outputExt: 'mp4',
    fileSize: '138 MB',
    durationText: '00:01:30',
    isTrimmed: true,
    startTime: 15,
    endTime: 105,
    isLossless: true,
    isMirrored: false,
    isReversed: false,
    audioOnly: false,
    commandSnippet: 'ffmpeg -ss 00:00:15.00 -to 00:01:45.00 -i BigBuckBunny.mp4 -c copy output_lossless.mp4',
    completedAt: 'Oct 12, 2026 · 11:42 PM',
    timestamp: Date.now() - 3600000 * 2,
    rerunCount: 1,
  },
  {
    id: 'hist-20261012-002',
    title: 'Elephants Dream (Soundtrack Master Audio)',
    sourceUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    outputPath: 'C:/Users/User/Music/Craftora/ElephantsDream_Master.flac',
    outputExt: 'flac',
    fileSize: '62 MB',
    durationText: '00:10:53',
    isTrimmed: false,
    audioOnly: true,
    commandSnippet: 'yt-dlp -x --audio-format flac "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"',
    completedAt: 'Oct 12, 2026 · 09:15 PM',
    timestamp: Date.now() - 3600000 * 5,
    rerunCount: 0,
  },
  {
    id: 'hist-20261011-003',
    title: 'High-Speed Chromatic Flare (Mirrored & Reversed)',
    sourceUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    outputPath: 'C:/Users/User/Videos/Craftora/ForBiggerBlazes_flip_rev.mp4',
    outputExt: 'mp4',
    fileSize: '18 MB',
    durationText: '00:00:15',
    isTrimmed: true,
    startTime: 0,
    endTime: 15,
    isLossless: false,
    isMirrored: true,
    isReversed: true,
    audioOnly: false,
    commandSnippet: 'ffmpeg -ss 00:00:00.00 -to 00:00:15.00 -i ForBiggerBlazes.mp4 -vf "hflip,reverse" -af areverse -c:v libx264 output_transformed.mp4',
    completedAt: 'Oct 11, 2026 · 04:30 PM',
    timestamp: Date.now() - 3600000 * 28,
    rerunCount: 2,
  }
];

export const HistoryStorage = {
  /**
   * Load history from Tauri / LocalStorage persistent state
   */
  load(): HistoryLogEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // Initialize with seeds
        this.saveAll(INITIAL_SEEDS);
        return INITIAL_SEEDS;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.sort((a, b) => b.timestamp - a.timestamp);
      }
      return INITIAL_SEEDS;
    } catch (e) {
      console.warn('Failed to load history from persistent state:', e);
      return INITIAL_SEEDS;
    }
  },

  /**
   * Save all entries to storage
   */
  saveAll(entries: HistoryLogEntry[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 100)));
    } catch (e) {
      console.warn('Failed to persist history entries:', e);
    }
  },

  /**
   * Append or update a history log entry
   */
  record(entry: HistoryLogEntry): HistoryLogEntry[] {
    const existing = this.load();
    const filtered = existing.filter((item) => item.id !== entry.id);
    const updated = [entry, ...filtered];
    this.saveAll(updated);
    return updated;
  },

  /**
   * Delete an entry by ID
   */
  delete(id: string): HistoryLogEntry[] {
    const existing = this.load();
    const updated = existing.filter((item) => item.id !== id);
    this.saveAll(updated);
    return updated;
  },

  /**
   * Clear all logs
   */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear history:', e);
    }
  },

  /**
   * Increment rerun counter for an entry
   */
  incrementRerun(id: string): HistoryLogEntry[] {
    const existing = this.load();
    const updated = existing.map((item) =>
      item.id === id ? { ...item, rerunCount: (item.rerunCount || 0) + 1 } : item
    );
    this.saveAll(updated);
    return updated;
  }
};
