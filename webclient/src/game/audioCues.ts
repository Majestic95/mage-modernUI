/**
 * Audio-cue infrastructure for the game window.
 *
 * <p>Two cues:
 * <ul>
 *   <li>{@code priority} — short ascending chime, triggered when the
 *       LOCAL player gains priority (false → true edge).</li>
 *   <li>{@code turn} — slightly lower descending chime, triggered when
 *       the LOCAL player's turn begins (isActive false → true edge).</li>
 * </ul>
 *
 * <p>Implementation notes:
 * <ul>
 *   <li>Web Audio API — no asset file. Each chime is a short sine-wave
 *       tone with an attack/decay envelope. ~50 lines total, no
 *       network dependency.</li>
 *   <li>The {@link AudioContext} is created lazily on the first play
 *       call. Most browsers require a user-initiated gesture before
 *       a context can {@code resume()} from the suspended state; we
 *       resume on every play, which is a no-op when already running
 *       and elevates a previously-blocked context the moment a play
 *       lands inside a real gesture (e.g. the test-sound button).</li>
 *   <li>Volume is a 0-1 gain multiplier applied to the envelope's
 *       peak. 0 mutes; 1 plays at the synthesized peak (~0.4 in
 *       absolute terms — below clipping).</li>
 * </ul>
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

interface ChimeSpec {
  /** Tone frequency in Hz. */
  freq: number;
  /** Total duration in seconds. */
  duration: number;
  /** Optional second-tone ramp end frequency for an arpeggio feel. */
  freqEnd?: number;
}

const CHIMES: Record<'priority' | 'turn', ChimeSpec> = {
  // Priority — bright two-note ascending arpeggio. ~280ms.
  priority: { freq: 660, freqEnd: 880, duration: 0.28 },
  // Turn — softer single sustained note, lower pitch. ~420ms.
  turn: { freq: 440, duration: 0.42 },
};

/**
 * Play a chime now. Volume is 0-1; values outside that range clamp.
 * Best-effort: silently no-ops when AudioContext is unavailable
 * (SSR, non-interactive context, browser AudioContext blocked).
 */
export function playChime(
  kind: 'priority' | 'turn',
  volume: number,
): void {
  if (!Number.isFinite(volume) || volume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  // Resume if suspended — Chromium policy keeps the context suspended
  // until a user gesture lands. Safe to call when already running.
  if (audio.state === 'suspended') {
    audio.resume().catch(() => {
      // best-effort
    });
  }
  const v = Math.min(1, Math.max(0, volume));
  const spec = CHIMES[kind];
  const peak = 0.4 * v;
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(spec.freq, now);
  if (spec.freqEnd) {
    // Linear ramp across the duration creates a quick arpeggio swell
    // without needing two separate oscillators.
    oscillator.frequency.linearRampToValueAtTime(
      spec.freqEnd,
      now + spec.duration * 0.6,
    );
  }
  const gain = audio.createGain();
  // Attack: ~15ms ramp up to peak so the chime doesn't click. Decay:
  // exponential to near-silence over the remaining duration.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + spec.duration + 0.02);
}
