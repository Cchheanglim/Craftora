import React, { useState } from 'react';
import { 
  History, 
  RotateCcw, 
  Scissors, 
  Copy, 
  Trash2, 
  ExternalLink, 
  Search, 
  Download, 
  FileVideo, 
  FileAudio, 
  Check, 
  FlipHorizontal, 
  Zap, 
  FolderOpen,
  ArrowUpRight,
  Filter
} from 'lucide-react';
import { HistoryLogEntry } from '../types/media';

interface HistoryViewProps {
  history: HistoryLogEntry[];
  onRerunJob: (entry: HistoryLogEntry) => void;
  onLoadIntoTrimmer: (entry: HistoryLogEntry) => void;
  onDeleteEntry: (id: string) => void;
  onClearHistory: () => void;
  onCopyCommand: (cmd: string) => void;
  onRevealFolder: (path: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onRerunJob,
  onLoadIntoTrimmer,
  onDeleteEntry,
  onClearHistory,
  onCopyCommand,
  onRevealFolder,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'trimmed' | 'audio' | 'transformed'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredHistory = history.filter((item) => {
    // Search match
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || 
      item.title.toLowerCase().includes(q) || 
      item.sourceUrl.toLowerCase().includes(q) ||
      item.outputPath.toLowerCase().includes(q) ||
      item.outputExt.toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (filterType === 'trimmed') return item.isTrimmed;
    if (filterType === 'audio') return item.audioOnly;
    if (filterType === 'transformed') return item.isMirrored || item.isReversed;
    return true;
  });

  const handleCopy = (id: string, cmd: string) => {
    onCopyCommand(cmd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleExportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(history, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `craftora_history_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const totalReruns = history.reduce((acc, h) => acc + (h.rerunCount || 0), 0);

  return (
    <div className="h-full flex flex-col bg-[#121212] overflow-y-auto p-5 space-y-5">
      {/* Top Header & Analytics Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#2C2C2E] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#FA2D48]" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F5F5F7]">
              Persistent Download &amp; Extraction Logs
            </h2>
          </div>
          <p className="text-xs text-[#8E8E93] mt-0.5">
            Logs are saved in Tauri persistent state storage and survive app restarts. Re-run jobs with 1-click.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportJson}
            disabled={history.length === 0}
            className="px-2.5 py-1.5 bg-[#242426] hover:bg-[#2A2A2D] disabled:opacity-40 text-[#8E8E93] hover:text-[#F5F5F7] border border-[#2C2C2E] text-xs font-medium rounded-xs transition-colors flex items-center gap-1.5"
            title="Export History to JSON file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>

          <button
            onClick={onClearHistory}
            disabled={history.length === 0}
            className="px-2.5 py-1.5 bg-[#242426] hover:bg-[#322022] hover:text-rose-400 disabled:opacity-40 text-[#8E8E93] border border-[#2C2C2E] text-xs font-medium rounded-xs transition-colors flex items-center gap-1.5"
            title="Clear all stored logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Logs</span>
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-[#1C1C1E] border border-[#2C2C2E] rounded-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#636366] block">
            Stored Jobs
          </span>
          <span className="text-sm font-timecode font-bold text-[#F5F5F7] mt-0.5 block">
            {history.length} Records
          </span>
        </div>

        <div className="p-3 bg-[#1C1C1E] border border-[#2C2C2E] rounded-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#636366] block">
            Re-run Executions
          </span>
          <span className="text-sm font-timecode font-bold text-[#FA2D48] mt-0.5 block">
            {totalReruns} Triggered
          </span>
        </div>

        <div className="p-3 bg-[#1C1C1E] border border-[#2C2C2E] rounded-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#636366] block">
            Trimmed Clips
          </span>
          <span className="text-sm font-timecode font-bold text-[#F5F5F7] mt-0.5 block">
            {history.filter((h) => h.isTrimmed).length} Clips
          </span>
        </div>

        <div className="p-3 bg-[#1C1C1E] border border-[#2C2C2E] rounded-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#636366] block">
            Storage Engine
          </span>
          <span className="text-sm font-timecode font-bold text-emerald-400 mt-0.5 block">
            Tauri Store · Persistent
          </span>
        </div>
      </div>

      {/* Search & Segmented Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#161618] p-2 rounded-xs border border-[#2C2C2E]">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-[#636366] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search history by title, URL, path, or extension..."
            className="w-full bg-[#121212] border border-[#2C2C2E] focus:border-[#FA2D48] text-xs text-[#F5F5F7] pl-8 pr-3 py-1.5 rounded-xs outline-none transition-colors placeholder:text-[#636366]"
          />
        </div>

        {/* Filter Segmented Controls */}
        <div className="flex items-center bg-[#121212] border border-[#2C2C2E] rounded-xs p-0.5 text-xs">
          {(['all', 'trimmed', 'audio', 'transformed'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterType(mode)}
              className={`px-2.5 py-1 rounded-xs capitalize transition-colors font-medium ${
                filterType === mode
                  ? 'bg-[#28282A] text-[#FA2D48] font-semibold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7]'
              }`}
            >
              {mode === 'all' ? 'All' : mode}
            </button>
          ))}
        </div>
      </div>

      {/* History Records List */}
      {filteredHistory.length === 0 ? (
        <div className="py-14 text-center border border-dashed border-[#2C2C2E] rounded-xs bg-[#161618] space-y-2">
          <History className="w-8 h-8 stroke-[1.2] text-[#3A3A3C] mx-auto" />
          <h4 className="text-xs font-semibold text-[#F5F5F7]">No Matching History Logs</h4>
          <p className="text-[11px] text-[#636366] max-w-sm mx-auto">
            {searchQuery
              ? 'Try modifying your search or reset the category filter.'
              : 'Download or trim jobs to automatically record persistent logs.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredHistory.map((item) => (
            <div
              key={item.id}
              className="bg-[#1C1C1E] border border-[#2C2C2E] hover:border-[#3A3A3C] rounded-xs p-4 space-y-3 transition-colors"
            >
              {/* Row 1: Header with Icon, Title, and Actions */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`p-2.5 rounded-xs shrink-0 mt-0.5 ${item.audioOnly ? 'bg-amber-950/40 text-amber-400' : 'bg-[#28282A] text-[#FA2D48]'}`}>
                    {item.audioOnly ? <FileAudio className="w-4 h-4" /> : <FileVideo className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-[#F5F5F7] truncate leading-tight">
                      {item.title}
                    </h3>
                    <p className="text-[11px] font-timecode text-[#8E8E93] truncate mt-0.5">
                      Source: {item.sourceUrl}
                    </p>
                  </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Re-run Job Button */}
                  <button
                    onClick={() => onRerunJob(item)}
                    className="px-3 py-1.5 bg-[#FA2D48] hover:bg-[#E0283F] text-white text-xs font-bold rounded-xs transition-colors flex items-center gap-1.5 shadow-xs"
                    title="Queue and re-download/process this exact job"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Re-run Job</span>
                  </button>

                  {/* Load into Trimmer Button (if trimmed) */}
                  {item.isTrimmed && (
                    <button
                      onClick={() => onLoadIntoTrimmer(item)}
                      className="px-2.5 py-1.5 bg-[#28282A] hover:bg-[#323235] text-[#F5F5F7] border border-[#3A3A3C] text-xs font-medium rounded-xs transition-colors flex items-center gap-1"
                      title="Load into Timeline Trimmer with In/Out markers"
                    >
                      <Scissors className="w-3 h-3 text-[#FA2D48]" />
                      <span className="hidden sm:inline">Load Trimmer</span>
                    </button>
                  )}

                  {/* Copy CLI Snippet */}
                  <button
                    onClick={() => handleCopy(item.id, item.commandSnippet)}
                    className="px-2 py-1.5 bg-[#28282A] hover:bg-[#323235] text-[#8E8E93] hover:text-[#F5F5F7] border border-[#3A3A3C] text-xs rounded-xs transition-colors"
                    title="Copy CLI command"
                  >
                    {copiedId === item.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {/* Delete from History */}
                  <button
                    onClick={() => onDeleteEntry(item.id)}
                    className="p-1.5 text-[#636366] hover:text-rose-400 hover:bg-[#28282A] rounded-xs transition-colors"
                    title="Delete log record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Row 2: Clean Unboxed Metadata with middots */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-timecode text-[#8E8E93] border-t border-[#2C2C2E] pt-2.5">
                <span className="text-[#F5F5F7] font-semibold">{item.outputExt.toUpperCase()}</span>
                <span aria-hidden="true">·</span>
                <span>{item.fileSize}</span>
                <span aria-hidden="true">·</span>
                <span>Duration: {item.durationText}</span>
                <span aria-hidden="true">·</span>
                <span>{item.completedAt}</span>
                {item.rerunCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#FA2D48] font-bold">Re-run {item.rerunCount}x</span>
                  </>
                )}

                {/* Transformations as quiet indicators */}
                {item.isLossless && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <Zap className="w-3 h-3" /> Lossless Copy
                    </span>
                  </>
                )}
                {item.isMirrored && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-400 font-semibold flex items-center gap-1">
                      <FlipHorizontal className="w-3 h-3" /> Mirrored
                    </span>
                  </>
                )}
                {item.isReversed && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-400 font-semibold flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" /> Reversed
                    </span>
                  </>
                )}
              </div>

              {/* Row 3: Output path & Reveal */}
              <div className="flex items-center justify-between text-[11px] font-timecode text-[#636366] bg-[#121212] px-2.5 py-1.5 rounded-xs border border-[#2C2C2E]">
                <span className="truncate pr-2">Saved to: {item.outputPath}</span>
                <button
                  onClick={() => onRevealFolder(item.outputPath)}
                  className="text-[#8E8E93] hover:text-[#F5F5F7] shrink-0 underline underline-offset-2 flex items-center gap-1"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>Reveal Folder</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
