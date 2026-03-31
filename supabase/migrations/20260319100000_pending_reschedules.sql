-- Pending reschedules: tracks reschedule-with-upgrade flows where payment
-- must be confirmed before the old slot capacity is released.

create table if not exists pending_reschedules (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  business_id uuid not null references businesses(id),
  old_slot_id uuid not null references slots(id),
  new_slot_id uuid not null references slots(id),
  hold_id uuid references holds(id),
  diff numeric not null,
  new_unit_price numeric not null,
  new_total_amount numeric not null,
  new_tour_id uuid references tours(id),
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expired_at timestamptz
);

-- Add hold_type to holds so we can distinguish reschedule holds from booking holds
alter table holds add column if not exists hold_type text not null default 'BOOKING';
-- Add metadata jsonb for storing extra context
alter table holds add column if not exists metadata jsonb;

-- Index for webhook lookups
create index if not exists idx_pending_reschedules_booking_status
  on pending_reschedules(booking_id, status);
create index if not exists idx_pending_reschedules_hold
  on pending_reschedules(hold_id);

-- RLS
alter table pending_reschedules enable row level security;
