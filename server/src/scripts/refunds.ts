import { loadConfig } from "../config.js";
import { Db } from "../db.js";
import { createServices } from "../services/index.js";
import { Chain } from "../stellar/chain.js";

// One pass of the refund job, for running from an external scheduler (cron, etc.).
const config = loadConfig();
const db = new Db(config.databaseUrl);
const chain = new Chain(config.stellar, (key, fn) => db.withLock(key, fn));
const log = {
  info: (details: object, message: string) => console.log(message, JSON.stringify(details)),
  warn: (details: object, message: string) => console.warn(message, JSON.stringify(details)),
};
try {
  const run = await createServices({ config, db, chain }, log).refunds.runOnce();
  console.log(run ? `Done: ${JSON.stringify(run)}` : "Another server is running the refund job right now; skipped.");
} finally {
  await db.close();
}
