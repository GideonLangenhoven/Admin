alter table public.invite_tokens
  add column if not exists business_id uuid references public.businesses(id),
  add column if not exists client_name text,
  add column if not exists client_email text,
  add column if not exists wizard_step text;

create index if not exists idx_invite_tokens_business
  on public.invite_tokens(business_id);

comment on column public.invite_tokens.business_id is
  'Skeleton tenant created when the invite was generated. The wizard autosaves onto this business.';
comment on column public.invite_tokens.wizard_step is
  'Resume cursor. Wizard answers live on the real tenant rows; this is the only wizard-owned state.';

alter table public.businesses
  add column if not exists yoco_webhook_status text;

comment on column public.businesses.yoco_webhook_status is
  'null = never attempted, REGISTERED = signing secret stored, PENDING_REGISTRATION = key saved but webhook needs manual setup.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onboarding-assets',
  'onboarding-assets',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;

drop policy if exists "Public read access for onboarding assets" on storage.objects;
create policy "Public read access for onboarding assets"
on storage.objects for select
to public
using (bucket_id = 'onboarding-assets');

drop policy if exists "Anon upload of onboarding assets" on storage.objects;
create policy "Anon upload of onboarding assets"
on storage.objects for insert
to anon
with check (bucket_id = 'onboarding-assets');;
