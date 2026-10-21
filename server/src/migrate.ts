import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./db.ts";

export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;

/** Applies every `migrations/*.sql` file not applied yet, in name order. Returns their names. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return db.withLock("poolfi:migrations", async () => {
    await db.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name),
    );
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await db.transaction(async (client) => {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
      });
      applied.push(file);
    }
    return applied;
  });
}
