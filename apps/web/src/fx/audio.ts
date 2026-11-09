/**
 * Battle sounds, synthesised with the Web Audio API (no sample files):
 * rifle cracks, machine-gun bursts timed to the tracers, impacts, close
 * combat and a malfunction clank. Browsers only allow audio after the
 * player has interacted with the page, so the context starts on the
 * first click or key press.
 */
import type { Cue, Pt, WeaponFx } from './timeline';

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let noise: AudioBuffer | undefined;
let enabled = true;
let volume = 0.6;
/** Where the listener is (map units), for stereo panning and falloff. */
let listener: { x: number; y: number; pov: boolean } = { x: 0, y: 0, pov: false };

function ensure(): AudioContext | undefined {
  if (ctx) return ctx;
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return undefined;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Call from a user gesture (click, key) so playback is allowed. */
export function unlockAudio(): void {
  if (!enabled) return;
  const c = ensure();
  if (c && c.state === 'suspended') void c.resume();
}

export function setAudio(on: boolean, vol: number): void {
  enabled = on;
  volume = vol;
  if (master) master.gain.value = on ? vol : 0;
}

export function setListener(x: number, y: number, pov = false): void {
  listener = { x, y, pov };
}

function place(at: Pt): { pan: number; gain: number } {
  const dx = at.x - listener.x;
  const dist = Math.hypot(dx, at.y - listener.y);
  const pan = Math.max(-0.8, Math.min(0.8, dx / 18));
  const gain = listener.pov ? 1 / (1 + dist * 0.12) : 0.85;
  return { pan, gain };
}

function out(c: AudioContext, pan: number): AudioNode {
  if (!c.createStereoPanner) return master!;
  const p = c.createStereoPanner();
  p.pan.value = pan;
  p.connect(master!);
  return p;
}

/** One shot: filtered noise with a fast decay, plus a low thump. */
function crack(c: AudioContext, when: number, pan: number, gain: number, freq: number, decay: number, thump: number): void {
  const src = c.createBufferSource();
  src.buffer = noise!;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0008, when + decay);
  const dest = out(c, pan);
  src.connect(bp).connect(g).connect(dest);
  src.start(when, Math.random() * 0.5, decay + 0.05);
  if (thump > 0) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, when);
    o.frequency.exponentialRampToValueAtTime(50, when + 0.09);
    const og = c.createGain();
    og.gain.setValueAtTime(gain * thump, when);
    og.gain.exponentialRampToValueAtTime(0.0008, when + 0.11);
    o.connect(og).connect(dest);
    o.start(when);
    o.stop(when + 0.12);
  }
}

const VOICE: Record<WeaponFx, { freq: number; decay: number; thump: number; gain: number }> = {
  rifle: { freq: 2200, decay: 0.09, thump: 0.25, gain: 0.5 },
  LMG: { freq: 1700, decay: 0.07, thump: 0.35, gain: 0.45 },
  MMG: { freq: 1400, decay: 0.07, thump: 0.45, gain: 0.45 },
  HMG: { freq: 900, decay: 0.1, thump: 0.7, gain: 0.55 },
};

/** Play the sound for a cue as it starts. */
export function playCue(cue: Cue): void {
  if (!enabled || cue.kind !== 'sound') return;
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime + 0.01;
  const { pan, gain } = place(cue.at);
  switch (cue.sound) {
    case 'burst': {
      const v = VOICE[cue.weapon ?? 'rifle'];
      const n = cue.rounds ?? 1;
      const iv = cue.interval ?? 0.08;
      for (let i = 0; i < n; i++) {
        const jitter = cue.weapon === 'rifle' ? (Math.random() - 0.5) * iv : 0;
        crack(c, now + i * iv + jitter, pan, gain * v.gain * (0.8 + Math.random() * 0.3), v.freq * (0.9 + Math.random() * 0.2), v.decay, v.thump);
      }
      break;
    }
    case 'impact':
      crack(c, now, pan, gain * 0.3, 500, 0.18, 0.4);
      break;
    case 'melee':
      for (let i = 0; i < 7; i++) crack(c, now + i * 0.11 + Math.random() * 0.05, pan, gain * 0.35, 3000 + Math.random() * 1500, 0.04, 0.1);
      break;
    case 'clank':
      crack(c, now, pan, gain * 0.4, 3800, 0.25, 0);
      break;
    case 'whizz': {
      const src = c.createBufferSource();
      src.buffer = noise!;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 6;
      bp.frequency.setValueAtTime(3400, now);
      bp.frequency.exponentialRampToValueAtTime(900, now + 0.22);
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gain * 0.6, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 0.25);
      src.connect(bp).connect(g).connect(out(c, pan));
      src.start(now, 0, 0.3);
      break;
    }
  }
}
