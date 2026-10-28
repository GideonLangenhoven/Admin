-- Operator wording for customer emails (Settings → Email Customisation).
-- Shape: { "<EMAIL_TYPE>": { "subject"?: text, "heading"?: text, "message"?: text } }.
-- Empty / missing keys keep the built-in wording. send-email decides which
-- types honour it; identity, legal and platform emails never do.
alter table public.businesses
  add column if not exists email_overrides jsonb not null default '{}'::jsonb;

-- businesses UPDATE is granted per column since 20260921120000; ordinary tenant
-- settings need an explicit grant. Not added to the anon SELECT allowlist.
grant update (email_overrides) on table public.businesses to authenticated;
