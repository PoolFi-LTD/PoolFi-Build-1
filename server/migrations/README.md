# Migrations

Each `NNN_name.sql` file runs once, in name order, inside a transaction. Vercel applies
new ones before every build (`scripts/vercel-build.sh`), so a deploy goes live only once
its tables are ready. A migration that fails stops the deploy.

## Rules

The old code keeps serving users while a deploy builds, so every migration must work
with **both** the code before it and the code after it:

1. **Add, don't change.** New columns are nullable or have a default. New tables and
   indexes are fine.
2. **Never rename or drop in the same deploy that stops using it.** Expand, then contract:
   - Deploy 1: add the new column, write to both, read the new one.
   - Deploy 2 (once deploy 1 is live everywhere): drop the old column.
3. **Never edit a file that has already run.** It won't run again. Write a new file.
4. **Big tables:** create indexes with `create index concurrently` in their own file
   (it can't run inside a transaction, so ask before adding one), and backfill in
   batches rather than one huge `update`.
5. **Close new tables to Supabase's API**, as `004_lock_tables.sql` does: enable row
   level security and revoke `anon` and `authenticated`.

Run them yourself with `npm run migrate` (uses `server/.env`).
