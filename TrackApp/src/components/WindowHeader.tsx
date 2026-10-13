import React, { useState } from 'react';
import { 
  Link2, 
  Terminal, 
  Play, 
  ArrowRight,
  ClipboardPaste,
  Check,
  ChevronDown
} from 'lucide-react';
import { SAMPLE_STREAMS } from '../data/samples';
import { MediaMetadata } from '../types/media';

interface WindowHeaderProps {
  currentUrl: string;
  onUrlChange: (url: string) => void;
  onInspect: (url: string) => void;
  isInspecting: boolean;
  onSelectSample: (stream: MediaMetadata) => void;
  onToggleCliInspector: () => void;
  activeQueueCount: number;
}

export const WindowHeader: React.FC<WindowHeaderProps> = ({
  currentUrl,
  onUrlChange,
  onInspect,
  isInspecting,
  onSelectSample,
  onToggleCliInspector,
  activeQueueCount,
}) => {
  const [copiedNotification, setCopiedNotification] = useState(false);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onUrlChange(text);
        onInspect(text);
        setCopiedNotification(true);
        setTimeout(() => setCopiedNotification(false), 1400);
      }
    } catch {
      if (currentUrl) onInspect(currentUrl);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUrl.trim()) {
      onInspect(currentUrl.trim());
    }
  };

  return (
    <header className="h-12 bg-[#1C1C1E] border-b border-[#2C2C2E] flex items-center justify-between px-4 gap-4 select-none shrink-0 z-20">
      {/* Left: macOS Traffic Lights & Title */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/40 inline-block cursor-pointer" />
          <span className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/40 inline-block cursor-pointer" />
          <span className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/40 inline-block cursor-pointer" />
        </div>
        <span className="text-xs font-semibold text-[#F5F5F7] tracking-tight">
          Craftora Media
        </span>
      </div>

      {/* Center: Sleek URL Input Bar */}
      <form onSubmit={handleSubmit} className="flex-1 max-w-xl flex items-center gap-2">
        <div className="relative flex-1 flex items-center">
          <Link2 className="w-3.5 h-3.5 text-[#636366] absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={currentUrl}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="Paste media URL to inspect, trim, or extract..."
            className="w-full bg-[#121212] border border-[#2C2C2E] focus:border-[#FA2D48] text-xs text-[#F5F5F7] pl-8 pr-16 py-1.5 rounded-xs outline-none transition-colors font-timecode placeholder:text-[#636366]"
          />
          <button
            type="button"
            onClick={handlePaste}
            className="absolute right-1.5 px-1.5 py-0.5 text-[10px] text-[#8E8E93] hover:text-[#F5F5F7] bg-[#242426] hover:bg-[#2A2A2D] rounded-xs border border-[#3A3A3C] transition-colors"
            title="Paste from clipboard"
          >
            {copiedNotification ? (
              <span className="text-emerald-400 flex items-center gap-0.5">
                <Check className="w-2.5 h-2.5" /> Pasted
              </span>
            ) : (
              'Paste'
            )}
          </button>
        </div>

        <button
          type="submit"
          disabled={isInspecting || !currentUrl.trim()}
          className="px-3 py-1.5 bg-[#FA2D48] hover:bg-[#E0283F] disabled:bg-[#28282A] disabled:text-[#636366] text-white text-xs font-semibold rounded-xs transition-colors shrink-0"
        >
          {isInspecting ? 'Loading...' : 'Inspect'}
        </button>
      </form>

      {/* Right: Quick Test Streams & CLI */}
      <div className="flex items-center gap-2 shrink-0">
        <select
          onChange={(e) => {
            const found = SAMPLE_STREAMS.find((s) => s.id === e.target.value);
            if (found) onSelectSample(found);
          }}
          className="bg-[#121212] border border-[#2C2C2E] text-[#8E8E93] hover:text-[#F5F5F7] text-xs px-2 py-1 rounded-xs outline-none cursor-pointer"
          defaultValue=""
        >
          <option value="" disabled>Samples</option>
          {SAMPLE_STREAMS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title.slice(0, 24)}...
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onToggleCliInspector}
          className="p-1.5 text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-[#28282A] rounded-xs border border-transparent hover:border-[#3A3A3C] transition-colors"
          title="CLI Shell Syntax"
        >
          <Terminal className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
