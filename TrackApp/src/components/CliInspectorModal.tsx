import React, { useState } from 'react';
import { X, Copy, Check, Terminal, ExternalLink, ShieldCheck } from 'lucide-react';

interface CliInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  commandSnippet: string;
}

export const CliInspectorModal: React.FC<CliInspectorModalProps> = ({
  isOpen,
  onClose,
  commandSnippet,
}) => {
  if (!isOpen) return null;

  const [copied, setCopied] = useState(false);
  const [shellType, setShellType] = useState<'powershell' | 'bash' | 'cmd'>('powershell');

  const handleCopy = () => {
    navigator.clipboard.writeText(commandSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div 
        className="w-full max-w-2xl bg-[#1C1C1E] border border-[#2C2C2E] rounded-xs shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#2C2C2E] flex items-center justify-between bg-[#161618]">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#FA2D48]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F5F5F7]">
              Tauri Sidecar CLI Command Inspector
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#8E8E93] hover:text-[#F5F5F7] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs">
          <p className="text-[#8E8E93] leading-relaxed">
            The Tauri core invokes bundled <strong className="text-[#F5F5F7]">yt-dlp</strong> and <strong className="text-[#F5F5F7]">FFmpeg</strong> sidecars without needing global environment PATH variables. Below is the exact command invoked:
          </p>

          {/* Shell Selector Tabs */}
          <div className="flex items-center gap-1 border-b border-[#2C2C2E] pb-2 text-[11px] font-timecode">
            <button
              onClick={() => setShellType('powershell')}
              className={`px-2.5 py-1 rounded-xs transition-colors ${
                shellType === 'powershell'
                  ? 'bg-[#28282A] text-[#FA2D48] font-bold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7]'
              }`}
            >
              PowerShell (Windows)
            </button>
            <button
              onClick={() => setShellType('bash')}
              className={`px-2.5 py-1 rounded-xs transition-colors ${
                shellType === 'bash'
                  ? 'bg-[#28282A] text-[#FA2D48] font-bold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7]'
              }`}
            >
              Bash (macOS / Linux)
            </button>
            <button
              onClick={() => setShellType('cmd')}
              className={`px-2.5 py-1 rounded-xs transition-colors ${
                shellType === 'cmd'
                  ? 'bg-[#28282A] text-[#FA2D48] font-bold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7]'
              }`}
            >
              Command Prompt (CMD)
            </button>
          </div>

          {/* Code Container */}
          <div className="relative bg-[#121212] border border-[#2C2C2E] p-3 rounded-xs font-timecode text-xs text-emerald-400 overflow-x-auto leading-relaxed">
            <pre className="whitespace-pre-wrap break-all">{commandSnippet}</pre>
            
            <button
              onClick={handleCopy}
              className="absolute top-2.5 right-2.5 px-2.5 py-1 bg-[#28282A] hover:bg-[#323235] text-[#F5F5F7] border border-[#3A3A3C] text-[10px] font-semibold rounded-xs transition-colors flex items-center gap-1"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy Shell Snippet</span>
                </>
              )}
            </button>
          </div>

          {/* Sidecar Environment Diagnostics */}
          <div className="bg-[#161618] border border-[#2C2C2E] p-3 rounded-xs space-y-1.5 text-[11px] text-[#8E8E93]">
            <div className="flex items-center justify-between">
              <span>Bundled yt-dlp binary:</span>
              <span className="font-timecode text-[#F5F5F7]">src-tauri/bin/yt-dlp-x86_64-pc-windows-msvc.exe</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Bundled FFmpeg binary:</span>
              <span className="font-timecode text-[#F5F5F7]">src-tauri/bin/ffmpeg-x86_64-pc-windows-msvc.exe</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Lossless Stream Copy:</span>
              <span className="text-emerald-400 font-bold">-c copy enabled</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[#161618] border-t border-[#2C2C2E] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#28282A] hover:bg-[#323235] text-[#F5F5F7] text-xs font-semibold rounded-xs border border-[#3A3A3C] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
