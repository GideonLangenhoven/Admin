-- pg_cron uses UTC. South Africa has no daylight saving time, so 22:05 UTC
-- rolls Claire's demo forward at 00:05 Africa/Johannesburg every day.
select cron.unschedule('refresh-claires-hiking-demo-daily')
where exists (
  select 1 from cron.job where jobname = 'refresh-claires-hiking-demo-daily'
);

select cron.schedule(
  'refresh-claires-hiking-demo-daily',
  '5 22 * * *',
  $$
    select public.refresh_claires_hiking_demo_dates(id)
    from public.businesses
    where subdomain = 'claires-hiking';
  $$
);
