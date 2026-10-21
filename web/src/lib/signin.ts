/**
 * Digits in the emailed sign-in code. It must match Supabase's "Email OTP length"
 * (Authentication → Sign In / Providers → Email), which can be 6 to 10.
 */
export const CODE_LENGTH = Math.min(10, Math.max(6, Number(process.env.NEXT_PUBLIC_SIGNIN_CODE_LENGTH) || 6));
