-- NOT APPLIED. This file is not in supabase/migrations, so it does not run with the app schema.
-- Run it by hand in the SQL editor after migration 010_invalid_leads.sql.
-- Do not run it from the app. Do not run it before that migration.
--
-- Hard-delete the unassigned backlog that was never worked:
-- no owner, never assigned, never called, and no estimate.
-- Invalid leads are kept (stage invalid, or invalid_at set).
-- The next HubSpot pull re-adds only leads created in the last 30 days.
-- public.leads refuses ordinary deletes. This script turns that off for
-- this statement and turns it back on.

alter table public.leads disable trigger leads_no_delete;

delete from public.leads
where owner_id is null
  and assigned_at is null
  and called_at is null
  and estimate_id is null
  and stage is distinct from 'invalid'
  and invalid_at is null;

alter table public.leads enable trigger leads_no_delete;
