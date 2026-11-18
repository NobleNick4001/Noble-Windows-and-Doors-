-- NOT a migration. Do not run this file as part of a deploy, and do not apply it
-- until 007_soft_delete_and_follow_ups.sql has been run by hand.
-- This script is not applied by GitHub Pages and was not run against the live project.
--
-- It creates one open follow-up for each non-deleted presented estimate that does
-- not already have one. Won and lost estimates are skipped. The due time is the
-- app rule: two business days from now, 5:00pm Phoenix.
--
-- The note here is the estimate fallback (Presented $X on the date, plus any
-- estimate notes). HubSpot is not queried from SQL. To replace that note with the
-- latest HubSpot note, call, or email, deploy hubspot-sync and call the
-- backfill-followups action. That step only reads HubSpot.

insert into public.follow_ups (estimate_id, owner_id, due_at, status, note)
select
  e.id,
  e.owner_id,
  public.follow_up_due(now()),
  'open',
  public.presented_follow_up_note(e)
from public.estimates e
where e.deleted_at is null
  and e.status = 'presented'
  and e.won_at is null
  and e.lost_at is null
  and not exists (
    select 1 from public.follow_ups f
    where f.estimate_id = e.id
      and f.status = 'open'
  );
