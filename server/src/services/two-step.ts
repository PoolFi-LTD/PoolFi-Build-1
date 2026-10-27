import { createHmac, hkdfSync, randomInt, timingSafeEqual } from "node:crypto";
import type { AuthUser } from "../auth.ts";
import type { Db } from "../db.ts";
import type { Email, Mailer } from "../email/mailer.ts";
import { signInCodeEmail, unlockCodeEmail, type EmailContext } from "../email/messages.ts";
import { ApiError } from "../errors.ts";

/** How long an emailed code works. */
const CODE_MINUTES = 10;
/** Wrong tries at one code before it stops working. */
const MAX_CODE_ATTEMPTS = 5;
/** Wrong passwords in a row before the account locks. */
export const MAX_PASSWORD_FAILURES = 5;
/** Wrong passwords older than this no longer count towards a lock. */
const FAILURE_WINDOW = "24 hours";
/** The least time between two codes, and the most codes in an hour, per session or account. */
const RESEND_GAP_SECONDS = 30;
const MAX_CODES_PER_HOUR = 6;
/** Sign-in methods that prove the person has the inbox: an emailed reset link or code. */
const EMAIL_PROVEN = new Set(["recovery", "otp", "magiclink"]);

export interface SignInStatus {
  locked: boolean;
  attemptsLeft: number;
}

interface CodeRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
}

interface Logger {
  warn(details: object, message: string): void;
}

/**
 * The second step of signing in. Supabase checks the password; then PoolFi emails a
 * code and only a session whose code was confirmed can use the app. Five wrong
 * passwords in a row lock the account until a code emailed to its owner unlocks it.
 *
 * Supabase can also sign people in by emailed link or code alone. Those sessions can
 * never be confirmed here (a code is only sent to a session signed in with its
 * password), so knowing the password and having the inbox are both needed.
 */
export class TwoStep {
  private readonly key: Buffer;

  constructor(
    private readonly db: Db,
    private readonly mail: Mailer,
    secret: Buffer,
    private readonly email: { timeZone: string; appUrl: string | null },
    /** Without email set up, codes are written to the log instead (local development only). */
    private readonly logCodes: Logger | null,
    /** A signed-in session quiet for longer than this must sign in again. */
    private readonly idleMinutes = 10,
  ) {
    this.key = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "poolfi-auth-codes", 32));
  }

  /** Whether an email's account is locked, and how many wrong passwords it has left. */
  async status(email: string): Promise<SignInStatus> {
    const [row] = await this.db.query<{ failures: number; locked: boolean }>(
      `select case when last_failed_at > now() - $2::interval then failures else 0 end as failures,
              locked_at is not null as locked
       from sign_in_failures where email = $1`,
      [normalize(email), FAILURE_WINDOW],
    );
    if (row?.locked) return { locked: true, attemptsLeft: 0 };
    return { locked: false, attemptsLeft: Math.max(0, MAX_PASSWORD_FAILURES - (row?.failures ?? 0)) };
  }

  /** Counts a wrong password. The one that reaches the limit locks the account and emails an unlock code. */
  async recordFailure(email: string, appUrl: string | null): Promise<SignInStatus> {
    const address = normalize(email);
    const [row] = await this.db.query<{ failures: number; locked_at: Date | null }>(
      `insert into sign_in_failures (email, failures, last_failed_at) values ($1, 1, now())
       on conflict (email) do update set
         failures = case
           when sign_in_failures.locked_at is not null then sign_in_failures.failures
           when sign_in_failures.last_failed_at < now() - $2::interval then 1
           else sign_in_failures.failures + 1 end,
         last_failed_at = now()
       returning failures, locked_at`,
      [address, FAILURE_WINDOW],
    );
    if (!row) throw new Error("Wrong password was not counted");
    if (row.locked_at) return { locked: true, attemptsLeft: 0 };
    if (row.failures < MAX_PASSWORD_FAILURES) {
      return { locked: false, attemptsLeft: MAX_PASSWORD_FAILURES - row.failures };
    }
    await this.db.query("update sign_in_failures set locked_at = now() where email = $1", [address]);
    await this.sendUnlockCode(address, appUrl, true);
    return { locked: true, attemptsLeft: 0 };
  }

  /** Emails a code to finish signing in. Only for a session signed in with its password. */
  async sendSignInCode(user: AuthUser, appUrl: string | null): Promise<{ alreadyVerified: boolean }> {
    const { sessionId, email } = this.passwordSession(user);
    await this.ensureNotSuspended(user.id);
    if (await this.isVerified(sessionId)) return { alreadyVerified: true };
    await this.ensureUnlocked(email);
    await this.throttle("session_id", sessionId);
    const code = await this.newCode(email, "sign_in", sessionId);
    await this.send(email, `sign-in:${sessionId}:${code.id}`, signInCodeEmail({ code: code.value, minutes: CODE_MINUTES }, this.context(appUrl)));
    return { alreadyVerified: false };
  }

  /** Checks the emailed code. Right: the session can use the app. */
  async verifySignInCode(user: AuthUser, code: string): Promise<void> {
    const { sessionId, email } = this.passwordSession(user);
    await this.ensureNotSuspended(user.id);
    if (await this.isVerified(sessionId)) return;
    await this.ensureUnlocked(email);
    const [row] = await this.db.query<CodeRow>(
      `select id, code_hash, attempts, expires_at from auth_codes
       where session_id = $1 and purpose = 'sign_in' and used_at is null order by created_at desc limit 1`,
      [sessionId],
    );
    await this.check(row, code);

    await this.db.transaction(async (client) => {
      await client.query(
        `insert into users (id, email, email_verified_at) values ($1, $2, now())
         on conflict (id) do update set email = excluded.email, email_verified_at = coalesce(users.email_verified_at, now())`,
        [user.id, email],
      );
      await client.query("insert into verified_sessions (session_id, user_id) values ($1, $2) on conflict do nothing", [
        sessionId,
        user.id,
      ]);
      // The right password and the right code: wrong passwords from before no longer count.
      await client.query("delete from sign_in_failures where email = $1", [email]);
    });
  }

  /** Emails a new unlock code to a locked account. Says nothing about accounts that aren't locked. */
  async sendUnlockCode(email: string, appUrl: string | null, justLocked = false): Promise<void> {
    const address = normalize(email);
    if (!justLocked && !(await this.status(address)).locked) return;
    await this.throttle("email", address);
    const code = await this.newCode(address, "unlock", null);
    await this.send(
      address,
      `unlock:${code.id}`,
      unlockCodeEmail({ email: address, code: code.value, minutes: CODE_MINUTES, attempts: MAX_PASSWORD_FAILURES }, this.context(appUrl)),
    );
  }

  /** Unlocks the account with the emailed code; then its owner can sign in again. */
  async unlock(email: string, code: string): Promise<void> {
    const address = normalize(email);
    const [row] = await this.db.query<CodeRow>(
      `select id, code_hash, attempts, expires_at from auth_codes
       where email = $1 and purpose = 'unlock' and used_at is null order by created_at desc limit 1`,
      [address],
    );
    await this.check(row, code);
    await this.db.query("delete from sign_in_failures where email = $1", [address]);
  }

  /**
   * After a password reset (the emailed recovery link): the account unlocks, and every
   * device must confirm a new code before it can use the app again. Supabase marks the
   * session a reset link opens as "otp" (or "recovery"): it proves the inbox, which is
   * what a reset rests on anyway. A session signed in with the password alone can't.
   */
  async passwordWasReset(user: AuthUser): Promise<void> {
    if (!user.methods.some((m) => EMAIL_PROVEN.has(m)) || !user.email) {
      throw new ApiError(403, "recovery_required", "Open the reset link we emailed you first.");
    }
    await this.db.query("delete from sign_in_failures where email = $1", [normalize(user.email)]);
    await this.db.query("delete from verified_sessions where user_id = $1", [user.id]);
  }

  /**
   * Lets a session use the app only once its emailed code was confirmed, and only while
   * it's in use: each request counts as activity, and a session quiet for longer than
   * the idle limit is closed (signing in again takes the password and a new code).
   */
  async requireVerified(user: AuthUser): Promise<void> {
    if (user.sessionId) {
      const [active] = await this.db.query<{ user_id: string; suspended_at: Date | null }>(
        `update verified_sessions s set last_seen_at = now()
         from users u
         where s.session_id = $1 and s.last_seen_at > now() - make_interval(mins => $2) and u.id = s.user_id
         returning s.user_id, u.suspended_at`,
        [user.sessionId, this.idleMinutes],
      );
      if (active?.suspended_at) throw suspended();
      if (active) return;
      const [closed] = await this.db.query<{ session_id: string }>(
        "delete from verified_sessions where session_id = $1 returning session_id",
        [user.sessionId],
      );
      if (closed) {
        throw new ApiError(
          401,
          "session_expired",
          `You were signed out after ${this.idleMinutes} minutes without activity. Sign in again to continue.`,
        );
      }
    }
    throw new ApiError(403, "verification_required", "Type in the code we emailed you to finish signing in.");
  }

  private async isVerified(sessionId: string): Promise<boolean> {
    const [row] = await this.db.query<{ user_id: string }>("select user_id from verified_sessions where session_id = $1", [
      sessionId,
    ]);
    return Boolean(row);
  }

  private passwordSession(user: AuthUser): { sessionId: string; email: string } {
    if (!user.sessionId || !user.email || !user.methods.includes("password")) {
      throw new ApiError(403, "password_required", "Sign in with your email and password first.");
    }
    return { sessionId: user.sessionId, email: normalize(user.email) };
  }

  /** The PoolFi team suspended this account (admin dashboard): no signing in until they lift it. */
  private async ensureNotSuspended(userId: string) {
    const [row] = await this.db.query<{ suspended_at: Date | null }>("select suspended_at from users where id = $1", [userId]);
    if (row?.suspended_at) throw suspended();
  }

  private async ensureUnlocked(email: string) {
    if ((await this.status(email)).locked) {
      throw new ApiError(423, "account_locked", "Your account is locked after too many wrong passwords. Check your email for the unlock code.");
    }
  }

  /** At most one code every 30 seconds, and six an hour, per session (sign-in) or email (unlock). */
  private async throttle(column: "session_id" | "email", value: string) {
    const [row] = await this.db.query<{ last: Date | null; recent: number }>(
      `select max(created_at) as last, count(*) filter (where created_at > now() - interval '1 hour')::int as recent
       from auth_codes where ${column} = $1`,
      [value],
    );
    const waited = row?.last ? (Date.now() - row.last.getTime()) / 1000 : Infinity;
    if (waited < RESEND_GAP_SECONDS) {
      const retryAfter = Math.ceil(RESEND_GAP_SECONDS - waited);
      throw new ApiError(429, "code_recently_sent", `We just sent a code. You can ask for another in ${retryAfter} seconds.`, { retryAfter });
    }
    if ((row?.recent ?? 0) >= MAX_CODES_PER_HOUR) {
      throw new ApiError(429, "too_many_codes", "Too many codes asked for. Try again in an hour.");
    }
  }

  /** A new 6-digit code; earlier unused ones for the same thing stop working. */
  private async newCode(email: string, purpose: "sign_in" | "unlock", sessionId: string | null) {
    const value = String(randomInt(0, 1_000_000)).padStart(6, "0");
    return this.db.transaction(async (client) => {
      await client.query(
        `update auth_codes set used_at = now()
         where used_at is null and purpose = $1 and ${sessionId ? "session_id = $2" : "email = $2"}`,
        [purpose, sessionId ?? email],
      );
      const { rows } = await client.query<{ id: string }>(
        `insert into auth_codes (email, purpose, session_id, code_hash, expires_at)
         values ($1, $2, $3, '', now() + make_interval(mins => $4)) returning id`,
        [email, purpose, sessionId, CODE_MINUTES],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("Code was not saved");
      await client.query("update auth_codes set code_hash = $2 where id = $1", [id, this.hash(id, value)]);
      return { id, value };
    });
  }

  /** Checks a typed code against the newest one, counting wrong tries. */
  private async check(row: CodeRow | undefined, typed: string) {
    if (!row || row.expires_at.getTime() < Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) {
      throw new ApiError(410, "code_expired", "That code has expired. Ask for a new one.");
    }
    const expected = Buffer.from(row.code_hash, "hex");
    const actual = Buffer.from(this.hash(row.id, typed.trim()), "hex");
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      await this.db.query("update auth_codes set used_at = now() where id = $1", [row.id]);
      return;
    }
    const [updated] = await this.db.query<{ attempts: number }>(
      "update auth_codes set attempts = attempts + 1 where id = $1 returning attempts",
      [row.id],
    );
    const left = MAX_CODE_ATTEMPTS - (updated?.attempts ?? MAX_CODE_ATTEMPTS);
    if (left <= 0) throw new ApiError(410, "code_expired", "Too many wrong tries. Ask for a new code.");
    throw new ApiError(400, "invalid_code", `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`, { attemptsLeft: left });
  }

  private hash(id: string, code: string): string {
    return createHmac("sha256", this.key).update(`${id}:${code}`).digest("hex");
  }

  private context(appUrl: string | null): EmailContext {
    return { appUrl: this.email.appUrl ?? appUrl, timeZone: this.email.timeZone };
  }

  private async send(to: string, key: string, rendered: { subject: string; html: string; text: string }) {
    const email: Email = { to, key, ...rendered };
    if (this.logCodes) {
      // Email is off (local development): the code goes to the log so sign-in still works.
      this.logCodes.warn({ to, subject: rendered.subject }, "email is off; this is the code it would have sent");
      return;
    }
    await this.mail.send([email]);
  }
}

function suspended() {
  return new ApiError(403, "account_suspended", "This PoolFi account is suspended. Contact PoolFi support if you think this is a mistake.");
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}
