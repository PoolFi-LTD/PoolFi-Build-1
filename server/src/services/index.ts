import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import { createMailer, type Mailer } from "../email/mailer.ts";
import type { Chain } from "../stellar/chain.ts";
import { PoolContract } from "../stellar/pool-contract.ts";
import { Admin } from "./admin.ts";
import { Account, networkName } from "./app/account.ts";
import { Notifications } from "./app/notifications.ts";
import { PoolViews } from "./app/pool-views.ts";
import { AppPools } from "./app/pools.ts";
import { Deposits } from "./deposits.ts";
import { Pools } from "./pools.ts";
import { RefundJob, type Logger } from "./refunds.ts";
import { Push, type PushSender } from "./push.ts";
import { TwoStep } from "./two-step.ts";
import { Wallets } from "./wallets.ts";

export function createServices(
  { config, db, chain, mailer, pushSender }: { config: Config; db: Db; chain: Chain; mailer?: Mailer; pushSender?: PushSender },
  log: Logger,
) {
  const contract = new PoolContract(chain);
  const mail = mailer ?? createMailer(config.email, log);
  const push = new Push(db, config.push, log, pushSender);
  const notify = new Notifications(
    db,
    mail,
    { appUrl: config.appUrl, timeZone: config.email?.timeZone ?? "Africa/Lagos" },
    push,
  );
  const wallets = new Wallets(db, chain, config.walletEncryption);
  const deposits = new Deposits(db, chain, wallets, config.deposits);
  const views = new PoolViews(db, contract, { pool: chain.poolContractId, usdc: chain.usdcContractId });
  const refunds = new RefundJob(db, chain, contract, wallets, config.refundJob.concurrency, log, notify);
  const appPools = new AppPools(db, chain, contract, wallets, views, notify, refunds);
  return {
    wallets,
    deposits,
    push,
    // Password, then an emailed code (POST /v1/auth/...).
    twoStep: new TwoStep(
      db,
      mail,
      config.walletEncryption.key,
      { appUrl: config.appUrl, timeZone: config.email?.timeZone ?? "Africa/Lagos" },
      // Without Resend (local development only), codes go to the log.
      config.email || mailer ? null : log,
      config.sessionIdleMinutes,
    ),
    pools: new Pools(db, chain, contract, wallets),
    refunds,
    // What the web app's screens use (/v1/app).
    app: {
      account: new Account(db, chain, wallets, deposits, views, networkName(config.stellar.networkPassphrase)),
      pools: appPools,
    },
    // The PoolFi team's dashboard (/v1/admin).
    admin: new Admin(db, config, chain, views, appPools, wallets, refunds),
  };
}

export type Services = ReturnType<typeof createServices>;
