/**
 * The real PoolFi API: sign-in with Supabase (a password) and then a 6-digit code PoolFi emails,
 * everything else from the server at /api/v1/app, signed in with the Supabase session.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PoolFiApi } from "./api";
import { ApiError } from "./errors";
import type { Receipt, User } from "./types";

let supabaseClient: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new ApiError("not_configured", "Sign-in isn't set up yet.");
    // Supabase marks a reset link with #…type=recovery and clears the address once it has read it,
    // so note it now, before the client starts reading it.
    const link = typeof window !== "undefined" ? new URLSearchParams(window.location.hash.slice(1)) : null;
    const fromResetLink = link?.get("type") === "recovery";
    const linkToken = fromResetLink ? link?.get("access_token") : null;
    resetLinkSession = linkToken ? (tokenClaims(linkToken).session_id ?? null) : null;
    supabaseClient = createClient(url, key, {
      // The emailed code is the main way in; a sign-in link (if Supabase's email has one) works too.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    // Remember which session the reset link opened: only that one may set a new password.
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || (fromResetLink && event === "SIGNED_IN"))) rememberRecovery(session.access_token);
    });
  }
  return supabaseClient;
}

const RECOVERY_KEY = "poolfi-recovery-session";

function rememberRecovery(token: string | null) {
  try {
    if (token) sessionStorage.setItem(RECOVERY_KEY, tokenClaims(token).session_id ?? "");
    else sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    // Storage can be off; the reset then has to finish in this page load.
  }
  recoverySession = token ? (tokenClaims(token).session_id ?? null) : null;
}

let recoverySession: string | null = null;
/** The session named in the reset link this page was opened from, if it was. */
let resetLinkSession: string | null = null;

function rememberedRecovery(): string | null {
  if (recoverySession) return recoverySession;
  try {
    return sessionStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}

/** Supabase's sign-in errors, in words the screens can show. */
function authError(error: { message: string; code?: string; status?: number }): ApiError {
  const code = error.code ?? "";
  if (code === "user_already_exists" || /already registered/i.test(error.message)) {
    return new ApiError("account_exists", "There's already an account with this email. Sign in instead.");
  }
  if (code === "weak_password") {
    return new ApiError("weak_password", "Choose a stronger password: at least 8 characters, not one that's easy to guess.");
  }
  if (code === "validation_failed" || code === "email_address_invalid") {
    return new ApiError("invalid_address", "That email doesn't look right. Check it and try again.");
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error.status === 429) {
    return new ApiError("too_many_tries", "Too many tries. Wait a minute and try again.");
  }
  if (code === "same_password") return new ApiError("same_password", "That's your current password. Choose a new one.");
  return new ApiError(code || "auth_failed", error.message || "Sign-in didn't work. Try again.");
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown, signedIn = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (signedIn) {
    const token = await accessToken();
    if (!token) throw new ApiError("unauthenticated", "Sign in to continue.");
    headers.authorization = `Bearer ${token}`;
  }
  let response: Response;
  try {
    response = await fetch(path.startsWith("/api/") ? path : `/api/v1/app${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network_error", "Couldn't reach PoolFi. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => null)) as {
    error?: { code: string; message: string; details?: Record<string, unknown> };
  } | null;
  if (!response.ok) {
    throw new ApiError(
      data?.error?.code ?? "request_failed",
      data?.error?.message ?? "Something went wrong. Try again.",
      data?.error?.details,
    );
  }
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
/** The sign-in steps on the server (/api/v1/auth). */
const auth = <T = unknown>(path: string, body?: unknown, signedIn = true) =>
  request<T>("POST", `/api/v1/auth${path}`, body, signedIn);

/** The claims in a Supabase session token (it's checked properly on the server). */
function tokenClaims(token: string): { session_id?: string } {
  try {
    const part = token.split(".")[1] ?? "";
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { session_id?: string };
  } catch {
    return {};
  }
}

interface SignInStatus {
  locked: boolean;
  attemptsLeft: number;
}

function locked() {
  return new ApiError("account_locked", "Your account is locked after too many wrong passwords. We emailed you a code to unlock it.");
}
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
const pool = (id: string) => `/pools/${encodeURIComponent(id)}`;

export const httpApi: PoolFiApi = {
  async getSession() {
    if (!(await accessToken())) return null;
    try {
      return await get<User>("/me");
    } catch (error) {
      // Signed in with a password but the emailed code isn't confirmed yet: not in.
      if (error instanceof ApiError && error.code === "verification_required") return null;
      // A session the server no longer accepts counts as signed out.
      if (error instanceof ApiError && error.code === "unauthenticated") {
        await supabase().auth.signOut({ scope: "local" });
        return null;
      }
      throw error;
    }
  },

  async signUp(email, password) {
    const { data, error } = await supabase().auth.signUp({ email: email.trim().toLowerCase(), password });
    if (error) throw authError(error);
    if (!data.session) {
      // Supabase's own email confirmation is on; PoolFi confirms the address with its code instead.
      throw new ApiError("signup_unavailable", "Sign-up isn't open yet: Supabase's \"Confirm email\" setting must be off.");
    }
    await auth("/code");
  },

  async signIn(email, password) {
    const address = email.trim().toLowerCase();
    const before = await auth<SignInStatus>("/status", { email: address }, false);
    if (before.locked) throw locked();
    const { error } = await supabase().auth.signInWithPassword({ email: address, password });
    if (error) {
      if (error.code !== "invalid_credentials") throw authError(error);
      const after = await auth<SignInStatus>("/failed", { email: address }, false);
      if (after.locked) throw locked();
      throw new ApiError(
        "wrong_password",
        `Wrong email or password. ${after.attemptsLeft} ${after.attemptsLeft === 1 ? "try" : "tries"} left before we lock the account to keep it safe.`,
        { attemptsLeft: after.attemptsLeft },
      );
    }
    try {
      await auth("/code");
    } catch (e) {
      if (e instanceof ApiError && e.code === "account_locked") await supabase().auth.signOut({ scope: "local" });
      throw e;
    }
  },

  async verifyCode(code) {
    await auth("/code/verify", { code });
    const user = await get<User>("/me");
    return { needsProfile: !user.firstName };
  },

  resendCode: () => auth("/code"),
  unlockAccount: (email, code) => auth("/unlock", { email: email.trim().toLowerCase(), code }, false),
  resendUnlockCode: (email) => auth("/unlock/code", { email: email.trim().toLowerCase() }, false),

  async requestPasswordReset(email) {
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: new URL("/reset-password", window.location.origin).toString(),
    });
    if (error) throw authError(error);
  },

  async recoveryReady() {
    // Supabase sends people back with #error_code=… when a link has expired or was used.
    if (typeof window !== "undefined" && /(^|[#&])error(_code)?=/.test(window.location.hash)) return false;
    // Waits until Supabase has read the link and saved the session it opened. It only announces
    // "password recovery" a moment later, so the link noted above decides it here.
    const token = await accessToken();
    if (token && resetLinkSession && tokenClaims(token).session_id === resetLinkSession) rememberRecovery(token);
    const remembered = rememberedRecovery();
    return Boolean(token && remembered && tokenClaims(token).session_id === remembered);
  },

  async setNewPassword(password) {
    // Only the session the reset link opened may change the password, not a sign-in left over in this browser.
    if (!(await httpApi.recoveryReady())) {
      throw new ApiError("reset_link_expired", "This page needs the link from your reset email, and that link works once. Ask for a new one.");
    }
    const { error } = await supabase().auth.updateUser({ password });
    if (error) throw authError(error);
    await auth("/password-reset/done");
    rememberRecovery(null);
    // Everyone signs in again with the new password (and a new code).
    await supabase().auth.signOut({ scope: "global" });
  },

  saveProfile: (profile) => request<User>("PUT", "/me/profile", profile),
  getAchievements: () => get("/me/achievements"),
  savePreferences: (preferences) => request("PUT", "/me/preferences", preferences),

  async signOut() {
    await supabase().auth.signOut();
  },

  getHome: () => get("/home"),
  listPools: () => get("/pools"),
  listActivity: () => get("/activity"),
  getNotifications: () => get("/notifications"),
  markNotificationsRead: async () => {
    await post("/notifications/read");
  },
  listContacts: () => get("/contacts"),

  getFeeBps: async () => (await request<{ bps: number }>("GET", "/fee", undefined, false)).bps,
  createPool: (input) => post("/pools", input),
  getPool: (id) => get(pool(id)),
  addDivers: (id, divers) => post(`${pool(id)}/divers`, { divers }),
  updatePoolSettings: (id, settings) => request("PATCH", `${pool(id)}/settings`, settings),
  remindUnpaid: (id) => post(`${pool(id)}/reminders`),
  getRecord: (id) => get(`${pool(id)}/record`),

  getInvite: (code) => request("GET", `/invites/${encodeURIComponent(code)}`, undefined, false),
  payShare: (code, as) => post(`/invites/${encodeURIComponent(code)}/pay`, as),

  requestPayout: (id, destination) => post(`${pool(id)}/payout`, { destination }),
  approvePayout: (id) => post(`${pool(id)}/payout/approve`),
  declinePayout: (id, reason) => post(`${pool(id)}/payout/decline`, { reason }),

  getWallet: () => get("/wallet"),
  depositTestUsdc: (amount) => post("/wallet/deposits", { amount }),

  getReceipt: (ref) => request("GET", `/receipts/${encodeURIComponent(ref)}`, undefined, false),
  async verifyReceipt(ref) {
    try {
      return await request<Receipt>("GET", `/receipts/${encodeURIComponent(ref)}`, undefined, false);
    } catch (error) {
      if (error instanceof ApiError && error.code === "receipt_not_found") return null;
      throw error;
    }
  },
};
