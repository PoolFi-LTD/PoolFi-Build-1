import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { appRoutes } from "./app-routes.ts";
import { authRoutes } from "./auth-routes.ts";
import { createAuthenticator, type AuthUser } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { Mailer } from "./email/mailer.ts";
import { ApiError } from "./errors.ts";
import { formatUsdc, isUsdcAmount, parseUsdc } from "./money.ts";
import { parse } from "./parse.ts";
import { createServices, type Services } from "./services/index.ts";
import { ContributeInput, CreatePoolInput, JoinPoolInput } from "./services/pools.ts";
import type { Chain } from "./stellar/chain.ts";

export interface AppDeps {
  config: Config;
  db: Db;
  chain: Chain;
  /** Where emails go; Resend from the config unless given (tests catch them instead). */
  mailer?: Mailer;
}

const DepositInput = z.object({
  amount: z.string().refine(isUsdcAmount, "must be a USDC amount, e.g. 50 or 12.5"),
});

export async function buildApp({ config, db, chain, mailer }: AppDeps): Promise<{ app: FastifyInstance; services: Services }> {
  const app = Fastify({
    logger: { level: config.logLevel, redact: ["req.headers.authorization"] },
    bodyLimit: 64 * 1024,
  });
  await app.register(cors, { origin: config.corsOrigins.length > 0 ? config.corsOrigins : false });

  const authenticate = createAuthenticator(config.auth, (reason) =>
    app.log.warn({ reason, check: config.auth.jwksUrl ? "jwks" : "shared secret" }, "sign-in token rejected"),
  );
  const services = createServices({ config, db, chain, mailer }, app.log);
  const { wallets, deposits, pools } = services;

  /** A sign-in that finished both steps: the password, then the emailed code. */
  const signedIn = async (request: FastifyRequest): Promise<AuthUser> => {
    const user = await authenticate(request.headers.authorization);
    await services.twoStep.requireVerified(user);
    return user;
  };
  /** Any valid sign-in token, before the emailed code (for the sign-in steps themselves). */
  const tokenOnly = (request: FastifyRequest): Promise<AuthUser> => authenticate(request.headers.authorization);
  const maybeSignedIn = (request: FastifyRequest): Promise<AuthUser | null> =>
    request.headers.authorization ? signedIn(request) : Promise.resolve(null);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: { code: "bad_request", message: error.message } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: "internal_error", message: "Something went wrong. Try again." } });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "No such endpoint." } }),
  );

  app.get("/health", async () => {
    await db.query("select 1");
    const ledger = await chain.rpc.getLatestLedger();
    return {
      status: "ok",
      network: config.stellar.networkPassphrase,
      latestLedger: ledger.sequence,
      poolContractId: chain.poolContractId,
      usdcContractId: chain.usdcContractId,
    };
  });

  // The signed-in user. Their wallet is created on their first call to any signed-in endpoint.
  app.get("/v1/me", async (request) => {
    const user = await signedIn(request);
    const wallet = await wallets.ensureUser(user);
    return { id: user.id, email: user.email, wallet: { address: wallet.address, activated: wallet.activated } };
  });

  app.get("/v1/wallet", async (request) => {
    const wallet = await wallets.ensureUser(await signedIn(request));
    const balance = (await chain.usdcBalance(wallet.address)) ?? 0n;
    return { address: wallet.address, activated: wallet.activated, usdcBalance: formatUsdc(balance) };
  });

  app.post("/v1/wallet/deposits", async (request, reply) => {
    const user = await signedIn(request);
    const { amount } = parse(DepositInput, request.body);
    const deposit = await deposits.deposit(user, parseUsdc(amount));
    const address = await wallets.address(user.id);
    const balance = address ? ((await chain.usdcBalance(address)) ?? 0n) : 0n;
    return reply.status(201).send({ deposit, usdcBalance: formatUsdc(balance) });
  });

  app.post("/v1/pools", async (request, reply) => {
    const user = await signedIn(request);
    const pool = await pools.create(user, parse(CreatePoolInput, request.body));
    return reply.status(201).send({ pool });
  });

  app.get<{ Params: { poolId: string } }>("/v1/pools/:poolId", async (request) => {
    return { pool: await pools.get(request.params.poolId, await maybeSignedIn(request)) };
  });

  app.post<{ Params: { poolId: string } }>("/v1/pools/:poolId/join", async (request) => {
    const user = await signedIn(request);
    return { pool: await pools.join(user, request.params.poolId, parse(JoinPoolInput, request.body)) };
  });

  app.post<{ Params: { poolId: string } }>("/v1/pools/:poolId/contributions", async (request, reply) => {
    const user = await signedIn(request);
    const result = await pools.contribute(user, request.params.poolId, parse(ContributeInput, request.body));
    return reply.status(201).send(result);
  });

  // The pool admin takes the pool's USDC into their wallet once the goal is met.
  app.post<{ Params: { poolId: string } }>("/v1/pools/:poolId/withdraw", async (request) => {
    return pools.withdraw(await signedIn(request), request.params.poolId);
  });

  await app.register(appRoutes(services.app, signedIn, config), { prefix: "/v1/app" });
  await app.register(authRoutes(services.twoStep, tokenOnly, config), { prefix: "/v1/auth" });

  return { app, services };
}
