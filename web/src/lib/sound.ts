/* The prototype's sound effects: short tones made in the browser, no audio files.
   They're on by default and can be turned off in Settings (remembered on this device).
   Browsers only allow sound after the first tap or click, so anything before that is silent. */

const KEY = "poolfi-sound";
let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage can be off; the choice just won't be remembered.
  }
  if (on) sound.coin();
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** One tone sliding from f1 to f2 Hz over d seconds. */
function tone(f1: number, f2: number, d: number, type: OscillatorType = "sine", volume = 0.13, delay = 0) {
  if (!soundOn()) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f1, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + d);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + d + 0.03);
}

/** A short buzz on phones that support it (browsers only allow it after a tap). */
export function haptic(pattern: number | number[]) {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  } catch {
    // Not every browser allows it.
  }
}

export const sound = {
  /** Any button or link */
  tap: () => tone(420, 640, 0.06, "sine", 0.07),
  /** Choosing something: a tile, chip, option or toggle */
  pick: () => tone(520, 880, 0.09, "triangle", 0.09),
  /** A coin on its way into the pool */
  coin: () => {
    tone(1320, 1300, 0.08, "triangle", 0.08);
    tone(1980, 1960, 0.2, "triangle", 0.06, 0.06);
  },
  /** The coin landing in the water */
  plop: () => tone(560, 160, 0.15, "sine", 0.16),
  /** That didn't work */
  nope: () => tone(240, 150, 0.18, "square", 0.04),
  /** Something sent: reminders, invites */
  send: () => tone(300, 1200, 0.25, "sine", 0.09),
  /** A small win: a badge, an approval, money landing */
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.24, "triangle", 0.1, i * 0.085)),
  /** The big moments */
  big: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.3, "triangle", 0.1, i * 0.08)),
};
