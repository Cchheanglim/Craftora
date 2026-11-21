/**
 * Voice changer (the clip's Voice tab): the voices, and the preview playing a clip's sound through one. The export makes
 * the same voices with FFmpeg (project.rs `voice_filter`): the same filters and amounts, except the pitch, which the
 * export shifts with Rubber Band (cleaner) and the preview with a small grain shifter (`PITCH_WORKLET`).
 */
import type { IconName } from "../components/Icon";

export type VoiceId = "chipmunk" | "deep" | "monster" | "robot" | "alien" | "echo" | "radio" | "megaphone";

export const VOICES: { id: VoiceId; label: string; icon: IconName }[] = [
  { id: "chipmunk", label: "Chipmunk", icon: "chevronUp" },
  { id: "deep", label: "Deep", icon: "chevronDown" },
  { id: "monster", label: "Monster", icon: "alert" },
  { id: "robot", label: "Robot", icon: "robot" },
  { id: "alien", label: "Alien", icon: "sparkle" },
  { id: "echo", label: "Cave", icon: "volume" },
  { id: "radio", label: "Radio", icon: "radio" },
  { id: "megaphone", label: "Megaphone", icon: "megaphone" },
];

/** Semitones each voice shifts the pitch by (project.rs `voice_filter` has the same). */
const SHIFT: Partial<Record<VoiceId, number>> = { chipmunk: 7, deep: -5, monster: -9, alien: 4 };

/** The whole shift for a voice plus the Pitch slider's extra semitones (−12…12). */
export const totalShift = (voice: VoiceId | undefined, pitch = 0) => (voice ? (SHIFT[voice] ?? 0) : 0) + Math.max(-12, Math.min(12, pitch));

/**
 * Shifts the pitch without changing the speed: two read heads move through a short delay line, faster or slower than
 * it's written, each faded in and out as it wraps around, the two half a window apart so the fades add up to one.
 */
const PITCH_WORKLET = `
class Pitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: "ratio", defaultValue: 1, minValue: 0.25, maxValue: 4 }]; }
  constructor() { super(); this.size = 16384; this.win = 2048; this.buf = []; this.w = 0; this.phase = 0; }
  read(b, at) {
    const n = this.size; const p = ((at % n) + n) % n; const i = Math.floor(p); const f = p - i;
    return b[i] * (1 - f) + b[(i + 1) % n] * f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0], ratio = params.ratio[0], win = this.win;
    while (this.buf.length < output.length) this.buf.push(new Float32Array(this.size));
    const frames = output[0] ? output[0].length : 0;
    for (let i = 0; i < frames; i++) {
      this.phase += (1 - ratio) / win;
      this.phase -= Math.floor(this.phase);
      const p2 = (this.phase + 0.5) % 1;
      const g1 = 1 - Math.abs(2 * this.phase - 1), g2 = 1 - Math.abs(2 * p2 - 1);
      for (let c = 0; c < output.length; c++) {
        const b = this.buf[c];
        b[this.w] = input[c] ? input[c][i] : input[0] ? input[0][i] : 0;
        output[c][i] = this.read(b, this.w - this.phase * win) * g1 + this.read(b, this.w - p2 * win) * g2;
      }
      this.w = (this.w + 1) % this.size;
    }
    return true;
  }
}
registerProcessor("craftora-pitch", Pitch);
`;

let context: AudioContext | undefined;
let worklet: Promise<void> | undefined;

function audio(): AudioContext {
  context ??= new AudioContext({ latencyHint: "playback" });
  return context;
}

function pitchReady(ctx: AudioContext): Promise<void> {
  worklet ??= ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([PITCH_WORKLET], { type: "text/javascript" })));
  return worklet;
}

/** Soft clipping like FFmpeg's `asoftclip=type=tanh`. */
function tanhCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 4);
  return curve;
}

/** A voice's nodes between `input` and `output` (FFmpeg's order: pitch first, then the rest). */
function build(ctx: AudioContext, voice: VoiceId | undefined, pitch: number, input: AudioNode, output: AudioNode): AudioNode[] {
  const made: AudioNode[] = [];
  let at = input;
  const then = <T extends AudioNode>(node: T): T => {
    at.connect(node);
    made.push(node);
    at = node;
    return node;
  };
  const gain = (value: number) => then(new GainNode(ctx, { gain: value }));
  const filter = (type: BiquadFilterType, frequency: number) => then(new BiquadFilterNode(ctx, { type, frequency, Q: Math.SQRT1_2 }));
  // The curve spans −4…4 (FFmpeg clips the sample itself): louder sound goes in scaled down, and back up after.
  const clip = (drive: number, after: number) => {
    gain(drive / 4);
    then(new WaveShaperNode(ctx, { curve: tanhCurve() }));
    gain(after);
  };

  const shift = totalShift(voice, pitch);
  if (Math.abs(shift) > 0.01) {
    const node = then(new AudioWorkletNode(ctx, "craftora-pitch", { outputChannelCount: [2] }));
    node.parameters.get("ratio")!.value = 2 ** (shift / 12);
  }
  switch (voice) {
    case "monster":
      filter("lowpass", 2200);
      clip(2, 1);
      break;
    case "robot": {
      // A ring modulator: the sound times a 50 Hz wave (aeval `val(ch)*sin(2*PI*50*t)`).
      const ring = then(new GainNode(ctx, { gain: 0 }));
      const wave = new OscillatorNode(ctx, { frequency: 50 });
      wave.connect(ring.gain);
      wave.start();
      made.push(wave);
      break;
    }
    case "alien": {
      // FFmpeg's vibrato (6 Hz): a short delay whose length wobbles.
      const delay = then(new DelayNode(ctx, { delayTime: 0.004, maxDelayTime: 0.02 }));
      const wobble = new OscillatorNode(ctx, { frequency: 6 });
      const depth = new GainNode(ctx, { gain: 0.002 });
      wobble.connect(depth).connect(delay.delayTime);
      wobble.start();
      made.push(wobble, depth);
      break;
    }
    case "echo": {
      // aecho=0.8:0.8:250|500:0.45|0.3: the sound plus two repeats, all × 0.8.
      const mix = new GainNode(ctx, { gain: 0.8 });
      const dry = new GainNode(ctx, { gain: 0.8 });
      at.connect(dry).connect(mix);
      for (const [time, level] of [[0.25, 0.45], [0.5, 0.3]]) {
        const delay = new DelayNode(ctx, { delayTime: time, maxDelayTime: 1 });
        const decay = new GainNode(ctx, { gain: level });
        at.connect(delay).connect(decay).connect(mix);
        made.push(delay, decay);
      }
      made.push(dry, mix);
      at = mix;
      break;
    }
    case "radio":
      filter("highpass", 400);
      filter("lowpass", 3200);
      clip(2, 0.7);
      break;
    case "megaphone":
      filter("highpass", 700);
      filter("lowpass", 3500);
      clip(8, 0.5);
      break;
  }
  at.connect(output);
  return made;
}

interface Route {
  source: MediaElementAudioSourceNode;
  input: GainNode;
  output: GainNode;
  nodes: AudioNode[];
  key: string;
}
const routes = new WeakMap<HTMLMediaElement, Route>();

/**
 * Plays `el`'s sound through `voice` (and `pitch` extra semitones). An element is only taken into Web Audio once it
 * gets a voice: from then on its sound always goes through here (a plain pass-through after the voice is removed).
 */
export async function setVoice(el: HTMLMediaElement, voice: VoiceId | undefined, pitch = 0): Promise<void> {
  const key = `${voice ?? ""}:${pitch}`;
  let route = routes.get(el);
  if (!route && !voice && !pitch) return;
  if (route?.key === key) return;
  const ctx = audio();
  await pitchReady(ctx);
  route = routes.get(el);
  if (!route) {
    const source = ctx.createMediaElementSource(el);
    const input = new GainNode(ctx);
    const output = new GainNode(ctx);
    source.connect(input);
    output.connect(ctx.destination);
    route = { source, input, output, nodes: [], key: "" };
    routes.set(el, route);
  }
  route.input.disconnect();
  for (const node of route.nodes) {
    if (node instanceof OscillatorNode) node.stop();
    node.disconnect();
  }
  route.nodes = build(ctx, voice, pitch, route.input, route.output);
  route.key = key;
}

/** Web Audio starts suspended until the page has been used; playing resumes it. */
export function wakeVoices() {
  if (context?.state === "suspended") void context.resume();
}
