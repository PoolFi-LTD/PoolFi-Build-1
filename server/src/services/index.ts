import type { Config } from "../config.js";
import type { Db } from "../db.js";
import type { Chain } from "../stellar/chain.js";
import { PoolContract } from "../stellar/pool-contract.js";
import { Deposits } from "./deposits.js";
import { Pools } from "./pools.js";
import { RefundJob, type Logger } from "./refunds.js";
import { Wallets } from "./wallets.js";

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
