import React from 'react';
import { 
  Radio, 
  Scissors, 
  ListOrdered, 
  FolderCheck, 
  Cpu, 
  History,
  HardDrive
} from 'lucide-react';

export type SidebarTab = 'inspector' | 'trimmer' | 'queue' | 'library' | 'history' | 'sidecars';

interface SidebarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  queueCount: number;
  completedCount: number;
  historyCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  queueCount,
  completedCount,
  historyCount,
}) => {
  return (
    <aside className="w-56 bg-[#161618] border-r border-[#2C2C2E] flex flex-col justify-between shrink-0 select-none py-3">
      {/* Top Nav Sections */}
      <div className="space-y-5 px-2">
        {/* Section 1: Extraction & Edit */}
        <div>
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#636366] block mb-1">
            Media Studio
          </span>
          <div className="space-y-0.5">
            <button
              onClick={() => onTabChange('inspector')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xs text-xs font-medium transition-colors ${
                activeTab === 'inspector'
                  ? 'bg-[#28282A] text-[#FA2D48] font-semibold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-[#1C1C1E]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Radio className="w-3.5 h-3.5" />
                <span>Stream Inspector</span>
              </div>
            </button>

            <button
              onClick={() => onTabChange('trimmer')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xs text-xs font-medium transition-colors ${
                activeTab === 'trimmer'
                  ? 'bg-[#28282A] text-[#FA2D48] font-semibold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-[#1C1C1E]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Scissors className="w-3.5 h-3.5" />
                <span>Timeline Trimmer</span>
              </div>
            </button>
          </div>
        </div>

        {/* Section 2: Tasks & Storage */}
        <div>
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#636366] block mb-1">
            Batch Pipeline
          </span>
          <div className="space-y-0.5">
            <button
              onClick={() => onTabChange('queue')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xs text-xs font-medium transition-colors ${
                activeTab === 'queue'
                  ? 'bg-[#28282A] text-[#FA2D48] font-semibold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-[#1C1C1E]'
              }`}
            >
              <div className="flex items-center gap-2">
                <ListOrdered className="w-3.5 h-3.5" />
                <span>Active Queue</span>
              </div>
              {queueCount > 0 && (
                <span className="text-[10px] font-timecode bg-[#2C2C2E] text-[#F5F5F7] px-1.5 py-0.2 rounded-xs">
                  {queueCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onTabChange('library')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xs text-xs font-medium transition-colors ${
                activeTab === 'library'
                  ? 'bg-[#28282A] text-[#FA2D48] font-semibold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-[#1C1C1E]'
              }`}
            >
              <div className="flex items-center gap-2">
                <FolderCheck className="w-3.5 h-3.5" />
                <span>Output Library</span>
              </div>
              {completedCount > 0 && (
                <span className="text-[10px] font-timecode text-[#8E8E93]">
                  {completedCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onTabChange('history')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xs text-xs font-medium transition-colors ${
                activeTab === 'history'
                  ? 'bg-[#28282A] text-[#FA2D48] font-semibold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-[#1C1C1E]'
              }`}
            >
              <div className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-[#FA2D48]" />
                <span>Persistent History</span>
              </div>
              {historyCount > 0 && (
                <span className="text-[10px] font-timecode text-[#8E8E93]">
                  {historyCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Section 3: Tauri Desktop Core */}
        <div>
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#636366] block mb-1">
            System Bridge
          </span>
          <div className="space-y-0.5">
            <button
              onClick={() => onTabChange('sidecars')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xs text-xs font-medium transition-colors ${
                activeTab === 'sidecars'
                  ? 'bg-[#28282A] text-[#FA2D48] font-semibold'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-[#1C1C1E]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5" />
                <span>Sidecar Engines</span>
              </div>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="yt-dlp & FFmpeg verified" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Sidecar Telemetry Status */}
      <div className="px-3 pt-3 border-t border-[#2C2C2E] space-y-1.5 text-[11px] text-[#8E8E93]">
        <div className="flex items-center justify-between">
          <span className="text-[#636366]">yt-dlp</span>
          <span className="font-timecode text-[#F5F5F7]">2025.01.26</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#636366]">FFmpeg</span>
          <span className="font-timecode text-[#F5F5F7]">v7.1-static</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#636366]">Tauri IPC</span>
          <span className="text-emerald-400 font-medium">Ready</span>
        </div>
      </div>
    </aside>
  );
};
