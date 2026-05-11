alter table public.tours
  add column if not exists meeting_point text;

alter table public.businesses
  add column if not exists meeting_point text;

update public.businesses
set meeting_point = nullif(concat_ws(E'\n', meeting_point_address, arrival_instructions), '')
where meeting_point is null
  and (meeting_point_address is not null or arrival_instructions is not null);
