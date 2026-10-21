import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import { createMailer, type Mailer } from "../email/mailer.ts";
import type { Chain } from "../stellar/chain.ts";
import { PoolContract } from "../stellar/pool-contract.ts";
import { Account, networkName } from "./app/account.ts";
import { Notifications } from "./app/notifications.ts";
import { PoolViews } from "./app/pool-views.ts";
import { AppPools } from "./app/pools.ts";
import { Deposits } from "./deposits.ts";
import { Pools } from "./pools.ts";
import { RefundJob, type Logger } from "./refunds.ts";
import { Wallets } from "./wallets.ts";

export function createServices(
  { config, db, chain, mailer }: { config: Config; db: Db; chain: Chain; mailer?: Mailer },
  log: Logger,
) {
  const contract = new PoolContract(chain);
  const notify = new Notifications(db, mailer ?? createMailer(config.email, log), {
    appUrl: config.appUrl,
    timeZone: config.email?.timeZone ?? "Africa/Lagos",
  });
  const wallets = new Wallets(db, chain, config.walletEncryption);
  const deposits = new Deposits(db, chain, wallets, config.deposits);
  const views = new PoolViews(db, contract, { pool: chain.poolContractId, usdc: chain.usdcContractId });
  return {
    wallets,
    deposits,
    pools: new Pools(db, chain, contract, wallets),
    refunds: new RefundJob(db, chain, contract, wallets, config.refundJob.concurrency, log, notify),
    // What the web app's screens use (/v1/app).
    app: {
      account: new Account(db, chain, wallets, deposits, views, networkName(config.stellar.networkPassphrase)),
      pools: new AppPools(db, chain, contract, wallets, views, notify),
    },
  };
}

export type Services = ReturnType<typeof createServices>;
