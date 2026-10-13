import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  FlipHorizontal, 
  Zap, 
  Scissors, 
  Volume2, 
  VolumeX, 
  Check,
  ChevronDown
} from 'lucide-react';
import { MediaMetadata, TrimConfig } from '../types/media';
import { formatTimecode } from '../utils/formatters';

interface TimelineTrimmerProps {
  metadata: MediaMetadata;
  onAddToQueue: (config: TrimConfig) => void;
}

export const TimelineTrimmer: React.FC<TimelineTrimmerProps> = ({
  metadata,
  onAddToQueue,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(metadata.duration || 60);
  const [isMuted, setIsMuted] = useState(false);

  // Trimmer State
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(Math.min(metadata.duration, 120) || 60);
  const [isLossless, setIsLossless] = useState(true);
  const [isMirror, setIsMirror] = useState(false);
  const [isReverse, setIsReverse] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [audioOnly, setAudioOnly] = useState(false);
  const [outputExt, setOutputExt] = useState<'mp4' | 'mkv' | 'mp3' | 'wav'>('mp4');
  const [justQueued, setJustQueued] = useState(false);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const vidDur = videoRef.current.duration;
      if (!isNaN(vidDur) && vidDur > 0) {
        setDuration(vidDur);
        if (endTime > vidDur) {
          setEndTime(vidDur);
        }
      }
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const cur = videoRef.current.currentTime;
      setCurrentTime(cur);
      if (cur >= endTime) {
        videoRef.current.currentTime = startTime;
      }
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (videoRef.current.currentTime < startTime || videoRef.current.currentTime >= endTime) {
        videoRef.current.currentTime = startTime;
      }
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const seekTo = (sec: number) => {
    if (!videoRef.current) return;
    const clamped = Math.max(0, Math.min(duration, sec));
    videoRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const setInToCurrent = () => {
    const newStart = Math.min(currentTime, endTime - 0.5);
    setStartTime(newStart);
  };

  const setOutToCurrent = () => {
    const newEnd = Math.max(currentTime, startTime + 0.5);
    setEndTime(newEnd);
  };

  const resetBounds = () => {
    setStartTime(0);
    setEndTime(duration);
    seekTo(0);
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
      videoRef.current.muted = isMuted;
    }
  }, [playbackSpeed, isMuted]);

  useEffect(() => {
    if (isMirror || isReverse) {
      setIsLossless(false);
    }
  }, [isMirror, isReverse]);

  const handleQueue = () => {
    const config: TrimConfig = {
      startTime,
      endTime,
      isLossless,
      mirror: isMirror,
      reverse: isReverse,
      playbackSpeed,
      selectedFormatId: audioOnly ? 'a-mp3' : 'v-1080',
      audioOnly,
      outputExt: audioOnly ? (outputExt === 'wav' ? 'wav' : 'mp3') : outputExt,
      audioBitrate: '320k',
    };

    onAddToQueue(config);
    setJustQueued(true);
    setTimeout(() => setJustQueued(false), 1800);
  };

  const cutDuration = Math.max(0, endTime - startTime);
  const startPercent = duration > 0 ? (startTime / duration) * 100 : 0;
  const endPercent = duration > 0 ? (endTime / duration) * 100 : 100;
  const currentPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="h-full flex flex-col bg-[#121212] p-6 max-w-5xl mx-auto w-full justify-between space-y-4 select-none">
      
      {/* 1. Header Media Info (Clean Single-Line Title & Breadcrumb) */}
      <div className="flex items-center justify-between border-b border-[#2C2C2E] pb-3">
        <div className="min-w-0 pr-4">
          <h2 className="text-sm font-semibold text-[#F5F5F7] truncate leading-tight">
            {metadata.title}
          </h2>
          <p className="text-xs text-[#8E8E93] mt-0.5 truncate">
            {metadata.uploader} · Total Duration: {formatTimecode(duration, false)}
          </p>
        </div>

        {/* Quick status chips (Clean text only) */}
        <div className="flex items-center gap-3 text-xs font-timecode text-[#8E8E93] shrink-0">
          {isMirror && <span className="text-[#FA2D48] font-semibold">Mirror (H-Flip)</span>}
          {isReverse && <span className="text-[#FA2D48] font-semibold">Reverse</span>}
          {isLossless && !isMirror && !isReverse && <span className="text-emerald-400 font-semibold">Lossless (-c copy)</span>}
        </div>
      </div>

      {/* 2. Video Preview Canvas (Clean, Centered, Apple-like) */}
      <div className="relative flex-1 min-h-64 max-h-[52vh] bg-black rounded-xs overflow-hidden border border-[#2C2C2E] flex items-center justify-center group">
        <video
          ref={videoRef}
          src={metadata.mediaSourceUrl}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          className={`max-h-full max-w-full object-contain transition-transform duration-150 ${
            isMirror ? 'scale-x-[-1]' : ''
          }`}
          playsInline
        />

        {/* Center Hover Play Trigger */}
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-transparent group focus:outline-none"
        >
          <div className="w-12 h-12 rounded-full bg-black/60 group-hover:bg-[#FA2D48] text-white flex items-center justify-center backdrop-blur-xs transition-all opacity-0 group-hover:opacity-100">
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </div>
        </button>

        {/* Quiet audio mute toggle */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="absolute bottom-3 right-3 p-1.5 rounded-xs bg-black/60 text-[#8E8E93] hover:text-white transition-colors"
          title="Mute / Unmute"
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>

      {/* 3. Sleek Timeline Scrubber Bar */}
      <div className="space-y-2 bg-[#161618] border border-[#2C2C2E] p-3 rounded-xs">
        {/* Track */}
        <div className="relative h-7 bg-[#1C1C1E] rounded-xs overflow-hidden flex items-center cursor-pointer">
          {/* Unselected Left */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/50 pointer-events-none"
            style={{ width: `${startPercent}%` }}
          />

          {/* Active Range Highlight */}
          <div
            className="absolute top-0 bottom-0 bg-[#FA2D48]/25 border-y border-[#FA2D48] pointer-events-none"
            style={{
              left: `${startPercent}%`,
              width: `${Math.max(0, endPercent - startPercent)}%`,
            }}
          />

          {/* Unselected Right */}
          <div
            className="absolute top-0 bottom-0 right-0 bg-black/50 pointer-events-none"
            style={{ width: `${100 - endPercent}%` }}
          />

          {/* Playhead Marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none z-10"
            style={{ left: `${currentPercent}%` }}
          />

          {/* In-point handle */}
          <div
            className="absolute top-0 bottom-0 w-1.5 bg-[#FA2D48] pointer-events-none z-10"
            style={{ left: `${startPercent}%` }}
          />

          {/* Out-point handle */}
          <div
            className="absolute top-0 bottom-0 w-1.5 bg-[#FA2D48] pointer-events-none z-10 -ml-1.5"
            style={{ left: `${endPercent}%` }}
          />

          {/* Native Slider for scrub */}
          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={currentTime}
            onChange={(e) => seekTo(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
          />
        </div>

        {/* Timecode readouts & In/Out controls */}
        <div className="flex flex-wrap items-center justify-between text-xs font-timecode text-[#8E8E93] gap-2 pt-1">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="text-[#F5F5F7] hover:text-[#FA2D48] transition-colors font-medium flex items-center gap-1"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>

            <span>
              Playhead: <strong className="text-[#F5F5F7]">{formatTimecode(currentTime, true)}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span>In: <strong className="text-[#F5F5F7]">{formatTimecode(startTime, false)}</strong></span>
            <button
              onClick={setInToCurrent}
              className="px-2 py-0.5 bg-[#242426] hover:bg-[#2C2C2E] text-[#F5F5F7] rounded-xs text-[10px] font-medium transition-colors"
            >
              Set In
            </button>

            <span>Out: <strong className="text-[#F5F5F7]">{formatTimecode(endTime, false)}</strong></span>
            <button
              onClick={setOutToCurrent}
              className="px-2 py-0.5 bg-[#242426] hover:bg-[#2C2C2E] text-[#F5F5F7] rounded-xs text-[10px] font-medium transition-colors"
            >
              Set Out
            </button>

            <button
              onClick={resetBounds}
              className="px-2 py-0.5 text-[#8E8E93] hover:text-[#F5F5F7] text-[10px] transition-colors ml-1"
            >
              Reset
            </button>
          </div>

          <div className="text-right">
            <span>Clip Duration: <strong className="text-[#FA2D48]">{formatTimecode(cutDuration, true)}</strong></span>
          </div>
        </div>
      </div>

      {/* 4. Streamlined Processing Toolbar (Single Clean Row) */}
      <div className="bg-[#1C1C1E] border border-[#2C2C2E] p-3 rounded-xs flex flex-wrap items-center justify-between gap-3">
        {/* Left: Transformation Switches */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {/* Mirror Button */}
          <button
            onClick={() => setIsMirror(!isMirror)}
            className={`px-3 py-1.5 rounded-xs border transition-colors flex items-center gap-1.5 ${
              isMirror
                ? 'bg-[#28282A] text-[#FA2D48] border-[#FA2D48] font-semibold'
                : 'bg-[#121212] text-[#8E8E93] hover:text-[#F5F5F7] border-[#2C2C2E]'
            }`}
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span>Mirror Video</span>
          </button>

          {/* Reverse Button */}
          <button
            onClick={() => setIsReverse(!isReverse)}
            className={`px-3 py-1.5 rounded-xs border transition-colors flex items-center gap-1.5 ${
              isReverse
                ? 'bg-[#28282A] text-[#FA2D48] border-[#FA2D48] font-semibold'
                : 'bg-[#121212] text-[#8E8E93] hover:text-[#F5F5F7] border-[#2C2C2E]'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reverse</span>
          </button>

          {/* Lossless Cut Button */}
          <button
            disabled={isMirror || isReverse}
            onClick={() => setIsLossless(!isLossless)}
            className={`px-3 py-1.5 rounded-xs border transition-colors flex items-center gap-1.5 ${
              isLossless && !isMirror && !isReverse
                ? 'bg-[#28282A] text-emerald-400 border-emerald-500 font-semibold'
                : 'bg-[#121212] text-[#8E8E93] hover:text-[#F5F5F7] border-[#2C2C2E]'
            } ${isMirror || isReverse ? 'opacity-40 cursor-not-allowed' : ''}`}
            title={isMirror || isReverse ? 'Transforms require re-encoding' : 'Stream copy without re-encoding'}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Lossless Copy</span>
          </button>

          {/* Audio Only Button */}
          <button
            onClick={() => setAudioOnly(!audioOnly)}
            className={`px-3 py-1.5 rounded-xs border transition-colors flex items-center gap-1.5 ${
              audioOnly
                ? 'bg-[#28282A] text-[#FA2D48] border-[#FA2D48] font-semibold'
                : 'bg-[#121212] text-[#8E8E93] hover:text-[#F5F5F7] border-[#2C2C2E]'
            }`}
          >
            <span>Audio Only</span>
          </button>
        </div>

        {/* Right: Format Selector & Primary Export Action */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-[#8E8E93]">
            <span>Format:</span>
            <select
              value={outputExt}
              onChange={(e) => setOutputExt(e.target.value as any)}
              className="bg-[#121212] border border-[#2C2C2E] text-[#F5F5F7] px-2 py-1 rounded-xs outline-none text-xs font-timecode uppercase cursor-pointer"
            >
              {audioOnly ? (
                <>
                  <option value="mp3">MP3 Audio</option>
                  <option value="wav">WAV Lossless</option>
                </>
              ) : (
                <>
                  <option value="mp4">MP4 Video</option>
                  <option value="mkv">MKV Container</option>
                </>
              )}
            </select>
          </div>

          <button
            onClick={handleQueue}
            disabled={justQueued}
            className={`px-4 py-1.5 text-xs font-bold rounded-xs transition-colors flex items-center gap-1.5 shadow-xs ${
              justQueued
                ? 'bg-emerald-600 text-white'
                : 'bg-[#FA2D48] hover:bg-[#E0283F] text-white'
            }`}
          >
            {justQueued ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Queued!</span>
              </>
            ) : (
              <>
                <Scissors className="w-3.5 h-3.5" />
                <span>Process Clip</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
