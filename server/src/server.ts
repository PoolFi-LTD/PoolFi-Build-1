import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { Db } from "./db.ts";
import { migrate } from "./migrate.ts";
import { Chain } from "./stellar/chain.ts";
import { PoolContract } from "./stellar/pool-contract.ts";

const config = loadConfig();
const db = new Db(config.databaseUrl, config.databasePoolMax);
const chain = new Chain(config.stellar, (key, fn) => db.withLock(key, fn));

const applied = await migrate(db);

// Refuse to start against a contract or sponsor that can't work.
const token = await new PoolContract(chain).token();
if (token !== chain.usdcContractId) {
  throw new Error(`Pool contract ${chain.poolContractId} uses token ${token}, not USDC ${chain.usdcContractId}`);
}
if (!(await chain.accountExists(chain.sponsor.publicKey()))) {
  throw new Error(`Sponsor account ${chain.sponsor.publicKey()} doesn't exist on this network`);
}

const { app, services } = await buildApp({ config, db, chain });
if (applied.length > 0) app.log.info({ applied }, "applied database migrations");
app.log.info({ poolContractId: chain.poolContractId, sponsor: chain.sponsor.publicKey() }, "connected to Stellar");
await app.listen({ port: config.port, host: config.host });

// Refund contributors of pools that missed their goal, on a schedule.
let refundRun: Promise<unknown> | null = null;
const runRefunds = () => {
  refundRun ??= services.refunds
    .runOnce()
    .catch((error: unknown) => app.log.error({ err: error }, "refund job failed"))
    .finally(() => {
      refundRun = null;
    });
};
const refundTimer =
  config.refundJob.intervalSeconds > 0 ? setInterval(runRefunds, config.refundJob.intervalSeconds * 1000) : null;
if (refundTimer) runRefunds();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    if (refundTimer) clearInterval(refundTimer);
    await refundRun;
    await app.close();
    await db.close();
    process.exit(0);
  });
}
