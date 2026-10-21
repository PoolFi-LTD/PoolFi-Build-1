import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";

export interface AuthUser {
  id: string;
  email: string | null;
}

export type Authenticator = (authorization: string | undefined) => Promise<AuthUser>;

/**
 * Verifies `Authorization: Bearer <token>` sign-in tokens issued by the auth
 * provider. Which sign-up method issued them doesn't matter here.
 */
export function createAuthenticator(config: Config["auth"]): Authenticator {
  const key: JWTVerifyGetKey | Uint8Array = config.jwksUrl
    ? createRemoteJWKSet(new URL(config.jwksUrl))
    : new TextEncoder().encode(config.jwtSecret);
  const options = {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: config.jwksUrl ? undefined : ["HS256"],
  };

  return async (authorization) => {
    const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) {
      throw new ApiError(401, "unauthenticated", "Sign in to continue.");
    }
    try {
      const { payload } =
        key instanceof Uint8Array ? await jwtVerify(token, key, options) : await jwtVerify(token, key, options);
      if (!payload.sub) throw new Error("token has no subject");
      return { id: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
    } catch {
      throw new ApiError(401, "unauthenticated", "Your session is invalid or has expired. Sign in again.");
    }
  };
}
