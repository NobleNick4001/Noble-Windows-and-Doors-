-- Soft-delete estimates without tripping row level security, and schedule a follow-up
-- when an estimate becomes presented.
-- Run this whole file once in the Supabase SQL editor. Running it again is safe.
-- Do not put secrets in this file.
--
-- Why soft_delete_estimate exists:
-- e_sel only returns rows where deleted_at is null. A signed-in PATCH that sets
-- deleted_at and asks for the row back is rejected (403) because the new row fails
-- that SELECT policy, so deleted_at never changes. This function updates the row
-- without returning it. lock_owner and guard_estimate_outcome still run.
--
-- The app does not delete contract rows. Contracts stay as they are.
--
-- Follow-ups: the browser cannot rely on HubSpot sync to insert follow_ups.
-- authenticated has no insert policy today, so an owner insert would be rejected.
-- The trigger below creates one open follow-up when status becomes presented.
-- It is idempotent: a second open row for the same estimate is ignored.

alter table public.follow_ups add column if not exists note text;

comment on column public.follow_ups.note is
  'Latest interaction. A present stores the estimate summary. The HubSpot backfill can replace it with the latest note, call, or email.';

create unique index if not exists follow_ups_one_open
  on public.follow_ups (estimate_id)
  where status = 'open';

-- Two business days, 5:00pm Phoenix (UTC-7, no daylight saving).
-- 5:00pm Phoenix is midnight UTC on the next calendar day.
create or replace function public.follow_up_due(p_from timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  d date;
  left_days int := 2;
  dow int;
begin
  if p_from is null then
    p_from := now();
  end if;
  d := (p_from at time zone 'America/Phoenix')::date;
  while left_days > 0 loop
    d := d + 1;
    dow := extract(dow from d)::int;
    if dow <> 0 and dow <> 6 then
      left_days := left_days - 1;
    end if;
  end loop;
  return ((d + 1)::timestamp at time zone 'UTC');
end;
$$;

create or replace function public.presented_follow_up_note(e public.estimates)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  ts timestamp;
  amount text;
  when_text text;
  extra text;
  months text[] := array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
begin
  ts := coalesce(e.presented_at, now()) at time zone 'America/Phoenix';
  amount := to_char(coalesce(e.total_amount, 0), 'FM$999,999,990.00');
  when_text := months[extract(month from ts)::int] || ' ' || extract(day from ts)::int || ', ' || extract(year from ts)::int;
  extra := nullif(btrim(coalesce(e.document->>'notes', '')), '');
  if extra is null then
    return 'Presented ' || amount || ' estimate on ' || when_text;
  end if;
  return 'Presented ' || amount || ' estimate on ' || when_text || E'\n' || extra;
end;
$$;

create or replace function public.ensure_presented_follow_up()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op is null then
    raise exception 'not allowed';
  end if;
  if new.deleted_at is not null or new.status is distinct from 'presented' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'presented' and old.deleted_at is null then
    return new;
  end if;
  insert into public.follow_ups (estimate_id, owner_id, due_at, status, note)
  values (
    new.id,
    new.owner_id,
    public.follow_up_due(coalesce(new.presented_at, now())),
    'open',
    public.presented_follow_up_note(new)
  )
  on conflict (estimate_id) where status = 'open' do nothing;
  return new;
end;
$$;

drop trigger if exists estimates_presented_follow_up on public.estimates;
create trigger estimates_presented_follow_up
  after insert or update on public.estimates
  for each row execute function public.ensure_presented_follow_up();

drop policy if exists fu_ins on public.follow_ups;
create policy fu_ins on public.follow_ups
  for insert
  with check (
    public.is_allowed()
    and status = 'open'
    and (owner_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.estimates e
      where e.id = estimate_id
        and e.deleted_at is null
        and e.owner_id = owner_id
        and e.status = 'presented'
        and e.won_at is null
        and e.lost_at is null
        and (e.owner_id = auth.uid() or public.is_admin())
    )
  );

grant insert on public.follow_ups to authenticated;

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

revoke all on function public.follow_up_due(timestamptz) from public, anon, authenticated;
revoke all on function public.presented_follow_up_note(public.estimates) from public, anon, authenticated;
revoke all on function public.ensure_presented_follow_up() from public, anon;
grant execute on function public.ensure_presented_follow_up() to authenticated;

revoke all on function public.soft_delete_estimate(uuid) from public, anon;
grant execute on function public.soft_delete_estimate(uuid) to authenticated;
