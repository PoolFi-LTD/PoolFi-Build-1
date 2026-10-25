-- A pool that misses its deadline below the goal is no longer refunded by itself:
-- its lifeguard is told once, then chooses to extend the deadline or refund the divers.
alter table pools
  add column missed_notified_at timestamptz,
  add column refund_chosen_at timestamptz;

comment on column pools.missed_notified_at is
  'When the lifeguard was told the deadline passed below the goal; cleared when they extend it.';
comment on column pools.refund_chosen_at is
  'When the lifeguard chose to refund the divers; the refund job then sends the refunds.';

-- Activity lines for the deadline passing and for the lifeguard extending it.
alter table activity drop constraint activity_kind_check;
alter table activity add constraint activity_kind_check
  check (kind in ('payment', 'reminder', 'goal_met', 'approval', 'payout', 'refund', 'joined', 'created', 'missed', 'extended'));
