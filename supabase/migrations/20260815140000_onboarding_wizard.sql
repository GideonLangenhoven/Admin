-- Client-onboarding wizard rebuild.
--
-- The retired wizard app held SERVICE_ROLE + SETTINGS_ENCRYPTION_KEY behind one
-- static shared invite code. The replacement holds no secrets: super-admin
-- issues a per-client invite token that already points at a skeleton tenant,
-- and the wizard writes through the token-gated onboarding-wizard edge function.
--
-- Token storage stays a plaintext uuid (unlike admin setup tokens and OTPs,
-- which are sha256-hashed). CS has to list invites and copy links, which a hash
-- makes impossible, and the blast radius is bounded: a token only authorises
-- writes into its own half-provisioned tenant, which cannot trade or be
-- invoiced until the wizard finishes. Hardening is single-use + expiry +
-- per-IP rate limiting, all enforced in the edge function.

-- 1. Link each invite to the skeleton tenant it provisions, and remember how
--    far the client got so a refresh or a dropped call resumes in place.
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

-- 2. Yoco webhook registration is fail-soft: if Yoco's API rejects or is
--    unreachable mid-call, we still store the validated secret key and flag the
--    tenant so CS can finish registration afterwards rather than stalling the
--    onboarding call.
alter table public.businesses
  add column if not exists yoco_webhook_status text;

comment on column public.businesses.yoco_webhook_status is
  'null = never attempted, REGISTERED = signing secret stored, PENDING_REGISTRATION = key saved but webhook needs manual setup.';

-- 3. Logo/asset uploads from the wizard. The wizard is anonymous, so inserts
--    are open to anon but fenced by the bucket's size and mime limits.
--    ponytail: if this ever gets abused, move uploads behind the edge function
--    (signed upload URL) rather than adding policy complexity here.
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
with check (bucket_id = 'onboarding-assets');
