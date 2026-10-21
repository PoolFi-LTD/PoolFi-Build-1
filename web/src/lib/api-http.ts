/**
 * The real PoolFi API: sign-in with Supabase (a 6-digit code by email),
 * everything else from the server at /api/v1/app, signed in with the Supabase session.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PoolFiApi } from "./api";
import { ApiError } from "./errors";
import type { Receipt, User } from "./types";

/** The email the code was sent to, kept until it's checked (the verify screen can be reloaded). */
const PENDING_KEY = "poolfi-signin-to";

let supabaseClient: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new ApiError("not_configured", "Sign-in isn't set up yet.");
    supabaseClient = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return supabaseClient;
}

let pending: string | null = null;

function remember(email: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, email);
  } catch {
    // Storage can be off; the code can still be checked in this tab.
  }
  pending = email;
}

function pendingEmail(): string | null {
  if (pending) return pending;
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

/** Supabase's sign-in errors, in words the screens can show. */
function authError(error: { message: string; code?: string; status?: number }, checking: boolean): ApiError {
  const code = error.code ?? "";
  if (checking && (code === "otp_expired" || /expired|invalid/i.test(error.message))) {
    return new ApiError("invalid_code", "That code isn't right or has expired. Check it or ask for a new one.");
  }
  if (code === "validation_failed" || code === "email_address_invalid") {
    return new ApiError("invalid_address", "That doesn't look right. Check it and try again.");
  }
  if (code === "over_email_send_rate_limit" || error.status === 429) {
    return new ApiError("too_many_codes", "Too many codes asked for. Wait a minute and try again.");
  }
  return new ApiError(code || "auth_failed", error.message || "Sign-in didn't work. Try again.");
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, signedIn = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (signedIn) {
    const token = await accessToken();
    if (!token) throw new ApiError("unauthenticated", "Sign in to continue.");
    headers.authorization = `Bearer ${token}`;
  }
  let response: Response;
  try {
    response = await fetch(`/api/v1/app${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("network_error", "Couldn't reach PoolFi. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!response.ok) {
    throw new ApiError(data?.error?.code ?? "request_failed", data?.error?.message ?? "Something went wrong. Try again.");
  }
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
const pool = (id: string) => `/pools/${encodeURIComponent(id)}`;

export const httpApi: PoolFiApi = {
  async getSession() {
    if (!(await accessToken())) return null;
    try {
      return await get<User>("/me");
    } catch (error) {
      // A session the server no longer accepts counts as signed out.
      if (error instanceof ApiError && error.code === "unauthenticated") {
        await supabase().auth.signOut({ scope: "local" });
        return null;
      }
      throw error;
    }
  },

  async sendCode(email) {
    const to = email.trim().toLowerCase();
    const { error } = await supabase().auth.signInWithOtp({ email: to, options: { shouldCreateUser: true } });
    if (error) throw authError(error, false);
    remember(to);
  },

  async verifyCode(code) {
    const email = pendingEmail();
    if (!email) throw new ApiError("code_expired", "Ask for a new code.");
    const { error } = await supabase().auth.verifyOtp({ email, token: code, type: "email" });
    if (error) throw authError(error, true);
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      // Nothing to clean up.
    }
    pending = null;
    const user = await get<User>("/me");
    return { needsProfile: !user.firstName };
  },

  saveProfile: (profile) => request<User>("PUT", "/me/profile", profile),

  async signOut() {
    await supabase().auth.signOut();
  },

  getHome: () => get("/home"),
  listPools: () => get("/pools"),
  listActivity: () => get("/activity"),
  listContacts: () => get("/contacts"),

  getFeeBps: async () => (await request<{ bps: number }>("GET", "/fee", undefined, false)).bps,
  createPool: (input) => post("/pools", input),
  getPool: (id) => get(pool(id)),
  addDivers: (id, divers) => post(`${pool(id)}/divers`, { divers }),
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
