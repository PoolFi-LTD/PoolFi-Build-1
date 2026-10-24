/**
 * Signing out after a stretch without activity. Taps, typing and scrolling count as
 * activity, shared by every PoolFi tab in this browser. The server enforces the same
 * limit, so this only makes the app react at once.
 */

/** Minutes without activity before a signed-in session ends. Matches the server's SESSION_IDLE_MINUTES. */
export const IDLE_MINUTES = Number(process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES) || 10;
const IDLE_MS = IDLE_MINUTES * 60_000;
const KEY = "poolfi-last-active";
/** Activity is written at most this often, and reported to the server at most this often. */
const WRITE_EVERY_MS = 15_000;
export const PING_EVERY_MS = 2 * 60_000;

let lastWrite = 0;

export function markActive(force = false) {
  const now = Date.now();
  if (!force && now - lastWrite < WRITE_EVERY_MS) return;
  lastWrite = now;
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    // Storage can be off; the server still ends idle sessions.
  }
}

export function lastActive(): number | null {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** True once there's been no activity for longer than the idle limit. */
export function idleTooLong(): boolean {
  const last = lastActive();
  return last !== null && Date.now() - last > IDLE_MS;
}

export function forgetActivity() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Pages anyone can open signed out: an idle sign-out doesn't send people away from these. */
export function isPublicPath(path: string): boolean {
  return /^\/($|signup|forgot|reset-password|p\/|r\/)/.test(path);
}

/** Fired when the server says the session ended, so the app can send people to sign in. */
export const SESSION_EXPIRED_EVENT = "poolfi:session-expired";
