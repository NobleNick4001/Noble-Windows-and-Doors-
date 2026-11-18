-- Monthly sales dashboard, won timestamp, and HubSpot sync bookkeeping.
-- Run this whole file once in the Supabase SQL editor. Running it again is safe.
-- estimates.deleted_at already exists. This file does not remove it.
-- No secrets belong in this file.

alter table public.estimates add column if not exists deleted_at timestamptz;
alter table public.estimates add column if not exists won_at timestamptz;

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'estimates'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.estimates drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.estimates
  add constraint estimates_status_check
  check (status in ('draft', 'presented', 'signed', 'won', 'lost'));

-- Only an admin can move a won or lost estimate back to another status.
-- The service role has no auth.uid() and may still record the original won or lost write.
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
    if auth.uid() is not null and new.owner_id is distinct from auth.uid() and not public.is_admin() then
      raise exception 'only the owner or an admin can delete an estimate';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists estimates_outcome_guard on public.estimates;
create trigger estimates_outcome_guard
  before update on public.estimates
  for each row execute function public.guard_estimate_outcome();

create table if not exists public.hubspot_sync_state (
  owner_id uuid primary key references public.profiles(id),
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.hubspot_conflicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  estimate_id uuid references public.estimates(id),
  hubspot_object text not null,
  hubspot_id text,
  field text not null,
  app_value text,
  hubspot_value text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.hubspot_leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  hubspot_object text not null check (hubspot_object in ('contact', 'deal')),
  hubspot_id text not null,
  name text,
  phone text,
  email text,
  hubspot_owner_id text,
  uncontacted boolean not null default false,
  synced_at timestamptz not null default now(),
  constraint hubspot_leads_object unique (owner_id, hubspot_object, hubspot_id)
);

alter table public.hubspot_sync_state enable row level security;
alter table public.hubspot_conflicts enable row level security;
alter table public.hubspot_leads enable row level security;

drop policy if exists hs_state_sel on public.hubspot_sync_state;
create policy hs_state_sel on public.hubspot_sync_state
  for select using (public.is_allowed() and (owner_id = auth.uid() or public.is_admin()));

drop policy if exists hs_conf_sel on public.hubspot_conflicts;
create policy hs_conf_sel on public.hubspot_conflicts
  for select using (public.is_allowed() and (owner_id = auth.uid() or public.is_admin()));

drop policy if exists hs_lead_sel on public.hubspot_leads;
create policy hs_lead_sel on public.hubspot_leads
  for select using (public.is_allowed() and (owner_id = auth.uid() or public.is_admin()));

revoke all on public.hubspot_sync_state, public.hubspot_conflicts, public.hubspot_leads from anon, authenticated;
grant select on public.hubspot_sync_state, public.hubspot_conflicts, public.hubspot_leads to authenticated;
grant select, insert, update, delete on public.hubspot_sync_state, public.hubspot_conflicts, public.hubspot_leads to service_role;

-- Admin only. The browser cannot read another rep's rows by calling this as sales.
create or replace function public.admin_sales_bundle()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'only admin can open the team dashboard';
  end if;
  select jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'email', p.email, 'full_name', p.full_name, 'role', p.role, 'hubspot_owner_id', p.hubspot_owner_id
      ) order by p.full_name)
      from public.profiles p
    ), '[]'::jsonb),
    'estimates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'owner_id', e.owner_id, 'customer_name', e.customer_name, 'status', e.status,
        'total_amount', e.total_amount, 'presented_at', e.presented_at, 'signed_at', e.signed_at,
        'won_at', e.won_at, 'lost_at', e.lost_at, 'updated_at', e.updated_at, 'deleted_at', e.deleted_at
      ))
      from public.estimates e
      where e.deleted_at is null
    ), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'owner_id', a.owner_id, 'estimate_id', a.estimate_id, 'set_at', a.set_at, 'source', a.source
      ))
      from public.appointments a
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_sales_bundle() from public, anon;
grant execute on function public.admin_sales_bundle() to authenticated;
