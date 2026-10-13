import React, { useState, useEffect } from 'react';
import { WindowHeader } from './components/WindowHeader';
import { Sidebar, SidebarTab } from './components/Sidebar';
import { StreamInspector } from './components/StreamInspector';
import { TimelineTrimmer } from './components/TimelineTrimmer';
import { QueuePanel } from './components/QueuePanel';
import { HistoryView } from './components/HistoryView';
import { SidecarsDiagnosticView } from './components/SidecarsDiagnosticView';
import { CliInspectorModal } from './components/CliInspectorModal';

import { SAMPLE_STREAMS } from './data/samples';
import { MediaMetadata, TrimConfig, QueueTask, StreamFormatOption, HistoryLogEntry } from './types/media';
import { formatTimecode, buildExecutableCommand } from './utils/formatters';
import { HistoryStorage } from './services/storage';
import { Check } from 'lucide-react';

export const App: React.FC = () => {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<SidebarTab>('trimmer');
  const [currentUrl, setCurrentUrl] = useState<string>(SAMPLE_STREAMS[0].url);
  const [activeMetadata, setActiveMetadata] = useState<MediaMetadata>(SAMPLE_STREAMS[0]);
  const [isInspecting, setIsInspecting] = useState(false);
  const [selectedFormatId, setSelectedFormatId] = useState<string>('v-1080');

  // Split Pane & Modal State
  const [isCliModalOpen, setIsCliModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Persistent History State
  const [history, setHistory] = useState<HistoryLogEntry[]>(() => HistoryStorage.load());

  // Active Queue State
  const [tasks, setTasks] = useState<QueueTask[]>([
    {
      id: 'task-101',
      title: 'Big Buck Bunny (Lossless Clip 00:00:15 - 00:01:45)',
      sourceUrl: SAMPLE_STREAMS[0].url,
      status: 'downloading',
      progress: 68.4,
      downloadSpeed: '22.8 MB/s',
      eta: '00:06',
      downloadedBytes: '94 MB',
      totalBytes: '138 MB',
      outputPath: 'C:/Users/User/Videos/Craftora/BigBuckBunny_clip_01.mp4',
      outputExt: 'mp4',
      isTrimmed: true,
      trimRangeText: '00:00:15 - 00:01:45',
      startTime: 15,
      endTime: 105,
      isLossless: true,
      commandSnippet: buildExecutableCommand(SAMPLE_STREAMS[0].url, 15, 105, true, false, false, 'mp4', false),
      startedAt: '2 mins ago',
    },
    {
      id: 'task-100',
      title: 'Elephants Dream (Soundtrack Master Audio)',
      sourceUrl: SAMPLE_STREAMS[1].url,
      status: 'completed',
      progress: 100,
      downloadSpeed: '0 MB/s',
      eta: 'Done',
      downloadedBytes: '62 MB',
      totalBytes: '62 MB',
      outputPath: 'C:/Users/User/Music/Craftora/ElephantsDream_Master.flac',
      outputExt: 'flac',
      isTrimmed: false,
      commandSnippet: 'yt-dlp -x --audio-format flac "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"',
      startedAt: '12 mins ago',
    }
  ]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Inspect stream handler
  const handleInspectUrl = (url: string) => {
    setIsInspecting(true);
    setTimeout(() => {
      const match = SAMPLE_STREAMS.find((s) => s.url.toLowerCase() === url.toLowerCase());
      if (match) {
        setActiveMetadata(match);
      } else {
        const dynamicMeta: MediaMetadata = {
          id: 'stream-' + Date.now(),
          url,
          title: `Stream Capture: ${url.replace(/https?:\/\//, '').slice(0, 42)}`,
          uploader: 'External Web Media Stream',
          duration: 380,
          thumbnail: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=800&q=80',
          mediaSourceUrl: SAMPLE_STREAMS[0].mediaSourceUrl,
          viewCount: '184,000',
          uploadDate: '2025-02-10',
          hasAudio: true,
          hasVideo: true,
          formats: [
            { formatId: 'v-1080', resolution: '1080p Full HD', fps: 60, ext: 'mp4', filesizeApprox: '142 MB', vcodec: 'h264', acodec: 'aac' },
            { formatId: 'v-720', resolution: '720p HD', fps: 30, ext: 'mp4', filesizeApprox: '68 MB', vcodec: 'h264', acodec: 'aac' },
            { formatId: 'a-mp3', resolution: '320kbps Audio', fps: 0, ext: 'mp3', filesizeApprox: '14 MB', vcodec: 'none', acodec: 'mp3', isAudioOnly: true }
          ]
        };
        setActiveMetadata(dynamicMeta);
      }
      setIsInspecting(false);
      showToast('Metadata loaded.');
    }, 500);
  };

  // Add trim job to queue and record in persistent history
  const handleAddTrimToQueue = (config: TrimConfig) => {
    const duration = config.endTime - config.startTime;
    const taskTitle = `${activeMetadata.title.slice(0, 32)} [${formatTimecode(config.startTime, false)} - ${formatTimecode(config.endTime, false)}]`;
    const outputPath = `C:/Users/User/Videos/Craftora/${activeMetadata.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}_${Date.now()}.${config.outputExt}`;

    const generatedCommand = buildExecutableCommand(
      activeMetadata.url,
      config.startTime,
      config.endTime,
      config.isLossless,
      config.mirror,
      config.reverse,
      config.outputExt,
      config.audioOnly
    );

    const newTask: QueueTask = {
      id: 'task-' + Date.now(),
      title: taskTitle,
      sourceUrl: activeMetadata.url,
      status: 'downloading',
      progress: 0,
      downloadSpeed: '24.5 MB/s',
      eta: '00:15',
      downloadedBytes: '0 MB',
      totalBytes: `${Math.round(duration * 0.4)} MB`,
      outputPath,
      outputExt: config.outputExt,
      isTrimmed: true,
      trimRangeText: `${formatTimecode(config.startTime, false)} - ${formatTimecode(config.endTime, false)}`,
      startTime: config.startTime,
      endTime: config.endTime,
      isMirrored: config.mirror,
      isReversed: config.reverse,
      isLossless: config.isLossless,
      commandSnippet: generatedCommand,
      startedAt: 'Just now',
    };

    setTasks((prev) => [newTask, ...prev]);

    // Persist to history storage
    const now = new Date();
    const historyEntry: HistoryLogEntry = {
      id: 'hist-' + Date.now(),
      title: taskTitle,
      sourceUrl: activeMetadata.url,
      outputPath,
      outputExt: config.outputExt,
      fileSize: `${Math.round(duration * 0.4)} MB`,
      durationText: formatTimecode(duration, false),
      isTrimmed: true,
      startTime: config.startTime,
      endTime: config.endTime,
      isMirrored: config.mirror,
      isReversed: config.reverse,
      isLossless: config.isLossless,
      audioOnly: config.audioOnly,
      commandSnippet: generatedCommand,
      completedAt: `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
      timestamp: Date.now(),
      rerunCount: 0,
    };

    const updatedHistory = HistoryStorage.record(historyEntry);
    setHistory(updatedHistory);
    showToast(`Clip added to queue.`);
  };

  // Quick download direct format
  const handleQuickDownload = (format: StreamFormatOption) => {
    const outputPath = `C:/Users/User/Downloads/Craftora/${activeMetadata.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}.${format.ext}`;
    const generatedCmd = `yt-dlp -f "${format.formatId}" "${activeMetadata.url}"`;

    const newTask: QueueTask = {
      id: 'task-' + Date.now(),
      title: `${activeMetadata.title} (${format.resolution})`,
      sourceUrl: activeMetadata.url,
      status: 'downloading',
      progress: 0,
      downloadSpeed: '28.2 MB/s',
      eta: '00:18',
      downloadedBytes: '0 MB',
      totalBytes: format.filesizeApprox,
      outputPath,
      outputExt: format.ext,
      isTrimmed: false,
      commandSnippet: generatedCmd,
      startedAt: 'Just now',
    };

    setTasks((prev) => [newTask, ...prev]);

    const now = new Date();
    const historyEntry: HistoryLogEntry = {
      id: 'hist-' + Date.now(),
      title: `${activeMetadata.title} (${format.resolution})`,
      sourceUrl: activeMetadata.url,
      outputPath,
      outputExt: format.ext,
      fileSize: format.filesizeApprox,
      durationText: formatTimecode(activeMetadata.duration, false),
      isTrimmed: false,
      audioOnly: !!format.isAudioOnly,
      commandSnippet: generatedCmd,
      completedAt: `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
      timestamp: Date.now(),
      rerunCount: 0,
    };

    const updatedHistory = HistoryStorage.record(historyEntry);
    setHistory(updatedHistory);
    showToast(`Download started: ${format.resolution}`);
  };

  // Re-run job from History
  const handleRerunJob = (entry: HistoryLogEntry) => {
    const updatedHistory = HistoryStorage.incrementRerun(entry.id);
    setHistory(updatedHistory);

    const rerunTask: QueueTask = {
      id: 'task-rerun-' + Date.now(),
      title: `${entry.title} (Re-run)`,
      sourceUrl: entry.sourceUrl,
      status: 'downloading',
      progress: 0,
      downloadSpeed: '26.8 MB/s',
      eta: '00:14',
      downloadedBytes: '0 MB',
      totalBytes: entry.fileSize,
      outputPath: entry.outputPath.replace(/\.([^.]+)$/, `_rerun_${Date.now()}.$1`),
      outputExt: entry.outputExt,
      isTrimmed: entry.isTrimmed,
      trimRangeText: entry.startTime !== undefined && entry.endTime !== undefined 
        ? `${formatTimecode(entry.startTime, false)} - ${formatTimecode(entry.endTime, false)}` 
        : undefined,
      startTime: entry.startTime,
      endTime: entry.endTime,
      isMirrored: entry.isMirrored,
      isReversed: entry.isReversed,
      isLossless: entry.isLossless,
      commandSnippet: entry.commandSnippet,
      startedAt: 'Just now',
    };

    setTasks((prev) => [rerunTask, ...prev]);
    setActiveTab('queue');
    showToast(`Re-running job: "${entry.title}"`);
  };

  const handleLoadJobIntoTrimmer = (entry: HistoryLogEntry) => {
    setCurrentUrl(entry.sourceUrl);
    const match = SAMPLE_STREAMS.find((s) => s.url.toLowerCase() === entry.sourceUrl.toLowerCase());
    if (match) {
      setActiveMetadata(match);
    }
    setActiveTab('trimmer');
    showToast(`Loaded "${entry.title}" into trimmer.`);
  };

  const handleDeleteHistoryEntry = (id: string) => {
    const updated = HistoryStorage.delete(id);
    setHistory(updated);
    showToast('Log deleted.');
  };

  const handleClearHistory = () => {
    HistoryStorage.clear();
    setHistory([]);
    showToast('Logs cleared.');
  };

  const handlePauseTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: 'paused' } : t))
    );
  };

  const handleResumeTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: 'downloading' } : t))
    );
  };

  const handleCancelTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    showToast('Task cancelled.');
  };

  const handleClearCompleted = () => {
    setTasks((prev) => prev.filter((t) => t.status !== 'completed'));
    showToast('Cleared completed tasks.');
  };

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    showToast('CLI command copied.');
  };

  const handleRevealFolder = (path: string) => {
    showToast(`Folder opened: ${path}`);
  };

  // Real-time queue ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.status === 'downloading') {
            const nextProgress = t.progress + Math.random() * 4.5 + 2.5;
            if (nextProgress >= 100) {
              return {
                ...t,
                progress: 100,
                status: 'completed',
                eta: 'Done',
                downloadSpeed: '0 MB/s',
                downloadedBytes: t.totalBytes,
              };
            }
            const approxDown = Math.round((nextProgress / 100) * (parseInt(t.totalBytes) || 120));
            return {
              ...t,
              progress: nextProgress,
              downloadedBytes: `${approxDown} MB`,
              eta: `00:0${Math.max(1, Math.round((100 - nextProgress) / 5))}`,
            };
          }
          return t;
        })
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const activeQueueCount = tasks.filter((t) => t.status !== 'completed').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  const currentSnippet = buildExecutableCommand(
    activeMetadata.url,
    0,
    activeMetadata.duration,
    true,
    false,
    false,
    'mp4',
    false
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-[#121212] text-[#F5F5F7] overflow-hidden select-none">
      {/* Top Window Titlebar & URL Input */}
      <WindowHeader
        currentUrl={currentUrl}
        onUrlChange={setCurrentUrl}
        onInspect={handleInspectUrl}
        isInspecting={isInspecting}
        onSelectSample={(s) => {
          setCurrentUrl(s.url);
          setActiveMetadata(s);
          showToast(`Loaded: ${s.title}`);
        }}
        onToggleCliInspector={() => setIsCliModalOpen(true)}
        activeQueueCount={activeQueueCount}
      />

      {/* Main Workspace: Left Sidebar + Center Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          queueCount={activeQueueCount}
          completedCount={completedCount}
          historyCount={history.length}
        />

        {/* Center Main Stage (Clean, Spacious, Uncluttered) */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#121212] overflow-hidden">
          {activeTab === 'inspector' && (
            <StreamInspector
              metadata={activeMetadata}
              onOpenTrimmer={() => setActiveTab('trimmer')}
              onQuickDownload={handleQuickDownload}
              selectedFormatId={selectedFormatId}
              onSelectFormatId={setSelectedFormatId}
            />
          )}

          {activeTab === 'trimmer' && (
            <TimelineTrimmer
              metadata={activeMetadata}
              onAddToQueue={handleAddTrimToQueue}
            />
          )}

          {activeTab === 'queue' && (
            <QueuePanel
              tasks={tasks}
              onPauseTask={handlePauseTask}
              onResumeTask={handleResumeTask}
              onCancelTask={handleCancelTask}
              onClearCompleted={handleClearCompleted}
              onCopyCommand={handleCopyCommand}
              onRevealFolder={handleRevealFolder}
            />
          )}

          {activeTab === 'library' && (
            <QueuePanel
              tasks={tasks}
              onPauseTask={handlePauseTask}
              onResumeTask={handleResumeTask}
              onCancelTask={handleCancelTask}
              onClearCompleted={handleClearCompleted}
              onCopyCommand={handleCopyCommand}
              onRevealFolder={handleRevealFolder}
            />
          )}

          {activeTab === 'history' && (
            <HistoryView
              history={history}
              onRerunJob={handleRerunJob}
              onLoadIntoTrimmer={handleLoadJobIntoTrimmer}
              onDeleteEntry={handleDeleteHistoryEntry}
              onClearHistory={handleClearHistory}
              onCopyCommand={handleCopyCommand}
              onRevealFolder={handleRevealFolder}
            />
          )}

          {activeTab === 'sidecars' && (
            <SidecarsDiagnosticView />
          )}
        </main>
      </div>

      {/* CLI Inspector Modal */}
      <CliInspectorModal
        isOpen={isCliModalOpen}
        onClose={() => setIsCliModalOpen(false)}
        commandSnippet={currentSnippet}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#1C1C1E] text-[#F5F5F7] border border-[#3A3A3C] px-3.5 py-2 rounded-xs shadow-2xl flex items-center gap-2 text-xs font-medium animate-in fade-in slide-in-from-bottom-2 duration-150">
          <Check className="w-3.5 h-3.5 text-[#FA2D48]" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export default App;
