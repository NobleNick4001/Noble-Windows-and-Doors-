-- Sales assistant: follow-ups, appointments, HubSpot owner ids, and a write log.
-- Run this whole file once in the Supabase SQL editor. Running it again is safe.
-- No secrets belong in this file.
-- Mike's HubSpot owner id is left blank. The Accounts screen shows "not set".

alter table public.profiles
  add column if not exists hubspot_owner_id text;

comment on column public.profiles.hubspot_owner_id is
  'HubSpot owner id used for follow-up tasks. Blank means not set. Mike is left blank until an admin sets it.';

alter table public.estimates
  add column if not exists lost_at timestamptz;

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id),
  owner_id uuid not null references public.profiles(id),
  hubspot_task_id text,
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'done', 'canceled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists follow_ups_one_open
  on public.follow_ups (estimate_id)
  where status = 'open';

create index if not exists follow_ups_owner_due
  on public.follow_ups (owner_id, due_at)
  where status = 'open';

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid references public.estimates(id),
  owner_id uuid not null references public.profiles(id),
  set_at timestamptz not null default now(),
  source text not null check (source in ('app', 'hubspot')),
  hubspot_meeting_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists appointments_owner_set
  on public.appointments (owner_id, set_at);

create table if not exists public.assistant_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  estimate_id uuid references public.estimates(id),
  follow_up_id uuid references public.follow_ups(id),
  action text not null,
  hubspot_object text,
  hubspot_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assistant_audit_estimate
  on public.assistant_audit (estimate_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists follow_ups_touch on public.follow_ups;
create trigger follow_ups_touch
  before update on public.follow_ups
  for each row execute function public.touch_updated_at();

create or replace function public.admin_set_hubspot_owner(p_email text, p_owner_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_owner text := nullif(trim(coalesce(p_owner_id, '')), '');
  updated uuid;
begin
  if not public.is_admin() then
    raise exception 'only admin can set a HubSpot owner id';
  end if;
  if v_email = '' then
    raise exception 'enter a valid email';
  end if;
  update public.profiles
  set hubspot_owner_id = v_owner
  where lower(email) = v_email
  returning id into updated;
  if updated is null then
    raise exception 'This person has not signed in yet';
  end if;
  return jsonb_build_object('ok', true, 'email', v_email, 'hubspot_owner_id', v_owner);
end;
$$;

create or replace function public.admin_list_users()
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
    raise exception 'only admin can view users';
  end if;
  select coalesce(jsonb_agg(to_jsonb(u) order by u.full_name, u.email), '[]'::jsonb)
  into result
  from (
    select
      a.email,
      a.full_name,
      a.role,
      a.see_all,
      a.revoked_at,
      p.id as profile_id,
      p.hubspot_owner_id,
      true as on_list
    from public.allowed_users a
    left join public.profiles p on lower(p.email) = a.email
    union all
    select
      lower(p.email) as email,
      coalesce(p.full_name, '') as full_name,
      p.role,
      false as see_all,
      null::timestamptz as revoked_at,
      p.id as profile_id,
      p.hubspot_owner_id,
      false as on_list
    from public.profiles p
    where p.email is not null
      and not exists (
        select 1 from public.allowed_users a where a.email = lower(p.email)
      )
  ) u;
  return result;
end;
$$;

alter table public.follow_ups enable row level security;
alter table public.appointments enable row level security;
alter table public.assistant_audit enable row level security;

drop policy if exists fu_sel on public.follow_ups;
create policy fu_sel on public.follow_ups
  for select using (public.is_allowed() and (owner_id = auth.uid() or public.is_admin()));

drop policy if exists ap_sel on public.appointments;
drop policy if exists ap_ins on public.appointments;
create policy ap_sel on public.appointments
  for select using (public.is_allowed() and (owner_id = auth.uid() or public.is_admin()));
create policy ap_ins on public.appointments
  for insert with check (
    public.is_allowed()
    and source = 'app'
    and (owner_id = auth.uid() or public.is_admin())
    and (
      estimate_id is null
      or exists (
        select 1 from public.estimates e
        where e.id = estimate_id
          and e.deleted_at is null
          and e.owner_id = owner_id
          and (e.owner_id = auth.uid() or public.is_admin())
      )
    )
  );

drop policy if exists au_sel on public.assistant_audit;
create policy au_sel on public.assistant_audit
  for select using (public.is_allowed() and (actor_id = auth.uid() or public.is_admin()));

revoke all on public.follow_ups, public.appointments, public.assistant_audit from anon;
grant select on public.follow_ups to authenticated;
grant select, insert on public.appointments to authenticated;
grant select on public.assistant_audit to authenticated;
revoke delete, update on public.follow_ups from authenticated;
revoke delete, update on public.appointments from authenticated;
revoke insert, update, delete on public.assistant_audit from authenticated;

grant select, insert, update on public.follow_ups to service_role;
grant select, insert, update on public.appointments to service_role;
grant select, insert on public.assistant_audit to service_role;
grant select, update on public.profiles to service_role;
grant select, update on public.estimates to service_role;

revoke all on function public.admin_set_hubspot_owner(text, text) from public, anon;
grant execute on function public.admin_set_hubspot_owner(text, text) to authenticated;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
