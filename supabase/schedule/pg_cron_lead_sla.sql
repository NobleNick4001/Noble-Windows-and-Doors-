-- NOT APPLIED. This file is not in supabase/migrations, so it does not run with the app schema.
-- Run it by hand after lead-sla is deployed, pg_cron and pg_net are enabled,
-- and the Vault secret named cron_secret matches the CRON_SECRET env var.
-- Do not put the secret in this file.
--
-- Every 5 minutes. The deadline itself is lead_call_plan (business hours in Phoenix).
-- This job only notices rows whose call_due_at is already in the past.

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
