import { MediaMetadata } from '../types/media';

export const SAMPLE_STREAMS: MediaMetadata[] = [
  {
    id: 'sample-1',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    title: 'Big Buck Bunny (4K UltraHD Master Demo)',
    uploader: 'Blender Open Animation Studio',
    duration: 596, // ~9 min 56s
    thumbnail: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=800&q=80',
    mediaSourceUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    viewCount: '14,290,140',
    uploadDate: '2024-04-10',
    hasAudio: true,
    hasVideo: true,
    formats: [
      { formatId: 'v-2160', resolution: '4K 2160p', fps: 60, ext: 'mp4', filesizeApprox: '640 MB', vcodec: 'av01.0.12M.08', acodec: 'mp4a.40.2' },
      { formatId: 'v-1080', resolution: '1080p Full HD', fps: 60, ext: 'mp4', filesizeApprox: '185 MB', vcodec: 'avc1.64002a', acodec: 'mp4a.40.2' },
      { formatId: 'v-720', resolution: '720p HD', fps: 30, ext: 'mp4', filesizeApprox: '92 MB', vcodec: 'avc1.4d401f', acodec: 'mp4a.40.2' },
      { formatId: 'a-wav', resolution: 'Studio Master', fps: 0, ext: 'wav', filesizeApprox: '78 MB', vcodec: 'none', acodec: 'pcm_s24le', isAudioOnly: true },
      { formatId: 'a-mp3', resolution: '320kbps Audio', fps: 0, ext: 'mp3', filesizeApprox: '22 MB', vcodec: 'none', acodec: 'mp3', isAudioOnly: true }
    ]
  },
  {
    id: 'sample-2',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    title: 'Elephants Dream (Sci-Fi Mechanical Pipeline)',
    uploader: 'Orange Open Media Project',
    duration: 653,
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80',
    mediaSourceUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    viewCount: '3,840,900',
    uploadDate: '2024-08-15',
    hasAudio: true,
    hasVideo: true,
    formats: [
      { formatId: 'v-1080', resolution: '1080p HD', fps: 60, ext: 'mkv', filesizeApprox: '210 MB', vcodec: 'vp9', acodec: 'opus' },
      { formatId: 'v-720', resolution: '720p HD', fps: 30, ext: 'mp4', filesizeApprox: '110 MB', vcodec: 'h264', acodec: 'aac' },
      { formatId: 'a-flac', resolution: 'Lossless Audio', fps: 0, ext: 'flac', filesizeApprox: '62 MB', vcodec: 'none', acodec: 'flac', isAudioOnly: true }
    ]
  },
  {
    id: 'sample-3',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    title: 'High-Speed Chromatic Flare & Smoke Simulation',
    uploader: 'VFX Foundry Lab',
    duration: 15,
    thumbnail: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=800&q=80',
    mediaSourceUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    viewCount: '912,400',
    uploadDate: '2025-01-22',
    hasAudio: true,
    hasVideo: true,
    formats: [
      { formatId: 'v-1080', resolution: '1080p Pro', fps: 60, ext: 'mp4', filesizeApprox: '18 MB', vcodec: 'h264', acodec: 'aac' },
      { formatId: 'v-720', resolution: '720p', fps: 30, ext: 'mp4', filesizeApprox: '8 MB', vcodec: 'h264', acodec: 'aac' },
      { formatId: 'a-mp3', resolution: '320kbps Audio', fps: 0, ext: 'mp3', filesizeApprox: '2.5 MB', vcodec: 'none', acodec: 'mp3', isAudioOnly: true }
    ]
  }
];
