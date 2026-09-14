begin;

-- These jobs sweep multiple businesses and call provider APIs. pg_net's
-- five-second default can disconnect before a healthy worker finishes.
-- Preserve the URL, Vault authentication, payload and existing schedule.
do $$
declare job record;
begin
  if to_regclass('cron.job') is null then return; end if;
  for job in select jobid,jobname,command from cron.job where jobname in (
    'cron-tasks-every-5-minutes','marketing-dispatch-every-minute',
    'marketing-automation-every-5-min','review-reminders-daily'
  ) loop
    if job.command !~ 'net\.http_post\s*\(' or job.command !~ 'body\s*:=' then
      raise exception 'Unexpected command shape for %',job.jobname;
    end if;
    if job.command ~ 'timeout_milliseconds\s*:=' then
      perform cron.alter_job(job.jobid, command := regexp_replace(
        job.command,'timeout_milliseconds\s*:=\s*[0-9]+','timeout_milliseconds := 60000'));
    else
      perform cron.alter_job(job.jobid, command := regexp_replace(
        job.command,'body\s*:=','timeout_milliseconds := 60000, body :='));
    end if;
  end loop;
end;
$$;

commit;
