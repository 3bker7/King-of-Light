import type { AudioCue } from './types';

let audioContext: AudioContext | null = null;
let userGestureUnlocked = false;

if (typeof window !== 'undefined') {
  const markUnlocked = () => {
    userGestureUnlocked = true;
    window.removeEventListener('pointerdown', markUnlocked);
    window.removeEventListener('keydown', markUnlocked);
  };
  window.addEventListener('pointerdown', markUnlocked, { passive: true });
  window.addEventListener('keydown', markUnlocked, { passive: true });
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;
    audioContext = new AudioCtx();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startOffset: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine'
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime + startOffset;

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export function playAudioCue(cue: AudioCue, muted: boolean): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  switch (cue) {
    case 'build':
      playTone(ctx, 392, 0, 0.11, 0.08, 'triangle');
      playTone(ctx, 523.25, 0.055, 0.14, 0.08, 'triangle');
      break;
    case 'trade':
      playTone(ctx, 587.33, 0, 0.09, 0.06, 'sine');
      playTone(ctx, 783.99, 0.06, 0.12, 0.06, 'sine');
      break;
    case 'reward':
      playTone(ctx, 523.25, 0, 0.12, 0.08, 'triangle');
      playTone(ctx, 659.25, 0.08, 0.14, 0.08, 'triangle');
      playTone(ctx, 783.99, 0.16, 0.22, 0.09, 'triangle');
      break;
    case 'day':
      playTone(ctx, 440, 0, 0.18, 0.05, 'sine');
      playTone(ctx, 554.37, 0.12, 0.24, 0.05, 'sine');
      break;
    case 'levelUp':
      playTone(ctx, 523.25, 0, 0.14, 0.09, 'triangle');
      playTone(ctx, 659.25, 0.1, 0.14, 0.09, 'triangle');
      playTone(ctx, 783.99, 0.2, 0.16, 0.09, 'triangle');
      playTone(ctx, 1046.5, 0.32, 0.36, 0.1, 'triangle');
      break;
    case 'error':
      playTone(ctx, 220, 0, 0.12, 0.05, 'sawtooth');
      break;
    case 'prayer':
      // Soft harmonic bell chime — only plays after user interaction (never violates browser autoplay)
      if (!userGestureUnlocked && ctx.state !== 'running') {
        return;
      }
      playTone(ctx, 440, 0, 0.65, 0.04, 'sine');
      playTone(ctx, 659.25, 0.12, 0.72, 0.035, 'sine');
      playTone(ctx, 880, 0.24, 0.85, 0.025, 'sine');
      break;
  }
}
