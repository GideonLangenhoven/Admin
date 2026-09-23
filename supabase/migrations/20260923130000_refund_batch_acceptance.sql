begin;

-- One row atomically records the complete accepted selection. Item states are
-- changed under row locks; an interrupted in-flight item is never reclaimed
-- as unsubmitted. The existing refund_operations table owns money identity.
create table public.refund_batches (
  id uuid primary key,
  business_id uuid not null references public.businesses(id),
  actor_user_id text not null,
  actor_role text not null,
  booking_ids uuid[] not null check (cardinality(booking_ids) between 1 and 100),
  results jsonb not null check (jsonb_typeof(results) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refund_batches_actor_idx on public.refund_batches
  (business_id, actor_user_id, created_at desc);
alter table public.refund_batches enable row level security;
revoke all on public.refund_batches from public, anon, authenticated;
grant select, insert, update on public.refund_batches to service_role;

create function public.claim_refund_batch_item(p_batch_id uuid, p_booking_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.refund_batches
  set results = jsonb_set(results, array[p_booking_id::text],
      jsonb_build_object('booking_id', p_booking_id, 'status', 'submitting', 'ok', false)),
      updated_at = now()
  where id = p_batch_id and p_booking_id = any(booking_ids)
    and results -> p_booking_id::text ->> 'status' = 'unprocessed';
  return found;
end $$;
revoke all on function public.claim_refund_batch_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_refund_batch_item(uuid, uuid) to service_role;

create function public.record_refund_batch_item(p_batch_id uuid, p_booking_id uuid, p_result jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_result ->> 'booking_id' is distinct from p_booking_id::text
      or p_result ->> 'status' not in ('completed', 'pending', 'manual_action', 'failed', 'unknown') then
    return false;
  end if;
  update public.refund_batches
  set results = jsonb_set(results, array[p_booking_id::text], p_result), updated_at = now()
  where id = p_batch_id and p_booking_id = any(booking_ids)
    and results -> p_booking_id::text ->> 'status' = 'submitting';
  return found;
end $$;
revoke all on function public.record_refund_batch_item(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_refund_batch_item(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
