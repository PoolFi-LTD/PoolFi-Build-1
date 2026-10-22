/**
 * Digits in the emailed sign-in code. It must match Supabase's "Email OTP length"
 * (Authentication → Sign In / Providers → Email), which can be 6 to 10.
 */
export const CODE_LENGTH = Math.min(10, Math.max(6, Number(process.env.NEXT_PUBLIC_SIGNIN_CODE_LENGTH) || 6));

/** The Supabase magic link returns here so the app can route existing and new users correctly. */
export function safeNextPath(next?: string | null): string {
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/home";
}

export function signInRedirectUrl(origin: string, next?: string | null): string {
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", safeNextPath(next));
  return callback.toString();
}
