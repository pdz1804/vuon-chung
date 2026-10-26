// Procedural sound: every effect and the background music are synthesized with WebAudio,
// so the game ships no audio files. Browsers only allow audio after a user gesture, so
// nothing plays until unlockAudio() runs from the first click, key or touch.

export type Sfx = 'till' | 'plant' | 'water' | 'harvest' | 'coin' | 'animal' | 'levelup' | 'letter' | 'click' | 'error';

const MUTE_KEY = 'vuon-chung:audio-muted';
const MUSIC_VOL = 0.22;
const SFX_VOL = 0.45;
// C major pentatonic across two octaves: any note sequence sounds gentle.
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let muted = readMuted();
let night = false;
let musicTimer = 0;
let step = 0;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Private mode: the choice just isn't remembered.
  }
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 1, ctx.currentTime, 0.05);
}

/** Creates the audio graph on the first user gesture and starts the music. */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = MUSIC_VOL;
  musicBus.connect(master);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = SFX_VOL;
  sfxBus.connect(master);
  scheduleMusic();
}

/** Night music is slower and quieter. */
export function setNight(value: boolean) {
  if (value === night) return;
  night = value;
  if (musicBus && ctx) musicBus.gain.setTargetAtTime(value ? MUSIC_VOL * 0.6 : MUSIC_VOL, ctx.currentTime, 0.7);
}

/** One enveloped oscillator note. */
function tone(
  freq: number,
  at: number,
  dur: number,
  opts: { type?: OscillatorType; vol?: number; bus?: GainNode; slide?: number } = {},
) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, at);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, at + dur);
  const vol = opts.vol ?? 0.5;
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(opts.bus ?? sfxBus!);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

/** A short burst of filtered noise (soil, water). */
function noise(at: number, dur: number, filterHz: number, vol = 0.4) {
  if (!ctx || !sfxBus) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterHz;
  const env = ctx.createGain();
  env.gain.value = vol;
  src.connect(filter).connect(env).connect(sfxBus);
  src.start(at);
}

export function playSfx(name: Sfx) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  switch (name) {
    case 'till':
      noise(t, 0.18, 500, 0.6);
      tone(110, t, 0.15, { type: 'triangle', vol: 0.3 });
      break;
    case 'plant':
      tone(392, t, 0.12, { type: 'triangle', vol: 0.3 });
      tone(523.25, t + 0.08, 0.18, { type: 'triangle', vol: 0.3 });
      break;
    case 'water':
      noise(t, 0.35, 2200, 0.35);
      tone(880, t + 0.05, 0.12, { vol: 0.12, slide: 1320 });
      break;
    case 'harvest':
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.07, 0.22, { type: 'triangle', vol: 0.35 }));
      break;
    case 'coin':
      tone(987.77, t, 0.08, { type: 'square', vol: 0.12 });
      tone(1318.5, t + 0.07, 0.22, { type: 'square', vol: 0.12 });
      break;
    case 'animal':
      tone(700, t, 0.09, { type: 'triangle', vol: 0.25, slide: 950 });
      tone(760, t + 0.12, 0.09, { type: 'triangle', vol: 0.25, slide: 1000 });
      break;
    case 'levelup':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.1, 0.35, { type: 'triangle', vol: 0.35 }));
      break;
    case 'letter':
      tone(659.25, t, 0.25, { vol: 0.3 });
      tone(880, t + 0.15, 0.4, { vol: 0.3 });
      break;
    case 'click':
      tone(660, t, 0.05, { type: 'triangle', vol: 0.15 });
      break;
    case 'error':
      tone(220, t, 0.18, { type: 'triangle', vol: 0.25, slide: 180 });
      break;
  }
}

/** Plays a soft pentatonic pluck melody over a low drone, one beat at a time. */
function scheduleMusic() {
  if (!ctx || !musicBus) return;
  const bpm = night ? 68 : 86;
  const beat = 60 / bpm;
  const t = ctx.currentTime + 0.05;
  // Bass on each bar's first beat, melody notes on most beats with gentle rests.
  if (step % 4 === 0) tone(SCALE[step % 8 === 0 ? 0 : 3] / 2, t, beat * 3.5, { vol: 0.25, bus: musicBus });
  if (Math.random() < (night ? 0.45 : 0.7)) {
    const note = SCALE[Math.floor(Math.random() * (night ? 6 : SCALE.length))];
    tone(note, t, beat * 1.6, { type: 'triangle', vol: 0.18, bus: musicBus });
  }
  step++;
  musicTimer = window.setTimeout(scheduleMusic, beat * 1000);
}

/** Stops the music loop (used by tests and when the page is hidden). */
export function stopMusic() {
  clearTimeout(musicTimer);
}

/** Pause music while the tab is hidden; resume when it comes back. */
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) {
    stopMusic();
    void ctx.suspend();
  } else {
    void ctx.resume();
    stopMusic();
    scheduleMusic();
  }
});
