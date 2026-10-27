-- P2 Cron: gyg-availability-hourly calls getyourguide-availability-sync, which
-- answers 503 OTA_NOT_READY on every run while direct OTA connections are
-- blocked (supabase/functions/_shared/ota-readiness.ts). Production already has
-- viator-availability-hourly and ota-reconcile-nightly paused, changed outside
-- migrations; pause all three here so every environment matches.
-- Re-enable them when OTA connectivity is certified.
do $$
declare job record;
begin
  for job in select jobid from cron.job
    where jobname in ('gyg-availability-hourly', 'viator-availability-hourly', 'ota-reconcile-nightly')
  loop
    perform cron.alter_job(job.jobid, active := false);
  end loop;
end $$;
