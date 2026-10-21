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

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8080),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // Comma-separated browser origins allowed to call the API, e.g. https://thepoolfi.com
    CORS_ORIGINS: z.string().optional(),

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
    AUTH_JWKS_URL: z.url().optional(),
    AUTH_JWT_SECRET: z.string().min(32).optional(),
    AUTH_JWT_ISSUER: z.string().min(1).optional(),
    AUTH_JWT_AUDIENCE: z.string().min(1).optional(),

    // Where "Deposit" gets USDC from. Unset disables deposits.
    DEPOSIT_PROVIDER: z.enum(["testnet-treasury"]).optional(),
    TREASURY_SECRET: secretKey.optional(),
    DEPOSIT_MAX_USDC: usdcAmount.default("500"),
    DEPOSIT_DAILY_MAX_USDC: usdcAmount.default("1000"),

    // How often the server refunds contributors of pools that missed their goal. 0 turns
    // the built-in schedule off (run `npm run refunds` from an external scheduler instead).
    REFUND_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(300),
    // How many refunds are sent at once.
    REFUND_JOB_CONCURRENCY: z.coerce.number().int().positive().max(20).default(4),
  })
  .superRefine((env, ctx) => {
    if (!env.AUTH_JWKS_URL && !env.AUTH_JWT_SECRET) {
      ctx.addIssue({ code: "custom", path: ["AUTH_JWKS_URL"], message: "set AUTH_JWKS_URL or AUTH_JWT_SECRET" });
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
  return {
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    corsOrigins: (e.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
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
      jwksUrl: e.AUTH_JWKS_URL,
      jwtSecret: e.AUTH_JWT_SECRET,
      issuer: e.AUTH_JWT_ISSUER,
      audience: e.AUTH_JWT_AUDIENCE,
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
    refundJob: {
      intervalSeconds: e.REFUND_JOB_INTERVAL_SECONDS,
      concurrency: e.REFUND_JOB_CONCURRENCY,
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
