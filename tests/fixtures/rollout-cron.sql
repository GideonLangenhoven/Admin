-- Local doubles only: net.http_post records a request; it NEVER uses a network.
create schema cron;
create schema vault;
create schema net;
create table cron.job(jobid bigint primary key, jobname text, schedule text, command text);
create function cron.alter_job(job_id bigint, command text) returns void language sql as $$
  update cron.job set command = $2 where jobid = $1
$$;
create function cron.unschedule(job_name text) returns boolean language plpgsql as $$
declare removed_count bigint;
begin
  delete from cron.job where jobname = job_name;
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end $$;
create function cron.schedule(job_name text, job_schedule text, job_command text) returns bigint language plpgsql as $$
declare new_id bigint;
begin
  select coalesce(max(jobid), 0) + 1 into new_id from cron.job;
  insert into cron.job(jobid,jobname,schedule,command) values (new_id,job_name,job_schedule,job_command);
  return new_id;
end $$;
create table vault.decrypted_secrets(name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets values ('edge_jobs_service_role_key','local-fixture-server-only-not-a-real-key');
create table net.fixture_requests(url text, headers jsonb, body jsonb, timeout_milliseconds integer);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$
begin insert into net.fixture_requests values (url,headers,body,timeout_milliseconds); return 1; end $$;
insert into cron.job values
  (1,'cron-tasks-every-5-minutes','*/5 * * * *',$job$select net.http_post(url := 'https://fixture.invalid/functions/v1/cron-tasks', headers := '{}'::jsonb, body := '{}'::jsonb);$job$),
  (2,'marketing-dispatch-every-minute','* * * * *',$job$select net.http_post(url := 'https://fixture.invalid/functions/v1/marketing-dispatch', headers := '{}'::jsonb, body := '{}'::jsonb);$job$),
  (3,'marketing-automation-every-5-min','*/5 * * * *',$job$select net.http_post(url := 'https://fixture.invalid/functions/v1/marketing-automation-dispatch', headers := '{}'::jsonb, body := '{}'::jsonb);$job$),
  (4,'review-reminders-daily','23 9 * * *',$job$select net.http_post(url := 'https://fixture.invalid/functions/v1/auto-messages', headers := '{}'::jsonb, body := '{"action":"review_reminders"}'::jsonb);$job$),
  (5,'unrelated-fixture-job','0 0 * * *','select 42');
