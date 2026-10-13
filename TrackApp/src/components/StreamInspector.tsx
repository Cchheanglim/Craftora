import React, { useState } from 'react';
import { 
  Film, 
  Music, 
  Clock, 
  Eye, 
  Calendar, 
  Sliders, 
  Check, 
  ArrowRight,
  Download,
  Scissors
} from 'lucide-react';
import { MediaMetadata, StreamFormatOption } from '../types/media';
import { formatTimecode } from '../utils/formatters';

interface StreamInspectorProps {
  metadata: MediaMetadata | null;
  onOpenTrimmer: () => void;
  onQuickDownload: (format: StreamFormatOption) => void;
  selectedFormatId: string;
  onSelectFormatId: (id: string) => void;
}

export const StreamInspector: React.FC<StreamInspectorProps> = ({
  metadata,
  onOpenTrimmer,
  onQuickDownload,
  selectedFormatId,
  onSelectFormatId,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'video' | 'audio'>('all');

  if (!metadata) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-[#8E8E93] bg-[#121212]">
        <Film className="w-10 h-10 stroke-[1.2] text-[#3A3A3C] mb-3" />
        <h3 className="text-sm font-semibold text-[#F5F5F7]">No Media Stream Loaded</h3>
        <p className="text-xs text-[#636366] max-w-sm mt-1">
          Paste a video or audio URL into the top bar or pick a test stream from the sample menu above.
        </p>
      </div>
    );
  }

  const filteredFormats = metadata.formats.filter((f) => {
    if (filterType === 'video') return !f.isAudioOnly;
    if (filterType === 'audio') return f.isAudioOnly;
    return true;
  });

  const activeFormat = metadata.formats.find((f) => f.formatId === selectedFormatId) || metadata.formats[0];

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-[#121212] p-5 space-y-6">
      {/* Top Media Overview Card */}
      <div className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-xs p-4 flex flex-col sm:flex-row gap-4 items-start">
        {/* Thumbnail Preview */}
        <div className="relative w-full sm:w-64 aspect-video bg-[#121212] rounded-xs overflow-hidden shrink-0 border border-[#2C2C2E]">
          <img
            src={metadata.thumbnail}
            alt={metadata.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/85 text-[#F5F5F7] text-[10px] font-timecode rounded-xs">
            {formatTimecode(metadata.duration, false)}
          </div>
        </div>

        {/* Media Details */}
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <h2 className="text-base font-semibold text-[#F5F5F7] leading-snug">
              {metadata.title}
            </h2>
            <p className="text-xs text-[#8E8E93] mt-0.5">
              {metadata.uploader}
            </p>
          </div>

          {/* Clean Unboxed Metadata with middots */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#8E8E93] font-timecode pt-1">
            <span>{metadata.viewCount} views</span>
            <span aria-hidden="true">·</span>
            <span>Uploaded {metadata.uploadDate}</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#F5F5F7] font-medium">{metadata.formats.length} streams available</span>
          </div>

          {/* Quick Action Triggers */}
          <div className="pt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={onOpenTrimmer}
              className="px-3.5 py-1.5 bg-[#FA2D48] hover:bg-[#E0283F] text-white text-xs font-semibold rounded-xs transition-colors flex items-center gap-1.5"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Launch Timeline Trimmer</span>
            </button>

            <button
              onClick={() => onQuickDownload(activeFormat)}
              className="px-3 py-1.5 bg-[#28282A] hover:bg-[#323235] text-[#F5F5F7] border border-[#3A3A3C] text-xs font-medium rounded-xs transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-[#8E8E93]" />
              <span>Download Direct ({activeFormat.resolution})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stream Formats Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-[#2C2C2E] pb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8E8E93]">
              Available Streams &amp; Audio Codecs
            </h3>
          </div>

          {/* Format Type Segmented Switcher */}
          <div className="flex items-center bg-[#1C1C1E] border border-[#2C2C2E] rounded-xs p-0.5 text-[11px]">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-0.5 rounded-xs transition-colors ${
                filterType === 'all'
                  ? 'bg-[#28282A] text-[#F5F5F7] font-medium'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7]'
              }`}
            >
              All Formats
            </button>
            <button
              onClick={() => setFilterType('video')}
              className={`px-2.5 py-0.5 rounded-xs transition-colors ${
                filterType === 'video'
                  ? 'bg-[#28282A] text-[#F5F5F7] font-medium'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7]'
              }`}
            >
              Video Streams
            </button>
            <button
              onClick={() => setFilterType('audio')}
              className={`px-2.5 py-0.5 rounded-xs transition-colors ${
                filterType === 'audio'
                  ? 'bg-[#28282A] text-[#F5F5F7] font-medium'
                  : 'text-[#8E8E93] hover:text-[#F5F5F7]'
              }`}
            >
              Audio Extractions
            </button>
          </div>
        </div>

        {/* Formats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {filteredFormats.map((fmt) => {
            const isSelected = fmt.formatId === selectedFormatId;
            return (
              <div
                key={fmt.formatId}
                onClick={() => onSelectFormatId(fmt.formatId)}
                className={`p-3 rounded-xs border cursor-pointer transition-all flex items-center justify-between ${
                  isSelected
                    ? 'bg-[#1C1C1E] border-[#FA2D48] ring-1 ring-[#FA2D48]/30'
                    : 'bg-[#161618] border-[#2C2C2E] hover:border-[#3A3A3C]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xs ${fmt.isAudioOnly ? 'bg-amber-950/40 text-amber-400' : 'bg-[#242426] text-[#F5F5F7]'}`}>
                    {fmt.isAudioOnly ? <Music className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#F5F5F7]">
                        {fmt.resolution}
                      </span>
                      <span className="text-[10px] uppercase font-timecode text-[#8E8E93] px-1 py-0.2 bg-[#28282A] rounded-xs border border-[#3A3A3C]">
                        {fmt.ext}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8E8E93] font-timecode mt-0.5">
                      <span>Codec: {fmt.vcodec}</span>
                      {fmt.fps > 0 && <span> · {fmt.fps}fps</span>}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-timecode font-medium text-[#F5F5F7] block">
                    ~{fmt.filesizeApprox}
                  </span>
                  {isSelected && (
                    <span className="text-[10px] text-[#FA2D48] font-semibold flex items-center gap-1 justify-end mt-0.5">
                      <Check className="w-3 h-3" /> Selected
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
