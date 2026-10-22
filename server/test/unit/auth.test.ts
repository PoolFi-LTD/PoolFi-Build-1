import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createAuthenticator } from "../../src/auth.ts";

const secret = "a-test-signing-secret-that-is-long-enough";
const authenticate = createAuthenticator({ jwtSecret: secret, audience: "authenticated", jwksUrl: undefined, issuer: undefined });

async function token(claims: Record<string, unknown>, options: { secret?: string; expires?: string } = {}) {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(options.expires ?? "1h");
  return jwt.sign(new TextEncoder().encode(options.secret ?? secret));
}

describe("createAuthenticator", () => {
  it("returns the signed-in user", async () => {
    const jwt = await token({ sub: "user-1", email: "ada@example.com", aud: "authenticated" });
    await expect(authenticate(`Bearer ${jwt}`)).resolves.toEqual({ id: "user-1", email: "ada@example.com", phone: null });
  });

  it("reads a phone sign-in as E.164", async () => {
    const jwt = await token({ sub: "user-2", email: "", phone: "2348035550142", aud: "authenticated" });
    await expect(authenticate(`Bearer ${jwt}`)).resolves.toEqual({ id: "user-2", email: null, phone: "+2348035550142" });
  });

  it("says why a sign-in signed with keys can't be checked by a secret-only server", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const jwt = await new SignJWT({ sub: "user-3", aud: "authenticated" })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    await expect(authenticate(`Bearer ${jwt}`)).rejects.toMatchObject({
      status: 401,
      details: { reason: expect.stringContaining("AUTH_JWKS_URL") },
    });
  });

  it("rejects a missing or malformed header", async () => {
    for (const header of [undefined, "", "Bearer", "Basic abc", "token"]) {
      await expect(authenticate(header)).rejects.toMatchObject({ status: 401 });
    }
  });

  it("rejects tokens that are forged, expired, for another audience, or without a user", async () => {
    const forged = await token({ sub: "user-1", aud: "authenticated" }, { secret: "someone-elses-secret-also-long-enough" });
    const expired = await token({ sub: "user-1", aud: "authenticated" }, { expires: "-1m" });
    const wrongAudience = await token({ sub: "user-1", aud: "other" });
    const noSubject = await token({ aud: "authenticated" });
    for (const jwt of [forged, expired, wrongAudience, noSubject]) {
      await expect(authenticate(`Bearer ${jwt}`)).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    }
  });
});
