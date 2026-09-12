begin;

-- Support the hosted project secret API key as well as the legacy service JWT.
-- Deploy the shared worker key-compatibility fix before applying this migration.
-- The configured Vault value stays in Vault, never in the job command.
do $$
declare
  job record;
  job_url text;
  job_body text;
  secret_count integer;
begin
  -- Local databases without pg_cron do not schedule external work.
  if to_regclass('cron.job') is null then return; end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Provision the edge_jobs_service_role_key Vault secret before enabling authenticated message jobs';
  end if;
  select count(*) into secret_count from vault.decrypted_secrets
    where name = 'edge_jobs_service_role_key' and length(decrypted_secret) > 20;
  if secret_count <> 1 then
    raise exception 'Exactly one edge_jobs_service_role_key Vault secret is required';
  end if;

  for job in select jobid, jobname, command from cron.job where jobname in (
    'cron-tasks-every-5-minutes', 'marketing-dispatch-every-minute',
    'marketing-automation-every-5-min', 'review-reminders-daily'
  ) loop
    -- Keep the configured project URL and schedule. Refuse an unexpected
    -- command shape instead of silently scheduling against another project.
    job_url := (regexp_match(job.command, $re$url\s*:=\s*'([^']+)'$re$, 'i'))[1];
    if job_url is null or job_url !~ '^https://[^/]+/functions/v1/(cron-tasks|marketing-dispatch|marketing-automation-dispatch|auto-messages)$' then
      raise exception 'Unexpected command for job %; review its URL before rollout', job.jobname;
    end if;
    job_body := case when job.jobname = 'review-reminders-daily' then '{"action":"review_reminders"}' else '{}' end;
    perform cron.alter_job(job.jobid, command := format($command$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'edge_jobs_service_role_key')
        ),
        body := %L::jsonb
      );
    $command$, job_url, job_body));
  end loop;
end;
$$;

commit;
