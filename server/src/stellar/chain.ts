import {
  Account,
  Asset,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  xdr,
  type FeeBumpTransaction,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Config } from "../config.js";
import { ChainError, contractFailure, transactionFailure } from "./errors.js";

/** Serializes work per key; used so one Stellar account never sends two transactions at once. */
export type Lock = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

export interface Submitted {
  hash: string;
  ledger: number;
  returnValue?: xdr.ScVal;
}

/** Talks to Stellar: reads, contract calls signed by a user's wallet, and classic transactions. */
export class Chain {
  readonly rpc: rpc.Server;
  readonly sponsor: Keypair;
  readonly usdc: Asset;
  readonly usdcContractId: string;
  readonly poolContractId: string;
  private readonly pool: Contract;

  constructor(
    private readonly config: Config["stellar"],
    private readonly lock: Lock,
  ) {
    this.rpc = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
    this.sponsor = Keypair.fromSecret(config.sponsorSecret);
    this.usdc = new Asset(config.usdc.code, config.usdc.issuer);
    this.usdcContractId = this.usdc.contractId(config.networkPassphrase);
    this.poolContractId = config.poolContractId;
    this.pool = new Contract(config.poolContractId);
  }

  async accountExists(address: string): Promise<boolean> {
    const key = xdr.LedgerKey.account(
      new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(address).xdrPublicKey() }),
    );
    const { entries } = await this.rpc.getLedgerEntries(key);
    return entries.length > 0;
  }

  /** Waits until a just-created account is visible to every RPC server behind the endpoint. */
  async waitForAccount(address: string): Promise<void> {
    await this.loadAccount(address);
  }

  /**
   * Loads an account for its sequence number. A just-created account can take a
   * moment to appear on every RPC server behind a load balancer, so "not found"
   * is retried briefly.
   */
  private async loadAccount(address: string, attempts = 10): Promise<Account> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.rpc.getAccount(address);
      } catch (error) {
        if (attempt >= attempts || !String(error).includes("Account not found")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /** The address's USDC balance in base units, or null if it can't hold USDC (no trustline). */
  async usdcBalance(address: string): Promise<bigint | null> {
    const { balanceEntry } = await this.rpc.getAssetBalance(address, this.usdc, this.config.networkPassphrase);
    return balanceEntry ? BigInt(balanceEntry.amount) : null;
  }

  /** Simulates a read-only pool contract call and returns its result. */
  async read(method: string, args: xdr.ScVal[] = []): Promise<xdr.ScVal> {
    const tx = new TransactionBuilder(new Account(this.sponsor.publicKey(), "0"), {
      fee: String(this.config.inclusionFee),
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.pool.call(method, ...args))
      .setTimeout(this.config.txTimeoutSeconds)
      .build();
    const sim = await this.rpc.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw contractFailure(sim.events, sim.error);
    if (!sim.result) throw new ChainError("rejected", `${method} returned no result`);
    return sim.result.retval;
  }

  /**
   * Calls the pool contract as `signer`. The signer's wallet is the transaction
   * source, so its signature authorizes the call; the sponsor pays the fee
   * through a fee bump, so the wallet needs no XLM. The sponsor can also be the
   * signer, for calls anyone may make.
   */
  async invoke(signer: Keypair, method: string, args: xdr.ScVal[]): Promise<Submitted> {
    return this.lock(`stellar:${signer.publicKey()}`, () => retryOnStaleSequence(async () => {
      const account = await this.loadAccount(signer.publicKey());
      const tx = new TransactionBuilder(account, {
        fee: String(this.config.inclusionFee),
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(this.pool.call(method, ...args))
        .setTimeout(this.config.txTimeoutSeconds)
        .build();
      const sim = await this.rpc.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) throw contractFailure(sim.events, sim.error);

      const prepared = rpc.assembleTransaction(tx, sim).build();
      prepared.sign(signer);
      if (signer.publicKey() === this.sponsor.publicKey()) return this.send(prepared);
      const bumped = TransactionBuilder.buildFeeBumpTransaction(
        this.sponsor,
        String(this.config.inclusionFee),
        prepared,
        this.config.networkPassphrase,
      );
      bumped.sign(this.sponsor);
      return this.send(bumped);
    }));
  }

  /** Sends classic operations from `source`, which pays the fee. `cosigners` sign too. */
  async submit(source: Keypair, operations: xdr.Operation[], cosigners: Keypair[] = []): Promise<Submitted> {
    return this.lock(`stellar:${source.publicKey()}`, () => retryOnStaleSequence(async () => {
      const builder = new TransactionBuilder(await this.loadAccount(source.publicKey()), {
        fee: String(this.config.inclusionFee),
        networkPassphrase: this.config.networkPassphrase,
      });
      for (const operation of operations) builder.addOperation(operation);
      const tx = builder.setTimeout(this.config.txTimeoutSeconds).build();
      tx.sign(source, ...cosigners);
      return this.send(tx);
    }));
  }

  private async send(tx: Transaction | FeeBumpTransaction): Promise<Submitted> {
    const sent = await this.rpc.sendTransaction(tx);
    if (sent.status === "ERROR") throw transactionFailure(sent.errorResult, sent.diagnosticEvents, sent.hash);
    if (sent.status === "TRY_AGAIN_LATER") {
      throw new ChainError("busy", "The Stellar network is busy.", { hash: sent.hash });
    }

    const result = await this.rpc.pollTransaction(sent.hash, {
      attempts: this.config.txTimeoutSeconds,
      sleepStrategy: () => 1000,
    });
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash: sent.hash, ledger: result.ledger, returnValue: result.returnValue };
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw transactionFailure(result.resultXdr, result.diagnosticEventsXdr, sent.hash);
    }
    throw new ChainError("timeout", `Transaction ${sent.hash} was not confirmed in time.`, { hash: sent.hash });
  }
}

/**
 * Retries a transaction the network rejected for a stale sequence number, which
 * happens if something outside this server used the same account at the same
 * time. Each attempt reloads the account, so it gets the current number.
 */
async function retryOnStaleSequence<T>(send: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      const stale = error instanceof ChainError && JSON.stringify(error.details.result ?? "").includes("tx_bad_seq");
      if (!stale || attempt >= attempts) throw error;
    }
  }
}
