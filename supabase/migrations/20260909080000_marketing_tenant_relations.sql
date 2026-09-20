begin;

-- Composite keys enforce tenant identity even for service-role writers.
create unique index if not exists marketing_templates_id_business_key on public.marketing_templates(id, business_id);
create unique index if not exists marketing_campaigns_id_business_key on public.marketing_campaigns(id, business_id);
create unique index if not exists marketing_contacts_id_business_key on public.marketing_contacts(id, business_id);
create unique index if not exists marketing_automations_id_business_key on public.marketing_automations(id, business_id);
create unique index if not exists marketing_enrollments_id_business_key on public.marketing_automation_enrollments(id, business_id);
create unique index if not exists marketing_queue_id_business_key on public.marketing_queue(id, business_id);

-- Keep each original FK name, embedding relationship and delete behavior.
-- SET NULL clears only the reference, never the row's tenant identity (PG15+).
-- Adding parallel FKs instead would make existing PostgREST embeds ambiguous.
do $$ declare edge record; begin
  for edge in select * from (values
    ('marketing_campaigns','template_id','marketing_templates','set null'),
    ('marketing_queue','campaign_id','marketing_campaigns','cascade'),
    ('marketing_queue','contact_id','marketing_contacts','cascade'),
    ('marketing_automation_enrollments','automation_id','marketing_automations','cascade'),
    ('marketing_automation_enrollments','contact_id','marketing_contacts','cascade'),
    ('marketing_automation_logs','automation_id','marketing_automations','cascade'),
    ('marketing_automation_logs','contact_id','marketing_contacts','cascade'),
    ('marketing_automation_logs','enrollment_id','marketing_automation_enrollments','set null'),
    ('marketing_unsubscribe_tokens','campaign_id','marketing_campaigns','set null'),
    ('marketing_unsubscribe_tokens','contact_id','marketing_contacts','cascade'),
    ('marketing_events','campaign_id','marketing_campaigns','set null'),
    ('marketing_events','contact_id','marketing_contacts','set null'),
    ('marketing_events','queue_id','marketing_queue','set null')
  ) v(child,col,parent,delete_action) loop
    execute format(
      'alter table public.%I drop constraint if exists %I, add constraint %I foreign key (%I, business_id) references public.%I(id, business_id) on delete %s',
      edge.child, edge.child||'_'||edge.col||'_fkey', edge.child||'_'||edge.col||'_fkey', edge.col, edge.parent,
      case when edge.delete_action='set null' then format('set null (%I)', edge.col) else 'cascade' end
    );
  end loop;
end $$;

-- Keep the editor's existing JSON payload. A generated reference lets native
-- FKs validate templates, including concurrent changes and parent deletion.
-- Empty template selections remain valid while a draft is being edited.
alter table public.marketing_automation_steps
  add column business_id uuid,
  add column template_id uuid generated always as (
    case when step_type = 'send_email' then nullif(config->>'template_id', '')::uuid end
  ) stored;
update public.marketing_automation_steps s set business_id = a.business_id
  from public.marketing_automations a where a.id = s.automation_id;
alter table public.marketing_automation_steps alter column business_id set not null;

create or replace function public.set_marketing_step_business()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select a.business_id into new.business_id from public.marketing_automations a where a.id = new.automation_id;
  return new;
end $$;
revoke all on function public.set_marketing_step_business() from public, anon, authenticated;
create trigger marketing_step_business
  before insert or update of automation_id, business_id on public.marketing_automation_steps
  for each row execute function public.set_marketing_step_business();

alter table public.marketing_automation_steps
  drop constraint marketing_automation_steps_automation_id_fkey,
  add constraint marketing_automation_steps_automation_id_fkey
    foreign key (automation_id, business_id) references public.marketing_automations(id, business_id) on delete cascade,
  add constraint marketing_automation_steps_template_id_fkey
    foreign key (template_id, business_id) references public.marketing_templates(id, business_id);
create index marketing_steps_template_business_idx on public.marketing_automation_steps(template_id, business_id);

-- Preserve the existing ability to delete a template: clear its selection in
-- affected steps, rather than leaving a dangling JSON reference. A generated
-- column cannot be the target of an FK's SET NULL action, hence this trigger.
create or replace function public.clear_deleted_marketing_step_template()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.marketing_automation_steps set config = config - 'template_id'
    where template_id = old.id and business_id = old.business_id;
  return old;
end $$;
revoke all on function public.clear_deleted_marketing_step_template() from public, anon, authenticated;
create trigger marketing_step_template_deleted before delete on public.marketing_templates
  for each row execute function public.clear_deleted_marketing_step_template();

-- Constraints are deliberately validated at rollout. Inconsistent legacy
-- references must be explicitly repaired, never silently reassigned/deleted.

notify pgrst, 'reload schema';
commit;
