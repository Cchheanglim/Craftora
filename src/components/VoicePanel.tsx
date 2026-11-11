import { useEffect, useRef, useState } from "react";
import { listMicrophones, openMicrophone, startRecording, type Microphone } from "../lib/voice";
import { PanelHead } from "./SoundPanel";
import "./VoicePanel.css";

type Phase = "ready" | "countdown" | "recording" | "saving";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Seconds of the take per `onLevel` call. */
export const LEVEL_STEP = 0.1;

/** Record a voice-over: pick the microphone, watch its level, count in, record while the video plays, stop. */
export function VoicePanel({
  startAt,
  onStart,
  onStop,
  onLevel,
  onBack,
  onClose,
}: {
  /** Where the take will start (the playhead), already formatted, e.g. "00:01:12". */
  startAt: string;
  /** The take begins (after the countdown): App notes the playhead, mutes the preview if `mute`, and plays. */
  onStart: (mute: boolean) => void;
  /** The take ended: App saves it and puts it on the timeline where it started. Rejects with an Error whose message is a sentence. */
  onStop: (take: Blob) => Promise<void>;
  /** While recording, every LEVEL_STEP seconds of the take: the microphone's loudest level (0–1) in that time. */
  onLevel?: (level: number) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [count, setCount] = useState(3);
  const [deviceId, setDeviceId] = useState("");
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
  const [mute, setMute] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [micOpen, setMicOpen] = useState(false);

  const micRef = useRef<Microphone | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<{ stop: () => Promise<Blob> } | null>(null);
  const countdownRef = useRef<number | undefined>(undefined);
  const clockRef = useRef<number | undefined>(undefined);
  // The take being recorded: when it began, how many levels were sent, the loudest level since the last one.
  const takeRef = useRef<{ startedAt: number; sent: number; peak: number } | null>(null);
  // The latest callbacks, for the countdown's timer, the level meter and the unmount cleanup.
  const props = useRef({ onStart, onStop, onLevel });
  props.current = { onStart, onStop, onLevel };

  // Declared before the microphone effect so its cleanup runs first on unmount: the recorder must stop before the
  // microphone's tracks do, or MediaRecorder goes inactive on its own and `stop()` never resolves.
  useEffect(
    () => () => {
      window.clearInterval(countdownRef.current);
      window.clearInterval(clockRef.current);
      const recorder = recorderRef.current;
      recorderRef.current = null;
      takeRef.current = null;
      // The user switched tabs mid-take: keep it anyway.
      if (recorder) void recorder.stop().then((take) => props.current.onStop(take));
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setError(null);
    openMicrophone(deviceId || undefined)
      .then(async (mic) => {
        if (cancelled) {
          mic.close();
          return;
        }
        micRef.current = mic;
        setMicOpen(true);
        const list = await listMicrophones();
        if (!cancelled) setMics(list);
      })
      .catch((err) => {
        if (!cancelled) setError(message(err));
      });
    return () => {
      cancelled = true;
      micRef.current?.close();
      micRef.current = null;
      setMicOpen(false);
    };
  }, [deviceId]);

  useEffect(() => {
    const bar = barRef.current;
    if (!micOpen || !bar) return;
    let frame = 0;
    const tick = () => {
      const mic = micRef.current;
      const level = mic?.level() ?? 0;
      bar.style.width = `${level * 100}%`;
      const take = takeRef.current;
      if (take) {
        take.peak = Math.max(take.peak, level);
        // A loop: after frames the window skipped it catches up, so the levels keep pace with the take.
        const due = Math.floor((Date.now() - take.startedAt) / (LEVEL_STEP * 1000));
        if (take.sent < due) {
          for (; take.sent < due; take.sent++) props.current.onLevel?.(take.peak);
          take.peak = 0;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      bar.style.width = "0";
    };
  }, [micOpen]);

  function begin() {
    const mic = micRef.current;
    if (!mic) {
      setPhase("ready");
      return;
    }
    try {
      recorderRef.current = startRecording(mic.stream);
    } catch (err) {
      setError(message(err));
      setPhase("ready");
      return;
    }
    // Only once it records: the video plays (and goes quiet) for a take that's really being made.
    props.current.onStart(mute);
    const startedAt = Date.now();
    takeRef.current = { startedAt, sent: 0, peak: 0 };
    setSeconds(0);
    setPhase("recording");
    clockRef.current = window.setInterval(() => setSeconds((Date.now() - startedAt) / 1000), 250);
  }

  function record() {
    setError(null);
    setCount(3);
    setPhase("countdown");
    let n = 3;
    countdownRef.current = window.setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCount(n);
        return;
      }
      window.clearInterval(countdownRef.current);
      countdownRef.current = undefined;
      begin();
    }, 1000);
  }

  function cancel() {
    window.clearInterval(countdownRef.current);
    countdownRef.current = undefined;
    setPhase("ready");
  }

  async function stop() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    takeRef.current = null;
    window.clearInterval(clockRef.current);
    clockRef.current = undefined;
    if (!recorder) {
      setPhase("ready");
      return;
    }
    setPhase("saving");
    try {
      await props.current.onStop(await recorder.stop());
    } catch (err) {
      setError(message(err));
    } finally {
      setPhase("ready");
    }
  }

  const time = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const busy = phase !== "ready";

  return (
    <section className="voice-panel" aria-labelledby="voice-title">
      <PanelHead
        id="voice-title"
        title="Voice-over"
        sub={phase === "recording" ? "Recording…" : `Starts at ${startAt}`}
        onBack={onBack}
        onClose={onClose}
      />
      <div className="insp__field">
        <label htmlFor="voice-mic">Microphone</label>
        <select id="voice-mic" className="field" value={deviceId} disabled={busy} onChange={(e) => setDeviceId(e.target.value)}>
          <option value="">Windows default</option>
          {mics.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="voice__meter" aria-hidden="true">
        <div ref={barRef} className="voice__level" />
      </div>
      <label className="option">
        <input type="checkbox" checked={mute} disabled={busy} onChange={(e) => setMute(e.target.checked)} />
        <span>Mute the video while recording</span>
      </label>
      <p className="voice__hint">Stops the speakers' sound from getting into the microphone. Headphones work too.</p>
      {phase === "countdown" && <div className="voice__count mono">{count}</div>}
      {phase === "recording" && (
        <div className="voice__count mono">
          <span className="voice__dot" aria-hidden="true" />
          {time}
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary voice__record"
        disabled={phase === "saving" || (phase === "ready" && !micOpen)}
        onClick={phase === "countdown" ? cancel : phase === "recording" ? () => void stop() : record}
      >
        {phase === "countdown" ? "Cancel" : phase === "recording" ? "Stop" : phase === "saving" ? "Saving…" : "Record"}
      </button>
      {error && (
        <p className="voice__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
