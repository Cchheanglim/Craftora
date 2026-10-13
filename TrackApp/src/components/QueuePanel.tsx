import React from 'react';
import { 
  Play, 
  Pause, 
  X, 
  Check, 
  Clock, 
  FolderOpen, 
  Copy, 
  Terminal, 
  AlertCircle, 
  Trash2,
  FileVideo,
  FileAudio
} from 'lucide-react';
import { QueueTask } from '../types/media';

interface QueuePanelProps {
  tasks: QueueTask[];
  onPauseTask: (id: string) => void;
  onResumeTask: (id: string) => void;
  onCancelTask: (id: string) => void;
  onClearCompleted: () => void;
  onCopyCommand: (cmd: string) => void;
  onRevealFolder: (path: string) => void;
}

export const QueuePanel: React.FC<QueuePanelProps> = ({
  tasks,
  onPauseTask,
  onResumeTask,
  onCancelTask,
  onClearCompleted,
  onCopyCommand,
  onRevealFolder,
}) => {
  const activeTasks = tasks.filter((t) => t.status !== 'completed');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  return (
    <div className="h-full flex flex-col bg-[#121212] overflow-y-auto p-5 space-y-6">
      {/* Active Tasks Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-[#2C2C2E] pb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F5F5F7]">
              Active Processing Queue ({activeTasks.length})
            </h3>
          </div>
          {completedTasks.length > 0 && (
            <button
              onClick={onClearCompleted}
              className="text-xs text-[#8E8E93] hover:text-[#FA2D48] transition-colors flex items-center gap-1 font-medium"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Completed</span>
            </button>
          )}
        </div>

        {activeTasks.length === 0 ? (
          <div className="p-8 border border-dashed border-[#2C2C2E] rounded-xs text-center text-xs text-[#8E8E93] bg-[#161618]">
            No jobs currently queued. Select formats or trim a segment in the studio above.
          </div>
        ) : (
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <div
                key={task.id}
                className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-xs p-3.5 space-y-2.5 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="p-2 rounded-xs bg-[#28282A] text-[#F5F5F7] shrink-0 mt-0.5">
                      {task.outputExt === 'mp3' || task.outputExt === 'wav' ? (
                        <FileAudio className="w-4 h-4 text-amber-400" />
                      ) : (
                        <FileVideo className="w-4 h-4 text-[#FA2D48]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-[#F5F5F7] truncate leading-tight">
                        {task.title}
                      </h4>
                      {/* Unboxed Metadata with middots */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8E8E93] font-timecode mt-1">
                        <span>{task.outputExt.toUpperCase()}</span>
                        <span aria-hidden="true">·</span>
                        <span>{task.downloadedBytes} of {task.totalBytes}</span>
                        {task.trimRangeText && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#FA2D48]">Range: {task.trimRangeText}</span>
                          </>
                        )}
                        {task.isMirrored && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-400 font-bold">H-FLIP</span>
                          </>
                        )}
                        {task.isReversed && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-400 font-bold">REVERSE</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Task Control Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {task.status === 'paused' ? (
                      <button
                        onClick={() => onResumeTask(task.id)}
                        className="p-1 text-[#8E8E93] hover:text-[#F5F5F7] bg-[#28282A] rounded-xs"
                        title="Resume Job"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => onPauseTask(task.id)}
                        className="p-1 text-[#8E8E93] hover:text-[#F5F5F7] bg-[#28282A] rounded-xs"
                        title="Pause Job"
                      >
                        <Pause className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => onCancelTask(task.id)}
                      className="p-1 text-[#8E8E93] hover:text-rose-400 bg-[#28282A] rounded-xs"
                      title="Cancel Job"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar & Telemetry */}
                <div className="space-y-1">
                  <div className="w-full bg-[#121212] h-1.5 rounded-xs overflow-hidden">
                    <div
                      className="h-full bg-[#FA2D48] transition-all duration-300"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-timecode text-[#8E8E93]">
                    <span>
                      {task.status === 'processing'
                        ? 'FFmpeg Lossless Clipping...'
                        : task.status === 'paused'
                        ? 'Paused'
                        : `Speed: ${task.downloadSpeed}`}
                    </span>
                    <span className="text-[#F5F5F7] font-medium">
                      {task.progress.toFixed(1)}% · ETA: {task.eta}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Completed Output Library Section */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8E8E93] border-b border-[#2C2C2E] pb-2">
          Finished Local Media ({completedTasks.length})
        </h3>

        {completedTasks.length === 0 ? (
          <p className="text-xs text-[#636366] italic">No completed files yet.</p>
        ) : (
          <div className="space-y-2">
            {completedTasks.map((task) => (
              <div
                key={task.id}
                className="bg-[#161618] border border-[#2C2C2E] rounded-xs p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-xs bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 flex items-center justify-center shrink-0">
                    <Check className="w-4 h-4 stroke-[2.5]" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-[#F5F5F7] truncate">
                      {task.title}
                    </h4>
                    <p className="text-[11px] font-timecode text-[#8E8E93] truncate">
                      {task.outputPath}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onRevealFolder(task.outputPath)}
                    className="px-2.5 py-1 bg-[#28282A] hover:bg-[#323235] text-[#F5F5F7] text-xs font-medium rounded-xs border border-[#3A3A3C] transition-colors flex items-center gap-1"
                    title="Reveal in Local Directory"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#8E8E93]" />
                    <span>Reveal</span>
                  </button>

                  <button
                    onClick={() => onCopyCommand(task.commandSnippet)}
                    className="px-2 py-1 bg-[#28282A] hover:bg-[#323235] text-[#8E8E93] hover:text-[#F5F5F7] text-xs font-medium rounded-xs border border-[#3A3A3C] transition-colors"
                    title="Copy FFmpeg / yt-dlp Command"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
