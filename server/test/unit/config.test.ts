import { Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";

const valid = {
  DATABASE_URL: "postgres://localhost/poolfi",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
  POOL_CONTRACT_ID: "CCOOBNXMOJTZVGNX7X33ZBQMBEBVITFYVBY4SS67I43UHUW5C2ZY7P2R",
  USDC_ISSUER: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  SPONSOR_SECRET: Keypair.random().secret(),
  WALLET_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  AUTH_JWT_SECRET: "x".repeat(32),
};

describe("loadConfig", () => {
  it("accepts a minimal configuration, treating blank values as unset", () => {
    const config = loadConfig({ ...valid, AUTH_JWKS_URL: "", DEPOSIT_PROVIDER: "", CORS_ORIGINS: "https://a.com, https://b.com" });
    expect(config.auth.jwksUrl).toBeUndefined();
    expect(config.deposits).toBeNull();
    expect(config.corsOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("requires a way to verify sign-ins", () => {
    expect(() => loadConfig({ ...valid, AUTH_JWT_SECRET: "" })).toThrow(/AUTH_JWKS_URL, AUTH_JWT_SECRET or NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("finds Supabase's keys from the project URL, and tidies pasted values", () => {
    const auth = loadConfig({
      ...valid,
      AUTH_JWT_SECRET: "",
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co/",
      AUTH_JWT_ISSUER: ' "https://abc.supabase.co/auth/v1/" ',
      AUTH_JWT_AUDIENCE: "'authenticated'",
    }).auth;
    expect(auth).toMatchObject({
      jwksUrl: "https://abc.supabase.co/auth/v1/.well-known/jwks.json",
      issuer: "https://abc.supabase.co/auth/v1",
      audience: "authenticated",
    });
  });

  it("rejects malformed keys and addresses", () => {
    expect(() => loadConfig({ ...valid, SPONSOR_SECRET: "not-a-secret" })).toThrow(/SPONSOR_SECRET/);
    expect(() => loadConfig({ ...valid, POOL_CONTRACT_ID: valid.USDC_ISSUER })).toThrow(/POOL_CONTRACT_ID/);
    expect(() => loadConfig({ ...valid, WALLET_ENCRYPTION_KEY: "short" })).toThrow(/WALLET_ENCRYPTION_KEY/);
  });

  it("allows treasury deposits on testnet only", () => {
    const deposits = { DEPOSIT_PROVIDER: "testnet-treasury", TREASURY_SECRET: Keypair.random().secret() };
    expect(loadConfig({ ...valid, ...deposits }).deposits?.provider).toBe("testnet-treasury");
    expect(() => loadConfig({ ...valid, ...deposits, STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC })).toThrow(/only allowed on testnet/);
    expect(() => loadConfig({ ...valid, DEPOSIT_PROVIDER: "testnet-treasury" })).toThrow(/TREASURY_SECRET/);
  });
});
