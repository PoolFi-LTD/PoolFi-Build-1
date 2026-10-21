import { Keypair, Operation } from "@stellar/stellar-sdk";
import type { AuthUser } from "../auth.ts";
import { decryptSecret, encryptSecret, type EncryptionKey } from "../crypto.ts";
import type { Db } from "../db.ts";
import type { Chain } from "../stellar/chain.ts";
import { toApiError } from "./chain-errors.ts";

export interface Wallet {
  userId: string;
  address: string;
  activated: boolean;
}

interface WalletRow {
  user_id: string;
  public_key: string;
  secret_ciphertext: Buffer;
  secret_iv: Buffer;
  secret_tag: Buffer;
  key_version: number;
  activated_at: Date | null;
}

/** Binds an encrypted secret to its wallet row. */
const secretContext = (userId: string, publicKey: string) => `poolfi-wallet:${userId}:${publicKey}`;

/**
 * Each user gets a Stellar wallet the moment they first sign in. The backend
 * holds its key (encrypted) and signs for them, so users never handle a wallet.
 */
export class Wallets {
  constructor(
    private readonly db: Db,
    private readonly chain: Chain,
    private readonly key: EncryptionKey,
  ) {}

  /** Records the signed-in user and returns their wallet, creating and activating it if needed. */
  async ensureUser(user: AuthUser): Promise<Wallet> {
    await this.db.query(
      `insert into users (id, email, phone) values ($1, $2, $3)
       on conflict (id) do update set email = coalesce(excluded.email, users.email), phone = coalesce(excluded.phone, users.phone)`,
      [user.id, user.email, user.phone],
    );
    let row = (await this.find(user.id)) ?? (await this.create(user.id));
    if (!row.activated_at) row = await this.activate(row.user_id);
    return toWallet(row);
  }

  /** The user's wallet keypair, for signing on their behalf. */
  async keypair(userId: string): Promise<Keypair> {
    const row = await this.find(userId);
    if (!row) throw new Error(`User ${userId} has no wallet`);
    return this.decrypt(row);
  }

  async address(userId: string): Promise<string | null> {
    return (await this.find(userId))?.public_key ?? null;
  }

  /** The PoolFi user who owns a wallet address, if any. */
  async ownerOf(address: string): Promise<string | null> {
    const [row] = await this.db.query<{ user_id: string }>("select user_id from wallets where public_key = $1", [address]);
    return row?.user_id ?? null;
  }

  private async find(userId: string): Promise<WalletRow | undefined> {
    const [row] = await this.db.query<WalletRow>("select * from wallets where user_id = $1", [userId]);
    return row;
  }

  private async create(userId: string): Promise<WalletRow> {
    const keypair = Keypair.random();
    const secret = encryptSecret(keypair.secret(), this.key, secretContext(userId, keypair.publicKey()));
    await this.db.query(
      `insert into wallets (user_id, public_key, secret_ciphertext, secret_iv, secret_tag, key_version)
       values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do nothing`,
      [userId, keypair.publicKey(), secret.ciphertext, secret.iv, secret.tag, secret.keyVersion],
    );
    // A concurrent first request may have created the wallet first; keep that one.
    const row = await this.find(userId);
    if (!row) throw new Error(`Wallet for ${userId} was not saved`);
    return row;
  }

  /**
   * Creates the wallet's account on Stellar with a USDC trustline. The sponsor
   * pays the account's reserves, so the wallet starts with zero XLM.
   */
  private async activate(userId: string): Promise<WalletRow> {
    return this.db.withLock(`wallet-activation:${userId}`, async () => {
      const row = await this.find(userId);
      if (!row) throw new Error(`User ${userId} has no wallet`);
      if (row.activated_at) return row;

      const keypair = this.decrypt(row);
      const address = keypair.publicKey();
      const exists = await this.chain.accountExists(address);
      const canHoldUsdc = exists && (await this.chain.usdcBalance(address)) !== null;
      let txHash: string | null = null;
      if (!canHoldUsdc) {
        const operations = [
          Operation.beginSponsoringFutureReserves({ sponsoredId: address }),
          ...(exists ? [] : [Operation.createAccount({ destination: address, startingBalance: "0" })]),
          Operation.changeTrust({ asset: this.chain.usdc, source: address }),
          Operation.endSponsoringFutureReserves({ source: address }),
        ];
        try {
          txHash = (await this.chain.submit(this.chain.sponsor, operations, [keypair])).hash;
          await this.chain.waitForAccount(address);
        } catch (error) {
          throw toApiError(error, { pool: this.chain.poolContractId, usdc: this.chain.usdcContractId });
        }
      }

      const [activated] = await this.db.query<WalletRow>(
        "update wallets set activated_at = now(), activation_tx_hash = $2 where user_id = $1 returning *",
        [userId, txHash],
      );
      if (!activated) throw new Error(`Wallet for ${userId} disappeared during activation`);
      return activated;
    });
  }

  private decrypt(row: WalletRow): Keypair {
    const secret = decryptSecret(
      { ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag, keyVersion: row.key_version },
      this.key,
      secretContext(row.user_id, row.public_key),
    );
    const keypair = Keypair.fromSecret(secret);
    if (keypair.publicKey() !== row.public_key) throw new Error(`Wallet key for ${row.user_id} doesn't match its address`);
    return keypair;
  }
}

function toWallet(row: WalletRow): Wallet {
  return { userId: row.user_id, address: row.public_key, activated: row.activated_at !== null };
}
