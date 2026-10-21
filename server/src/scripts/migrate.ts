import { loadConfig } from "../config.js";
import { Db } from "../db.js";
import { migrate } from "../migrate.js";

const db = new Db(loadConfig().databaseUrl);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await db.close();
}
