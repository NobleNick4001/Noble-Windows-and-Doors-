-- A sales rep cannot soft-delete an estimate after it has been presented.
-- Run this whole file once in the Supabase SQL editor. Running it again is safe.
-- Do not put secrets in this file. The app deploy does not run it.
--
-- Presented means status is presented, signed, won, or lost, or any of
-- presented_at, signed_at, won_at, or lost_at is set. Follow-up is not a status.
-- The estimate stays "presented" while its follow-up is open.
-- A draft that was never presented can still be deleted by its owner.
-- Admin is public.is_admin(), which requires profiles.role = 'admin'
-- (and the same role on the allowlist). A sales role cannot pass that check.
--
-- Two ways to set deleted_at are closed:
-- 1. soft_delete_estimate, the RPC the app calls.
-- 2. A direct update. e_upd's WITH CHECK rejects deleted_at when the new row
--    still looks presented. The trigger also rejects it from the old row, so a
--    rep cannot clear status and presented_at in the same update and then delete.
--    The trigger also refuses to turn a presented estimate back into a draft.
-- The service role has no auth.uid() and is not blocked (HubSpot sync).

create or replace function public.estimate_was_presented(
  p_status text,
  p_presented_at timestamptz,
  p_signed_at timestamptz,
  p_won_at timestamptz,
  p_lost_at timestamptz
)
returns boolean
language sql
immutable
as $$
  select p_presented_at is not null
    or p_signed_at is not null
    or p_won_at is not null
    or p_lost_at is not null
    or p_status in ('presented', 'signed', 'won', 'lost');
$$;

create or replace function public.guard_estimate_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('won', 'lost') and new.status is distinct from old.status then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'only an admin can reopen a won or lost estimate';
    end if;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    if auth.uid() is not null and not public.is_admin() then
      if old.owner_id is distinct from auth.uid() then
        raise exception 'only the owner or an admin can delete an estimate';
      end if;
      if public.estimate_was_presented(old.status, old.presented_at, old.signed_at, old.won_at, old.lost_at) then
        raise exception 'only an admin can delete an estimate after it has been presented';
      end if;
    end if;
  end if;
  if auth.uid() is not null and not public.is_admin()
     and public.estimate_was_presented(old.status, old.presented_at, old.signed_at, old.won_at, old.lost_at)
     and not public.estimate_was_presented(new.status, new.presented_at, new.signed_at, new.won_at, new.lost_at) then
    raise exception 'only an admin can change a presented estimate back to a draft';
  end if;
  return new;
end;
$$;

-- Replace the RPC. Owner-or-admin still applies. A non-admin cannot delete
-- once the estimate has been presented, even if they own it.
create or replace function public.soft_delete_estimate(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.estimates%rowtype;
begin
  if auth.uid() is null or not public.is_allowed() then
    raise exception 'not allowed';
  end if;
  select * into row from public.estimates where id = p_id;
  if not found then
    raise exception 'estimate not found';
  end if;
  if row.owner_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'only the owner or an admin can delete an estimate';
  end if;
  if not public.is_admin()
     and public.estimate_was_presented(row.status, row.presented_at, row.signed_at, row.won_at, row.lost_at) then
    raise exception 'only an admin can delete an estimate after it has been presented';
  end if;
  if row.deleted_at is not null then
    return true;
  end if;
  update public.estimates
    set deleted_at = now()
    where id = p_id
      and deleted_at is null;
  return true;
end;
$$;

drop policy if exists e_upd on public.estimates;
create policy e_upd on public.estimates
  for update using (public.is_allowed() and deleted_at is null and (owner_id = auth.uid() or public.is_admin()))
  with check (
    public.is_allowed()
    and (owner_id = auth.uid() or public.is_admin())
    and (
      deleted_at is null
      or public.is_admin()
      or not public.estimate_was_presented(status, presented_at, signed_at, won_at, lost_at)
    )
  );

revoke all on function public.estimate_was_presented(text, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.estimate_was_presented(text, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;

revoke all on function public.soft_delete_estimate(uuid) from public, anon;
grant execute on function public.soft_delete_estimate(uuid) to authenticated;
