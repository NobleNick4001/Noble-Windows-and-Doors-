-- NOT APPLIED. This file is not in supabase/migrations, so it does not run with the app schema.
-- Run it by hand after lead-sla is deployed, pg_cron and pg_net are enabled,
-- and the Vault secret named cron_secret matches the CRON_SECRET env var.
-- Do not put the secret in this file. Running it again replaces the same job.
--
-- Every 5 minutes, all day. The schedule stays simple.
-- lead-sla checks America/Phoenix itself (UTC-7, no daylight saving):
--   Mon–Fri 7:00 AM–6:00 PM and Sat–Sun 10:00 AM–4:00 PM, close exclusive.
-- Inside that window it pulls unassigned HubSpot leads. It does not text from the pull.
-- On every run it texts admins once after a lead's call_due_at has passed.

do $$
begin
  perform cron.unschedule('lead-sla');
exception
  when others then
    null;
end $$;

select cron.schedule(
  'lead-sla',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://nmyatpcjqfokmfbssimc.supabase.co/functions/v1/lead-sla',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
