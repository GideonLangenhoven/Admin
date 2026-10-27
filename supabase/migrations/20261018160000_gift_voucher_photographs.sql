-- Experience-specific artwork, captured when the gift is bought so later edits
-- do not change a voucher already sent. Design selection never changes redemption.
alter table public.tours add column if not exists voucher_image_url text;
alter table public.vouchers
  add column if not exists gift_tour_id uuid,
  add column if not exists gift_tour_name text,
  add column if not exists gift_image_url text;

create or replace function public.snapshot_gift_voucher_design()
returns trigger language plpgsql security definer set search_path = '' as $$
declare chosen record;
begin
  if TG_OP = 'UPDATE' then
    if new.gift_tour_id is distinct from old.gift_tour_id
      or new.gift_tour_name is distinct from old.gift_tour_name
      or new.gift_image_url is distinct from old.gift_image_url then
      raise exception 'The design of an issued voucher cannot be changed' using errcode = '23514';
    end if;
    return new;
  end if;
  -- Ignore caller-supplied artwork and names; resolve only inside this tenant.
  new.gift_tour_name := null;
  new.gift_image_url := null;
  if new.gift_tour_id is not null then
    select t.name, coalesce(nullif(t.voucher_image_url, ''), nullif(t.image_url, '')) as image
      into chosen from public.tours t
      where t.id = new.gift_tour_id and t.business_id = new.business_id and t.active;
    if not found then
      raise exception 'Choose an available experience for this operator' using errcode = '23514';
    end if;
    new.gift_tour_name := chosen.name;
    new.gift_image_url := chosen.image;
  end if;
  if new.gift_image_url is null then
    select nullif(b.email_img_gift, '') into new.gift_image_url
      from public.businesses b where b.id = new.business_id;
  end if;
  return new;
end $$;
revoke all on function public.snapshot_gift_voucher_design() from public, anon, authenticated;
drop trigger if exists snapshot_gift_voucher_design on public.vouchers;
create trigger snapshot_gift_voucher_design before insert or update on public.vouchers
for each row execute function public.snapshot_gift_voucher_design();

-- Existing table grants and tenant RLS continue to apply; this is public artwork.
grant select (voucher_image_url) on public.tours to anon, authenticated;
grant select (gift_tour_id, gift_tour_name, gift_image_url) on public.vouchers to anon, authenticated;
