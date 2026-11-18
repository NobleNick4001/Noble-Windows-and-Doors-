-- Fix follow_ups insert policy fu_ins.
-- Run this whole file once in the Supabase SQL editor. Running it again is safe.
-- Do not put secrets in this file. Do not apply it from the app deploy.
--
-- The check e.owner_id = owner_id does not compare the estimate to the new
-- follow-up row. Inside the subquery, the bare owner_id binds to estimates,
-- so the comparison is e.owner_id = e.owner_id and always passes.
-- Qualify the new row as follow_ups.owner_id and follow_ups.estimate_id.

drop policy if exists fu_ins on public.follow_ups;
create policy fu_ins on public.follow_ups
  for insert
  with check (
    public.is_allowed()
    and status = 'open'
    and (owner_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.estimates e
      where e.id = follow_ups.estimate_id
        and e.deleted_at is null
        and e.owner_id = follow_ups.owner_id
        and e.status = 'presented'
        and e.won_at is null
        and e.lost_at is null
        and (e.owner_id = auth.uid() or public.is_admin())
    )
  );
