import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requestAppUrl } from "./app-routes.ts";
import type { AuthUser } from "./auth.ts";
import type { Config } from "./config.ts";
import { parse } from "./parse.ts";
import type { TwoStep } from "./services/two-step.ts";

const EmailInput = z.object({ email: z.email().max(320) });
const CodeInput = z.object({ code: z.string().trim().regex(/^\d{6}$/, "must be the 6-digit code") });
const UnlockInput = z.object({ email: z.email().max(320), code: z.string().trim().regex(/^\d{6}$/, "must be the 6-digit code") });

/**
 * Signing in is two steps: the password (checked by Supabase in the browser), then a
 * code PoolFi emails. Mounted at /v1/auth.
 */
export function authRoutes(twoStep: TwoStep, tokenOnly: (request: FastifyRequest) => Promise<AuthUser>, config: Config) {
  return async (app: FastifyInstance) => {
    // Before asking for a password: is the account locked, and how many tries are left?
    app.post("/status", async (request) => twoStep.status(parse(EmailInput, request.body).email));
    // A wrong password. The fifth in a row locks the account and emails an unlock code.
    app.post("/failed", async (request) =>
      twoStep.recordFailure(parse(EmailInput, request.body).email, requestAppUrl(config, request)),
    );

    // After the right password: email the code, then check it.
    app.post("/code", async (request) => twoStep.sendSignInCode(await tokenOnly(request), requestAppUrl(config, request)));
    app.post("/code/verify", async (request) => {
      await twoStep.verifySignInCode(await tokenOnly(request), parse(CodeInput, request.body).code);
      return { verified: true };
    });

    // A locked account: a new unlock code, and unlocking with it.
    app.post("/unlock/code", async (request) => {
      await twoStep.sendUnlockCode(parse(EmailInput, request.body).email, requestAppUrl(config, request));
      return { sent: true };
    });
    app.post("/unlock", async (request) => {
      const { email, code } = parse(UnlockInput, request.body);
      await twoStep.unlock(email, code);
      return { unlocked: true };
    });

    // After setting a new password from the emailed reset link.
    app.post("/password-reset/done", async (request) => {
      await twoStep.passwordWasReset(await tokenOnly(request));
      return { done: true };
    });
  };
}
