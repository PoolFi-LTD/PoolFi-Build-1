import { loadConfig } from "../config.ts";
import { Db } from "../db.ts";
import { migrate } from "../migrate.ts";

const db = new Db(loadConfig().databaseUrl);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await db.close();
}
