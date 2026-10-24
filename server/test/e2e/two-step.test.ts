/**
 * Two-step sign-in: the password (Supabase), then a code PoolFi emails. Needs only the
 * database; codes are read from the emails the harness catches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type TestUser } from "./harness.ts";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

const post = (path: string, user?: TestUser, body?: unknown) => h.call("POST", path, user, body);
const contacts = (user: TestUser) => h.call("GET", "/v1/app/contacts", user);

/** The 6-digit code in the newest email to `to` whose subject matches. */
function codeFor(to: string, subject: RegExp): string {
  const mail = [...h.emails].reverse().find((e) => e.to === to && subject.test(e.subject));
  const code = mail?.text.match(/^(\d{6})$/m)?.[1];
  if (!code) throw new Error(`No code emailed to ${to}`);
  return code;
}
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("two-step sign-in", () => {
  it("opens the app only after the emailed code is confirmed", async () => {
    const user = await h.signIn("two-a", { confirmed: false });
    expect((await contacts(user)).body.error.code).toBe("verification_required");

    expect((await post("/v1/auth/code", user)).body).toEqual({ alreadyVerified: false });
    const code = codeFor(user.email, /^Your PoolFi code is \d{6}$/);
    // One code at a time.
    expect((await post("/v1/auth/code", user)).body.error.code).toBe("code_recently_sent");

    const miss = await post("/v1/auth/code/verify", user, { code: wrong(code) });
    expect(miss.status).toBe(400);
    expect(miss.body.error).toMatchObject({ code: "invalid_code", details: { attemptsLeft: 4 } });

    expect((await post("/v1/auth/code/verify", user, { code })).body).toEqual({ verified: true });
    expect((await contacts(user)).status).toBe(200);
    // Confirming again is harmless.
    expect((await post("/v1/auth/code/verify", user, { code })).status).toBe(200);
  });

  it("stops a code after five wrong tries", async () => {
    const user = await h.signIn("two-b", { confirmed: false });
    await post("/v1/auth/code", user);
    const code = codeFor(user.email, /^Your PoolFi code is/);
    for (let i = 0; i < 4; i++) await post("/v1/auth/code/verify", user, { code: wrong(code) });
    expect((await post("/v1/auth/code/verify", user, { code: wrong(code) })).body.error.code).toBe("code_expired");
    expect((await post("/v1/auth/code/verify", user, { code })).body.error.code).toBe("code_expired");
    expect((await contacts(user)).status).toBe(403);
  });

  it("never confirms a session that didn't use the password", async () => {
    for (const method of ["otp", "magiclink", "recovery"]) {
      const user = await h.signIn(`two-c-${method}`, { confirmed: false, method });
      expect((await post("/v1/auth/code", user)).body.error.code).toBe("password_required");
      expect((await contacts(user)).status).toBe(403);
    }
  });

  it("locks after five wrong passwords until the emailed code unlocks it", async () => {
    const email = "two-d@example.com";
    expect((await post("/v1/auth/status", undefined, { email })).body).toEqual({ locked: false, attemptsLeft: 5 });
    for (const left of [4, 3, 2, 1]) {
      expect((await post("/v1/auth/failed", undefined, { email: email.toUpperCase() })).body).toEqual({ locked: false, attemptsLeft: left });
    }
    expect((await post("/v1/auth/failed", undefined, { email })).body).toEqual({ locked: true, attemptsLeft: 0 });
    const unlockCode = codeFor(email, /^Your PoolFi account is locked$/);

    // Even the right password can't finish signing in while it's locked.
    const user = await h.signIn("two-d", { confirmed: false });
    expect((await post("/v1/auth/code", user)).status).toBe(423);

    expect((await post("/v1/auth/unlock", undefined, { email, code: wrong(unlockCode) })).status).toBe(400);
    expect((await post("/v1/auth/unlock", undefined, { email, code: unlockCode })).body).toEqual({ unlocked: true });
    expect((await post("/v1/auth/status", undefined, { email })).body).toEqual({ locked: false, attemptsLeft: 5 });
    expect((await post("/v1/auth/code", user)).status).toBe(200);
  });

  it("unlocks after a password reset and makes every device confirm again", async () => {
    const device = await h.signIn("two-e");
    expect((await contacts(device)).status).toBe(200);
    for (let i = 0; i < 5; i++) await post("/v1/auth/failed", undefined, { email: device.email });

    expect((await post("/v1/auth/password-reset/done", device)).body.error.code).toBe("recovery_required");
    // Supabase marks the session a reset link opens as "otp".
    const recovery = await h.signIn("two-e", { confirmed: false, method: "otp", id: device.id });
    expect((await post("/v1/auth/password-reset/done", recovery)).body).toEqual({ done: true });

    expect((await post("/v1/auth/status", undefined, { email: device.email })).body).toEqual({ locked: false, attemptsLeft: 5 });
    expect((await contacts(device)).body.error.code).toBe("verification_required");
  });

  it("closes a session after 10 minutes without activity", async () => {
    const user = await h.signIn("two-f");
    const active = async (u: TestUser) => (await h.app.inject({ method: "POST", url: "/v1/auth/active", headers: u.headers })).statusCode;
    const idle = (minutes: number) =>
      h.db.query("update verified_sessions set last_seen_at = now() - make_interval(mins => $2) where session_id = $1", [user.sessionId, minutes]);

    // Any request counts as activity; the app also pings while you tap and type.
    expect(await active(user)).toBe(204);
    await idle(9);
    expect((await contacts(user)).status).toBe(200);

    await idle(11);
    const expired = await contacts(user);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe("session_expired");
    // Closed for good: only the password and a new code open the app again.
    expect((await contacts(user)).body.error.code).toBe("verification_required");
    expect(await active(user)).toBe(403);
  });
});
