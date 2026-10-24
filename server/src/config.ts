import { Networks, StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { isUsdcAmount, parseUsdc } from "./money.ts";

const accountAddress = z
  .string()
  .refine((v) => StrKey.isValidEd25519PublicKey(v), "must be a Stellar account address (G...)");
const secretKey = z
  .string()
  .refine((v) => StrKey.isValidEd25519SecretSeed(v), "must be a Stellar secret key (S...)");
const contractAddress = z
  .string()
  .refine((v) => StrKey.isValidContract(v), "must be a contract address (C...)");
const usdcAmount = z.string().refine(isUsdcAmount, "must be a USDC amount, e.g. 500 or 12.5");

/** Pasted settings sometimes keep spaces or quotes around the value. */
function unquote(value: unknown): unknown {
  return typeof value === "string" ? value.trim().replace(/^(["'])(.*)\1$/, "$2") : value;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function issuerFromJwksUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const jwks = new URL(value);
  const suffix = "/.well-known/jwks.json";
  if (!jwks.pathname.endsWith(suffix)) return undefined;
  return `${jwks.origin}${jwks.pathname.slice(0, -suffix.length)}`.replace(/\/$/, "");
}

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8080),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // Comma-separated browser origins allowed to call the API, e.g. https://thepoolfi.com
    CORS_ORIGINS: z.string().optional(),
    // The web app's address, for links the API writes (invite links in reminders).
    // On Vercel it defaults to the production domain.
    APP_URL: z.url().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),

    // Use a session-mode or direct connection: wallet locks are Postgres advisory locks.
    DATABASE_URL: z.string().min(1),
    // Connections per server instance. Keep it small on serverless hosts, which run many instances.
    DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

    STELLAR_RPC_URL: z.url(),
    STELLAR_NETWORK_PASSPHRASE: z.string().min(1),
    POOL_CONTRACT_ID: contractAddress,
    USDC_CODE: z.string().min(1).default("USDC"),
    USDC_ISSUER: accountAddress,
    // Pays every transaction fee and the reserves of user wallets.
    SPONSOR_SECRET: secretKey,
    // Inclusion fee in stroops per operation; Soroban resource fees are added on top.
    TX_INCLUSION_FEE: z.coerce.number().int().positive().default(1000),
    TX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),

    // 32 random bytes, base64. Encrypts user wallet secret keys.
    WALLET_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
    WALLET_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),

    // Verify sign-in tokens with the auth provider's JWKS (e.g. Supabase), or a shared secret.
    AUTH_JWKS_URL: z.preprocess(unquote, z.url().optional()),
    AUTH_JWT_SECRET: z.preprocess(unquote, z.string().min(32).optional()),
    AUTH_JWT_ISSUER: z.preprocess(unquote, z.string().min(1).optional()),
    AUTH_JWT_AUDIENCE: z.preprocess(unquote, z.string().min(1).optional()),
    // The web app's Supabase project. Without AUTH_JWKS_URL, sign-ins are checked against its keys.
    NEXT_PUBLIC_SUPABASE_URL: z.preprocess(unquote, z.url().optional()),

    // Where "Deposit" gets USDC from. Unset disables deposits.
    DEPOSIT_PROVIDER: z.enum(["testnet-treasury"]).optional(),
    TREASURY_SECRET: secretKey.optional(),
    DEPOSIT_MAX_USDC: usdcAmount.default("500"),
    DEPOSIT_DAILY_MAX_USDC: usdcAmount.default("1000"),

    // Emails (receipts, approval requests, payouts, reminders, refunds) go out through
    // Resend. Unset sends none. EMAIL_FROM must be on a domain verified in Resend.
    RESEND_API_KEY: z.string().startsWith("re_", "must be a Resend API key (re_...)").optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    EMAIL_REPLY_TO: z.email().optional(),
    // Device notifications (Web Push). Generate once with `npx web-push generate-vapid-keys`;
    // never change them afterwards, or every device must turn notifications on again.
    VAPID_PUBLIC_KEY: z.preprocess(unquote, z.string().min(40).optional()),
    VAPID_PRIVATE_KEY: z.preprocess(unquote, z.string().min(20).optional()),
    // Who push services can contact about these notifications: mailto: or https: URL.
    VAPID_SUBJECT: z.preprocess(unquote, z.string().regex(/^(mailto:|https:)/, "must start with mailto: or https:").optional()),
    // Dates in emails are written in this time zone.
    EMAIL_TIME_ZONE: z
      .string()
      .refine(isTimeZone, "must be a time zone, e.g. Africa/Lagos")
      .default("Africa/Lagos"),

    // How often the server refunds contributors of pools that missed their goal. 0 turns
    // the built-in schedule off (run `npm run refunds` from an external scheduler instead).
    REFUND_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(300),
    // How many refunds are sent at once.
    REFUND_JOB_CONCURRENCY: z.coerce.number().int().positive().max(20).default(4),
  })
  .superRefine((env, ctx) => {
    if (!env.AUTH_JWKS_URL && !env.AUTH_JWT_SECRET && !env.NEXT_PUBLIC_SUPABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["AUTH_JWKS_URL"], message: "set AUTH_JWKS_URL, AUTH_JWT_SECRET or NEXT_PUBLIC_SUPABASE_URL" });
    }
    if (env.RESEND_API_KEY && !env.EMAIL_FROM) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "set the sender, e.g. PoolFi <noreply@thepoolfi.com>" });
    }
    if (env.DEPOSIT_PROVIDER === "testnet-treasury") {
      if (env.STELLAR_NETWORK_PASSPHRASE !== Networks.TESTNET) {
        ctx.addIssue({
          code: "custom",
          path: ["DEPOSIT_PROVIDER"],
          message: "testnet-treasury deposits are only allowed on testnet",
        });
      }
      if (!env.TREASURY_SECRET) {
        ctx.addIssue({ code: "custom", path: ["TREASURY_SECRET"], message: "required for testnet-treasury deposits" });
      }
    }
  });

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  // A blank `NAME=` line in .env means "not set".
  const parsed = EnvSchema.safeParse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")));
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const jwksUrl =
    e.AUTH_JWKS_URL ??
    (e.NEXT_PUBLIC_SUPABASE_URL ? `${e.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json` : undefined);
  const usesSupabaseAuth = Boolean(jwksUrl && new URL(jwksUrl).pathname.endsWith("/auth/v1/.well-known/jwks.json"));
  return {
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    corsOrigins: (e.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    appUrl: e.APP_URL ?? (e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : null),
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    stellar: {
      rpcUrl: e.STELLAR_RPC_URL,
      networkPassphrase: e.STELLAR_NETWORK_PASSPHRASE,
      poolContractId: e.POOL_CONTRACT_ID,
      usdc: { code: e.USDC_CODE, issuer: e.USDC_ISSUER },
      sponsorSecret: e.SPONSOR_SECRET,
      inclusionFee: e.TX_INCLUSION_FEE,
      txTimeoutSeconds: e.TX_TIMEOUT_SECONDS,
    },
    walletEncryption: {
      key: Buffer.from(e.WALLET_ENCRYPTION_KEY, "base64"),
      version: e.WALLET_ENCRYPTION_KEY_VERSION,
    },
    auth: {
      jwksUrl,
      jwtSecret: e.AUTH_JWT_SECRET,
      // Derive the issuer from the JWKS source so stale or missing app URL variables
      // cannot make the server reject tokens signed by the trusted auth project.
      issuer: issuerFromJwksUrl(jwksUrl) ?? e.AUTH_JWT_ISSUER?.replace(/\/$/, ""),
      // Supabase user access tokens use this audience. Ignore a stale Vercel override
      // when the trusted signing keys are Supabase's Auth JWKS.
      audience: usesSupabaseAuth ? "authenticated" : e.AUTH_JWT_AUDIENCE,
    },
    deposits:
      e.DEPOSIT_PROVIDER && e.TREASURY_SECRET
        ? {
            provider: e.DEPOSIT_PROVIDER,
            treasurySecret: e.TREASURY_SECRET,
            maxPerDeposit: parseUsdc(e.DEPOSIT_MAX_USDC),
            dailyMax: parseUsdc(e.DEPOSIT_DAILY_MAX_USDC),
          }
        : null,
    push:
      e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY
        ? { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT ?? "mailto:hello@thepoolfi.com" }
        : null,
    email:
      e.RESEND_API_KEY && e.EMAIL_FROM
        ? { resendApiKey: e.RESEND_API_KEY, from: e.EMAIL_FROM, replyTo: e.EMAIL_REPLY_TO ?? null, timeZone: e.EMAIL_TIME_ZONE }
        : null,
    refundJob: {
      intervalSeconds: e.REFUND_JOB_INTERVAL_SECONDS,
      concurrency: e.REFUND_JOB_CONCURRENCY,
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
