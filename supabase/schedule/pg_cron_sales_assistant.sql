-- NOT APPLIED. This file is not in supabase/migrations, so it does not run with the app schema.
-- Run it by hand later, after daily-digest and weekly-report are deployed and
-- pg_cron and pg_net are enabled.
--
-- Phoenix is UTC-7 all year, so 7:00 AM America/Phoenix is 14:00 UTC.
-- Daily digest: every day at 14:00 UTC.
-- Weekly report: Monday at 14:00 UTC, for the prior Monday through Sunday in Phoenix.
--
-- Store the shared secret in Vault first. Do not commit the secret.
--   select vault.create_secret('<paste CRON_SECRET here>', 'cron_secret');
-- The functions read CRON_SECRET from the environment and compare it to x-cron-secret.

select cron.schedule(
  'sales-assistant-daily-digest',
  '0 14 * * *',
  $$
  select net.http_post(
    url := 'https://nmyatpcjqfokmfbssimc.supabase.co/functions/v1/daily-digest',
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

select cron.schedule(
  'sales-assistant-weekly-report',
  '0 14 * * 1',
  $$
  select net.http_post(
    url := 'https://nmyatpcjqfokmfbssimc.supabase.co/functions/v1/weekly-report',
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
