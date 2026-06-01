-- L3: Outbound WhatsApp audit log so message delivery is provable rather than
-- fire-and-forget. Written by the WhatsApp send path in _shared/tenant.ts using
-- the service role. Mirrors auto_messages: RLS enabled, no policies (only the
-- service role, which bypasses RLS, reads/writes; admin surfacing goes through a
-- service-role edge function).
create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  to_phone text not null,
  kind text not null default 'text',
  template_name text,
  body text,
  status text not null,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists wa_messages_business_created_idx
  on public.wa_messages (business_id, created_at desc);
create index if not exists wa_messages_provider_msg_idx
  on public.wa_messages (provider_message_id)
  where provider_message_id is not null;

alter table public.wa_messages enable row level security;

-- Audit log holds customer phone numbers and message bodies. Default privileges
-- grant anon full DML; revoke it so anon has no table-level access (mirrors the
-- internal-only auto_messages / idempotency_keys tables).
revoke all on public.wa_messages from anon;
