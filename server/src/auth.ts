import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Config } from "./config.ts";
import { ApiError } from "./errors.ts";

export interface AuthUser {
  id: string;
  email: string | null;
  /** E.164, when the person signed in with their phone. */
  phone: string | null;
}

export type Authenticator = (authorization: string | undefined) => Promise<AuthUser>;

/**
 * Verifies `Authorization: Bearer <token>` sign-in tokens issued by the auth
 * provider. Which sign-up method issued them doesn't matter here.
 */
export function createAuthenticator(
  config: Config["auth"],
  /** Told why a token was turned away (wrong issuer, expired…), never the token itself. */
  onReject?: (reason: string) => void,
): Authenticator {
  // Supabase signs with its published keys (ES256/RS256); older projects with a shared
  // secret (HS256). Each token is checked the way it was signed, so a leftover secret
  // setting can't turn away key-signed sign-ins.
  const keys: JWTVerifyGetKey | null = config.jwksUrl ? createRemoteJWKSet(new URL(config.jwksUrl)) : null;
  const secret = config.jwtSecret ? new TextEncoder().encode(config.jwtSecret) : null;
  const claims = { issuer: config.issuer, audience: config.audience };

  return async (authorization) => {
    const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) {
      throw new ApiError(401, "unauthenticated", "Sign in to continue.");
    }
    try {
      const { alg } = decodeProtectedHeader(token);
      let payload;
      if (alg === "HS256") {
        if (!secret) throw new Error("token is signed with a shared secret (HS256), but AUTH_JWT_SECRET isn't set");
        ({ payload } = await jwtVerify(token, secret, { ...claims, algorithms: ["HS256"] }));
      } else {
        if (!keys) throw new Error(`token is signed with keys (${alg}), but AUTH_JWKS_URL isn't set`);
        ({ payload } = await jwtVerify(token, keys, { ...claims, algorithms: ["ES256", "RS256", "EdDSA"] }));
      }
      if (!payload.sub) throw new Error("token has no subject");
      const phone = typeof payload.phone === "string" && payload.phone ? `+${payload.phone.replace(/^\+/, "")}` : null;
      return { id: payload.sub, email: typeof payload.email === "string" && payload.email ? payload.email : null, phone };
    } catch (error) {
      // The reason names the check that failed (issuer, audience, expiry…), never the token.
      const reason = error instanceof Error ? error.message : String(error);
      onReject?.(reason);
      throw new ApiError(401, "unauthenticated", "Your session is invalid or has expired. Sign in again.", { reason });
    }
  };
}
