-- Signed-in sessions end after a stretch without activity (10 minutes by default):
-- the app reports activity, and a session quiet for longer must sign in again.
alter table verified_sessions add column last_seen_at timestamptz not null default now();
