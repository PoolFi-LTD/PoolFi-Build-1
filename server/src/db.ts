import pg from "pg";

export type Queryable = Pick<pg.PoolClient, "query">;

export class Db {
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }

  async transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Runs `fn` while holding a Postgres advisory lock on `key`, so work on the
   * same Stellar account (and its sequence number) never overlaps, even across
   * server instances.
   */
  async withLock<T>(key: string, fn: () => Promise<T>, timeoutSeconds = 60): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("select set_config('lock_timeout', $1, false)", [`${timeoutSeconds}s`]);
      await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [key]);
      try {
        return await fn();
      } finally {
        await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
      }
    } finally {
      await client.query("reset lock_timeout").catch(() => {});
      client.release();
    }
  }

  /** Like `withLock`, but returns null straight away if someone else holds the lock. */
  async tryWithLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
        [key],
      );
      if (!rows[0]?.locked) return null;
      try {
        return await fn();
      } finally {
        await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
