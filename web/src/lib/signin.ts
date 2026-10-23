/** Digits in the codes PoolFi emails (to finish signing in, or to unlock an account). */
export const CODE_LENGTH = 6;

/** Shortest password PoolFi accepts. Set Supabase's "Minimum password length" to the same. */
export const MIN_PASSWORD = 8;

/** A `next` path from the address bar, only if it stays on this site. */
export function safeNextPath(next?: string | null): string {
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/home";
}
