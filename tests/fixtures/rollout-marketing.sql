-- Schema/policy-only marketing fixture, verified against metadata 2026-09-09.
create table public.marketing_automation_logs (
  id uuid default gen_random_uuid() not null,
  enrollment_id uuid,
  automation_id uuid not null,
  contact_id uuid not null,
  business_id uuid not null,
  step_position integer,
  step_type text,
  action text not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);
create table public.marketing_events (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  campaign_id uuid,
  contact_id uuid,
  queue_id uuid,
  event_type text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now() not null
);
create table public.marketing_unsubscribe_tokens (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  campaign_id uuid,
  contact_id uuid not null,
  token text not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);
alter table marketing_automation_logs add primary key(id);
alter table marketing_events add primary key(id);
alter table marketing_unsubscribe_tokens add primary key(id), add unique(token);
alter table marketing_events add check(event_type in ('open','click','unsubscribe','bounce','complaint'));

-- Original single-ID relations. The migration must replace these, not add
-- duplicate relationships that make PostgREST embedding ambiguous.
do $$ declare edge record; begin
  for edge in select * from (values
    ('marketing_campaigns','template_id','marketing_templates','set null'),
    ('marketing_queue','campaign_id','marketing_campaigns','cascade'),
    ('marketing_queue','contact_id','marketing_contacts','cascade'),
    ('marketing_automation_enrollments','automation_id','marketing_automations','cascade'),
    ('marketing_automation_enrollments','contact_id','marketing_contacts','cascade'),
    ('marketing_automation_steps','automation_id','marketing_automations','cascade'),
    ('marketing_automation_logs','automation_id','marketing_automations','cascade'),
    ('marketing_automation_logs','contact_id','marketing_contacts','cascade'),
    ('marketing_automation_logs','enrollment_id','marketing_automation_enrollments','set null'),
    ('marketing_unsubscribe_tokens','campaign_id','marketing_campaigns','set null'),
    ('marketing_unsubscribe_tokens','contact_id','marketing_contacts','cascade'),
    ('marketing_events','campaign_id','marketing_campaigns','set null'),
    ('marketing_events','contact_id','marketing_contacts','set null'),
    ('marketing_events','queue_id','marketing_queue','set null')
  ) v(child,col,parent,delete_action) loop
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete %s', edge.child, edge.child||'_'||edge.col||'_fkey', edge.col, edge.parent, edge.delete_action);
  end loop;
end $$;
grant all on marketing_automation_logs, marketing_events, marketing_unsubscribe_tokens to anon, authenticated, service_role;

do $$ declare tab text; cmd text; cmds text[]; begin
  foreach tab in array array['marketing_campaigns','marketing_contacts','marketing_templates','marketing_automations','marketing_queue','marketing_automation_enrollments','marketing_automation_logs','marketing_events','marketing_unsubscribe_tokens'] loop
    execute format('alter table public.%I enable row level security', tab);
    execute format('create policy fixture_service on public.%I for all to service_role using (true) with check (true)', tab);
    cmds := case when tab='marketing_events' then array['select'] when tab='marketing_unsubscribe_tokens' then array[]::text[] when tab='marketing_automation_logs' then array['select','insert'] when tab='marketing_queue' then array['select','insert','update'] else array['select','insert','update','delete'] end;
    foreach cmd in array cmds loop
      execute format('create policy %I on public.%I for %s to authenticated %s %s', 'fixture_auth_'||cmd, tab, cmd,
        case when cmd <> 'insert' then 'using (business_id = any((select current_business_ids())::uuid[]))' else '' end,
        case when cmd in ('insert','update') then 'with check (business_id = any((select current_business_ids())::uuid[]))' else '' end);
    end loop;
  end loop;
end $$;
alter table marketing_automation_steps enable row level security;
create policy fixture_step_service on marketing_automation_steps for all to service_role using(true) with check(true);
create policy fixture_step_own on marketing_automation_steps for all to authenticated
  using (automation_id in (select id from marketing_automations where business_id = any((select current_business_ids())::uuid[])))
  with check (automation_id in (select id from marketing_automations where business_id = any((select current_business_ids())::uuid[])));

