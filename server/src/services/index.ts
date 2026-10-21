import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { Chain } from "../stellar/chain.ts";
import { PoolContract } from "../stellar/pool-contract.ts";
import { Deposits } from "./deposits.ts";
import { Pools } from "./pools.ts";
import { RefundJob, type Logger } from "./refunds.ts";
import { Wallets } from "./wallets.ts";

export function createServices({ config, db, chain }: { config: Config; db: Db; chain: Chain }, log: Logger) {
  const contract = new PoolContract(chain);
  const wallets = new Wallets(db, chain, config.walletEncryption);
  return {
    wallets,
    deposits: new Deposits(db, chain, wallets, config.deposits),
    pools: new Pools(db, chain, contract, wallets),
    refunds: new RefundJob(db, chain, contract, wallets, config.refundJob.concurrency, log),
  };
}

export type Services = ReturnType<typeof createServices>;
