/**
 * The voice-over recorder: the microphone through the window's own browser (Craftora's main window is allowed it
 * without asking, lib.rs `on_permission_request`), recorded as WebM/Opus and saved as .m4a by `save_voice`.
 */

/** An open microphone: its sound for the recorder, and how loud it is right now. */
export interface Microphone {
  stream: MediaStream;
  /** 0 (silence, -60 dB or less) to 1 (full scale), for the level meter. */
  level: () => number;
  close: () => void;
}

/** Voice settings: echo cancelling and noise suppression help a voice recorded with the video playing. */
const VOICE: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** Opens a microphone (the system's default without `deviceId`). Throws a sentence when there's none or it's blocked. */
export async function openMicrophone(deviceId?: string): Promise<Microphone> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...VOICE, deviceId: { exact: deviceId } } : VOICE });
  } catch (err) {
    const name = (err as DOMException)?.name;
    throw new Error(
      name === "NotFoundError" || name === "OverconstrainedError"
        ? "No microphone found. Plug one in, then try again."
        : "Craftora can't use the microphone. In Windows Settings → Privacy & security → Microphone, let desktop apps use it.",
    );
  }
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return {
    stream,
    level: () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const db = 10 * Math.log10(sum / samples.length || 1e-10);
      return Math.min(1, Math.max(0, (db + 60) / 60));
    },
    close: () => {
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
    },
  };
}

/** The microphones on this PC, named once one has been opened (before that the browser hides their names). */
export async function listMicrophones(): Promise<{ id: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

/** Starts recording `stream`; `stop` ends it and gives the sound as one WebM file. */
export function startRecording(stream: MediaStream): { stop: () => Promise<Blob> } {
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined;
  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 });
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) parts.push(e.data);
  };
  // In one-second pieces, so a long take never waits on one huge buffer.
  recorder.start(1000);
  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => resolve(new Blob(parts, { type: recorder.mimeType }));
        recorder.stop();
      }),
  };
}
