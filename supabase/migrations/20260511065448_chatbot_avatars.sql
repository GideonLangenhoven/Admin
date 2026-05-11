-- Global chatbot avatar catalog. All tenants pick from this shared list;
-- only SUPER_ADMIN can add, edit, or remove entries.

create table if not exists public.chatbot_avatars (
  id uuid primary key default gen_random_uuid(),
  lottie_url text not null unique,
  label text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chatbot_avatars_active_sort
  on public.chatbot_avatars(active, sort_order);

alter table public.chatbot_avatars enable row level security;

drop policy if exists chatbot_avatars_read on public.chatbot_avatars;
create policy chatbot_avatars_read on public.chatbot_avatars
  for select to authenticated
  using (active = true);

drop policy if exists chatbot_avatars_super_admin_all on public.chatbot_avatars;
create policy chatbot_avatars_super_admin_all on public.chatbot_avatars
  for all to authenticated
  using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
        and au.role = 'SUPER_ADMIN'
        and not coalesce(au.suspended, false)
    )
  )
  with check (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
        and au.role = 'SUPER_ADMIN'
        and not coalesce(au.suspended, false)
    )
  );

drop policy if exists chatbot_avatars_service on public.chatbot_avatars;
create policy chatbot_avatars_service on public.chatbot_avatars
  for all to service_role
  using (true) with check (true);

grant select on public.chatbot_avatars to authenticated;
grant all on public.chatbot_avatars to service_role;

-- Seed the initial 11 avatars previously hardcoded in app/settings/page.tsx.
insert into public.chatbot_avatars (lottie_url, sort_order) values
  ('https://lottie.host/f88dfbd9-9fbb-43af-9ac4-400d4f0b96ae/tc9tMgAjqf.lottie', 1),
  ('https://lottie.host/b37e717c-85a0-4b3a-85ac-da0d0c21d0ce/6y2qqYBhTF.lottie', 2),
  ('https://lottie.host/e1aecbea-cf94-47e8-aae2-5f59c567c6d9/zHX4Roi2Eb.lottie', 3),
  ('https://lottie.host/deee1aa7-f9b1-4869-8191-b9dccacb0017/Inaq5Gmhwf.lottie', 4),
  ('https://lottie.host/b73fce61-6b44-489d-9692-f0a769da24a4/dhP4Oftcxd.lottie', 5),
  ('https://lottie.host/ec6b7394-d3cb-4e43-97b5-804cd66d76ad/QhsvIwZ3y8.lottie', 6),
  ('https://lottie.host/ff097c6d-c89a-4206-9b49-002cb4536da9/VHw4byv4mh.lottie', 7),
  ('https://lottie.host/4392b24a-4204-4e8d-9148-6744361410d6/c3f09SNsC0.lottie', 8),
  ('https://lottie.host/f69dd8f8-82b1-476d-b903-d8aa74eba356/o2oHgsa2mD.lottie', 9),
  ('https://lottie.host/0b80a0e1-bc90-4e40-9e0a-602afab059d1/HYkrm9Y0bN.lottie', 10),
  ('https://lottie.host/28fea83d-7e0e-442d-9146-02fb112a8116/uUo4UHGopv.lottie', 11)
on conflict (lottie_url) do nothing;
