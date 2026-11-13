// Placeholder sound, synthesized with the Web Audio API so the prototype needs no audio files.
// Real recordings replace these later; the function names are what the game calls.

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** Browsers only allow sound after a key press or click, so call this from one. */
export function initAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
  } catch {
    ctx = null; // No audio available; the game still plays.
  }
}

function toot(at: number, seconds: number, volume: number): void {
  if (!ctx) return;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(volume, at + 0.12);
  out.gain.setValueAtTime(volume, at + seconds - 0.25);
  out.gain.linearRampToValueAtTime(0, at + seconds);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  filter.connect(out).connect(ctx.destination);
  // A steam whistle is a chord of slightly sour notes that slides up as the pressure builds.
  for (const hz of [311, 370, 466, 554]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(hz * 0.94, at);
    osc.frequency.linearRampToValueAtTime(hz, at + 0.25);
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + seconds);
  }
}

/** The harbinger: one long blast and one short. */
export function whistle(): void {
  if (!ctx) return;
  const now = ctx.currentTime + 0.05;
  toot(now, 1.7, 0.09);
  toot(now + 2.0, 0.7, 0.09);
}

/** Tramping feet that start faint and slow, and end loud and fast. */
export function footsteps(seconds: number): void {
  if (!ctx || !noise) return;
  const start = ctx.currentTime + 0.05;
  let t = 0;
  while (t < seconds) {
    const progress = t / seconds;
    const thump = ctx.createBufferSource();
    thump.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 140 + progress * 160;
    const gain = ctx.createGain();
    const volume = 0.03 + progress * progress * 0.9;
    gain.gain.setValueAtTime(volume, start + t);
    gain.gain.exponentialRampToValueAtTime(0.001, start + t + 0.11);
    thump.connect(filter).connect(gain).connect(ctx.destination);
    thump.start(start + t, Math.random() * 0.5, 0.12);
    t += 0.46 - progress * 0.3 + Math.random() * 0.04;
  }
}

function blip(fromHz: number, toHz: number, seconds: number, volume: number, type: OscillatorType): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, now);
  osc.frequency.exponentialRampToValueAtTime(toHz, now + seconds);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + seconds);
}

let lastBonk = 0;

/** Bindle meets hobo. Throttled so a 30-hobo brawl doesn't clip the speakers. */
export function bonk(): void {
  if (!ctx || ctx.currentTime - lastBonk < 0.05) return;
  lastBonk = ctx.currentTime;
  blip(240 + Math.random() * 60, 80, 0.12, 0.25, 'square');
}

export function pickup(): void {
  blip(520, 880, 0.08, 0.12, 'triangle');
}

export function munch(): void {
  blip(180, 120, 0.15, 0.2, 'sawtooth');
}
