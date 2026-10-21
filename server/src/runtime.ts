import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { loadConfig, type Config } from "./config.ts";
import { Db } from "./db.ts";
import type { Services } from "./services/index.ts";
import { Chain } from "./stellar/chain.ts";

/**
 * The API for serverless hosts such as Vercel, where the web app serves it from
 * /api: built once per instance and reused, with no port and no timers. Database
 * migrations run separately (`npm run migrate`) and refunds run on a schedule
 * that calls /api/cron/refunds. Settings come from environment variables: the
 * host's dashboard, or web/.env.local on a developer's machine. `server.ts` is
 * the long-running alternative.
 */
export interface Runtime {
  config: Config;
  db: Db;
  chain: Chain;
  app: FastifyInstance;
  services: Services;
}

// Kept on globalThis so a dev server's hot reload doesn't open another database pool.
const cache = globalThis as typeof globalThis & { poolfiRuntime?: Promise<Runtime> };

export function getRuntime(): Promise<Runtime> {
  cache.poolfiRuntime ??= start().catch((error: unknown) => {
    cache.poolfiRuntime = undefined;
    throw error;
  });
  return cache.poolfiRuntime;
}

async function start(): Promise<Runtime> {
  const config = loadConfig();
  const db = new Db(config.databaseUrl, config.databasePoolMax);
  const chain = new Chain(config.stellar, (key, fn) => db.withLock(key, fn));
  const { app, services } = await buildApp({ config, db, chain });
  await app.ready();
  return { config, db, chain, app, services };
}
