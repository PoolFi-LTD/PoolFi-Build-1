/**
 * Shared setup for end-to-end tests: the real server against Stellar testnet,
 * using the settings in server/.env and a temporary database it drops afterwards.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { SignJWT } from "jose";
import pg from "pg";
import { buildApp } from "../../src/app.ts";
import { loadConfig, type Config } from "../../src/config.ts";
import { Db } from "../../src/db.ts";
import type { Email, Mailer } from "../../src/email/mailer.ts";
import { migrate } from "../../src/migrate.ts";
import { parseUsdc } from "../../src/money.ts";
import { Chain } from "../../src/stellar/chain.ts";
import { PoolContract } from "../../src/stellar/pool-contract.ts";

const envFile = new URL("../../.env", import.meta.url).pathname;
if (existsSync(envFile)) process.loadEnvFile(envFile);

export interface TestUser {
  id: string;
  email: string;
  sessionId: string;
  headers: Record<string, string>;
}

async function adminQuery(databaseUrl: string, sql: string) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function startHarness() {
  const base = loadConfig();
  const database = `poolfi_e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const config: Config = {
    ...base,
    logLevel: (process.env.E2E_LOG_LEVEL as Config["logLevel"] | undefined) ?? "silent",
    databaseUrl: Object.assign(new URL(base.databaseUrl), { pathname: `/${database}` }).toString(),
    // A small daily limit so the limit is exercised without spending much treasury USDC.
    deposits: base.deposits && { ...base.deposits, dailyMax: parseUsdc("60") },
  };
  const { jwtSecret, audience } = config.auth;
  if (!jwtSecret) throw new Error("End-to-end tests sign their own tokens and need AUTH_JWT_SECRET");

  await adminQuery(base.databaseUrl, `create database ${database}`);
  const db = new Db(config.databaseUrl);
  await migrate(db);
  const chain = new Chain(config.stellar, (key, fn) => db.withLock(key, fn));
  // Emails are caught here, never sent, whatever server/.env says.
  const emails: Email[] = [];
  const mailer: Mailer = { send: async (batch) => void emails.push(...batch) };
  const { app, services } = await buildApp({ config, db, chain, mailer });

  /**
   * A signed-in user, as Supabase issues them: a session signed in with a password
   * (or `method`). By default the emailed code is already confirmed, as it is for
   * everyone using the app; `confirmed: false` stops before that step.
   */
  async function signIn(
    name: string,
    options: { confirmed?: boolean; method?: string; id?: string } = {},
  ): Promise<TestUser> {
    const id = options.id ?? randomUUID();
    const sessionId = randomUUID();
    const email = `${name}@example.com`;
    const token = await new SignJWT({
      email,
      aud: audience,
      session_id: sessionId,
      amr: [{ method: options.method ?? "password", timestamp: Math.floor(Date.now() / 1000) }],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(id)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(jwtSecret));
    if (options.confirmed !== false) {
      await db.query("insert into users (id, email, email_verified_at) values ($1, $2, now()) on conflict do nothing", [id, email]);
      await db.query("insert into verified_sessions (session_id, user_id) values ($1, $2)", [sessionId, id]);
    }
    return { id, email, sessionId, headers: { authorization: `Bearer ${token}` } };
  }

  async function call(method: "GET" | "POST", url: string, user?: TestUser, body?: unknown) {
    const response = await app.inject({ method, url, headers: user?.headers, payload: body as object | undefined });
    return { status: response.statusCode, body: response.json() };
  }

  async function close() {
    await app.close();
    await db.close();
    await adminQuery(base.databaseUrl, `drop database if exists ${database}`);
  }

  return { config, db, chain, app, emails, contract: new PoolContract(chain), services, signIn, call, close };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;
