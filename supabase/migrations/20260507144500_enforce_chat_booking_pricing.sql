create or replace function public.enforce_chat_booking_pricing()
returns trigger
language plpgsql
as $$
begin
  if new.source in ('WEB_CHAT', 'WHATSAPP', 'WA_WEBHOOK', 'WHATSAPP_BOT')
    and coalesce(new.qty, 0) > 0
    and (
      coalesce(new.unit_price, 0) <= 0
      or coalesce(new.original_total, new.unit_price * new.qty, 0) <= 0
    )
  then
    raise exception 'Chat bookings require verified non-zero unit pricing'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_chat_booking_pricing on public.bookings;

create trigger enforce_chat_booking_pricing
before insert or update of source, qty, unit_price, original_total, total_amount, status
on public.bookings
for each row
execute function public.enforce_chat_booking_pricing();
