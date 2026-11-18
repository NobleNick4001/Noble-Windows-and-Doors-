-- Lead assignment pipeline.
-- Run this whole file once in the Supabase SQL editor. Running it again is safe.
-- Do not put secrets in this file. The app deploy does not run it.
--
-- Call deadline, America/Phoenix, clock only runs inside the window:
--   Mon–Fri 7:00 AM–6:00 PM, 1 hour budget
--   Sat–Sun 10:00 AM–4:00 PM, 4 hour budget
-- The close is exclusive. Assigned outside a window, the clock starts at the
-- next opening and that opening sets the budget. Leftover time continues at
-- the next opening. public.lead_call_plan is the server copy of
-- supabase/functions/_shared/lead-clock.js.

alter table public.profiles
  add column if not exists phone text;

comment on column public.profiles.phone is
  'US mobile in E.164 for lead texts. Blank means not set. Never a customer number.';

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id),
  hubspot_contact_id text,
  hubspot_deal_id text,
  name text,
  phone text,
  email text,
  address text,
  notes text,
  source text,
  stage text not null default 'new' check (stage in ('new', 'called', 'appointment', 'presented', 'follow_up', 'won', 'lost')),
  assigned_at timestamptz,
  call_due_at timestamptz,
  call_window text check (call_window in ('weekday', 'weekend')),
  called_at timestamptz,
  appointment_at timestamptz,
  estimate_id uuid references public.estimates(id),
  rep_text_at timestamptz,
  rep_text_id text,
  rep_text_error text,
  admin_alert_at timestamptz,
  admin_alert_id text,
  admin_alert_error text,
  admin_alert_attempts int not null default 0,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on column public.leads.address is
  'Street, city, or zip from HubSpot. A zip alone is enough. Blank means omit it from texts.';

create unique index if not exists leads_contact_uid
  on public.leads (hubspot_contact_id)
  where hubspot_contact_id is not null and deleted_at is null;

create unique index if not exists leads_deal_uid
  on public.leads (hubspot_deal_id)
  where hubspot_deal_id is not null and deleted_at is null;

create index if not exists leads_owner_stage
  on public.leads (owner_id, stage)
  where deleted_at is null;

create index if not exists leads_call_due
  on public.leads (call_due_at)
  where deleted_at is null and stage = 'new' and called_at is null and admin_alert_at is null;

alter table public.appointments
  add column if not exists lead_id uuid references public.leads(id);

create unique index if not exists appointments_one_lead
  on public.appointments (lead_id)
  where lead_id is not null and source = 'app';

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch
  before update on public.leads
  for each row execute function public.touch_updated_at();

create or replace function public.lead_call_plan(p_from timestamptz)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  ts timestamp;
  d date;
  tod time;
  open_t time;
  close_t time;
  budget interval;
  window_name text;
  start_ts timestamptz;
  cursor timestamptz;
  close_ts timestamptz;
  available interval;
  left_iv interval;
  i int;
  dow int;
begin
  if p_from is null then
    p_from := now();
  end if;
  ts := p_from at time zone 'America/Phoenix';
  d := ts::date;
  tod := ts::time;
  dow := extract(dow from d)::int;
  if dow in (0, 6) then
    open_t := time '10:00';
    close_t := time '16:00';
    budget := interval '4 hours';
    window_name := 'weekend';
  else
    open_t := time '07:00';
    close_t := time '18:00';
    budget := interval '1 hour';
    window_name := 'weekday';
  end if;

  if tod >= open_t and tod < close_t then
    start_ts := p_from;
  elsif tod < open_t then
    start_ts := (d + open_t) at time zone 'America/Phoenix';
  else
    d := d + 1;
    dow := extract(dow from d)::int;
    if dow in (0, 6) then
      open_t := time '10:00';
      close_t := time '16:00';
      budget := interval '4 hours';
      window_name := 'weekend';
    else
      open_t := time '07:00';
      close_t := time '18:00';
      budget := interval '1 hour';
      window_name := 'weekday';
    end if;
    start_ts := (d + open_t) at time zone 'America/Phoenix';
  end if;

  cursor := start_ts;
  left_iv := budget;
  for i in 1..21 loop
    ts := cursor at time zone 'America/Phoenix';
    d := ts::date;
    dow := extract(dow from d)::int;
    if dow in (0, 6) then
      close_t := time '16:00';
    else
      close_t := time '18:00';
    end if;
    close_ts := (d + close_t) at time zone 'America/Phoenix';
    available := close_ts - cursor;
    if available >= left_iv then
      return jsonb_build_object(
        'due_at', cursor + left_iv,
        'call_window', window_name,
        'budget_minutes', (extract(epoch from budget) / 60)::int
      );
    end if;
    left_iv := left_iv - available;
    d := d + 1;
    dow := extract(dow from d)::int;
    if dow in (0, 6) then
      open_t := time '10:00';
    else
      open_t := time '07:00';
    end if;
    cursor := (d + open_t) at time zone 'America/Phoenix';
  end loop;
  raise exception 'lead clock did not resolve';
end;
$$;

create or replace function public.block_lead_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'hard delete is disabled; set deleted_at';
end;
$$;

drop trigger if exists leads_no_delete on public.leads;
create trigger leads_no_delete
  before delete on public.leads
  for each row execute function public.block_lead_delete();

create or replace function public.lead_visible(p_owner uuid)
returns boolean
language sql
stable
as $$
  select public.is_allowed() and (public.is_admin() or p_owner = auth.uid());
$$;

create or replace function public.lead_mark_called(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.leads%rowtype;
begin
  if auth.uid() is null or not public.is_allowed() then
    raise exception 'not allowed';
  end if;
  select * into v from public.leads where id = p_id and deleted_at is null;
  if not found then
    raise exception 'lead not found';
  end if;
  if not public.lead_visible(v.owner_id) then
    raise exception 'not allowed';
  end if;
  if v.owner_id is null then
    raise exception 'assign this lead first';
  end if;
  if v.stage in ('won', 'lost') then
    raise exception 'this lead is already closed';
  end if;
  if v.called_at is null then
    update public.leads
      set called_at = now(),
          stage = case when stage = 'new' then 'called' else stage end
      where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.lead_set_appointment(p_id uuid, p_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.leads%rowtype;
begin
  if auth.uid() is null or not public.is_allowed() then
    raise exception 'not allowed';
  end if;
  if p_at is null then
    raise exception 'choose a date and time';
  end if;
  select * into v from public.leads where id = p_id and deleted_at is null;
  if not found then
    raise exception 'lead not found';
  end if;
  if not public.lead_visible(v.owner_id) or v.owner_id is null then
    raise exception 'not allowed';
  end if;
  if v.stage in ('won', 'lost') then
    raise exception 'this lead is already closed';
  end if;
  update public.leads
    set appointment_at = p_at,
        called_at = coalesce(called_at, now()),
        stage = case when stage in ('won', 'lost', 'presented', 'follow_up') then stage else 'appointment' end
    where id = p_id;
  insert into public.appointments (estimate_id, owner_id, set_at, source, lead_id)
  values (v.estimate_id, v.owner_id, p_at, 'app', p_id)
  on conflict (lead_id) where lead_id is not null and source = 'app'
  do update set set_at = excluded.set_at,
                estimate_id = coalesce(public.appointments.estimate_id, excluded.estimate_id);
  return jsonb_build_object('ok', true, 'id', p_id, 'appointment_at', p_at);
end;
$$;

create or replace function public.lead_link_estimate(p_id uuid, p_estimate uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.leads%rowtype;
  e public.estimates%rowtype;
  v_stage text;
begin
  if auth.uid() is null or not public.is_allowed() then
    raise exception 'not allowed';
  end if;
  select * into v from public.leads where id = p_id and deleted_at is null;
  if not found then
    raise exception 'lead not found';
  end if;
  if not public.lead_visible(v.owner_id) or v.owner_id is null then
    raise exception 'not allowed';
  end if;
  select * into e from public.estimates where id = p_estimate and deleted_at is null;
  if not found then
    raise exception 'estimate not found';
  end if;
  if e.owner_id is distinct from v.owner_id then
    raise exception 'estimate owner does not match the lead';
  end if;
  if e.owner_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'not allowed';
  end if;
  v_stage := case
    when e.status = 'won' or e.won_at is not null then 'won'
    when e.status = 'lost' or e.lost_at is not null then 'lost'
    when e.status = 'presented' then 'presented'
    else v.stage
  end;
  if v_stage = 'presented' and exists (
    select 1 from public.follow_ups f where f.estimate_id = e.id and f.status = 'open'
  ) then
    v_stage := 'follow_up';
  end if;
  update public.leads
    set estimate_id = e.id,
        stage = v_stage
    where id = p_id;
  update public.estimates
    set hubspot_contact_id = coalesce(hubspot_contact_id, v.hubspot_contact_id),
        hubspot_deal_id = coalesce(hubspot_deal_id, v.hubspot_deal_id)
    where id = e.id;
  update public.appointments
    set estimate_id = e.id
    where lead_id = p_id and estimate_id is null;
  return jsonb_build_object('ok', true, 'id', p_id, 'estimate_id', e.id, 'stage', v_stage);
end;
$$;

create or replace function public.lead_mark_lost(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.leads%rowtype;
  e public.estimates%rowtype;
begin
  if auth.uid() is null or not public.is_allowed() then
    raise exception 'not allowed';
  end if;
  select * into v from public.leads where id = p_id and deleted_at is null;
  if not found then
    raise exception 'lead not found';
  end if;
  if not public.lead_visible(v.owner_id) or v.owner_id is null then
    raise exception 'not allowed';
  end if;
  if v.stage = 'won' then
    raise exception 'this lead is won';
  end if;
  if v.estimate_id is not null then
    select * into e from public.estimates where id = v.estimate_id and deleted_at is null;
    if found and e.status in ('presented', 'won', 'signed', 'lost') then
      raise exception 'Mark the estimate lost';
    end if;
  end if;
  update public.leads
    set stage = 'lost',
        called_at = coalesce(called_at, now())
    where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.mirror_lead_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage text;
begin
  v_stage := case
    when new.status = 'won' or new.won_at is not null then 'won'
    when new.status = 'lost' or new.lost_at is not null then 'lost'
    when new.status = 'presented' and exists (
      select 1 from public.follow_ups f where f.estimate_id = new.id and f.status = 'open'
    ) then 'follow_up'
    when new.status = 'presented' then 'presented'
    else null
  end;
  if v_stage is null then
    return new;
  end if;
  update public.leads
    set stage = v_stage
    where estimate_id = new.id
      and deleted_at is null
      and stage is distinct from v_stage;
  return new;
end;
$$;

drop trigger if exists leads_mirror_estimate on public.estimates;
create trigger leads_mirror_estimate
  after insert or update on public.estimates
  for each row execute function public.mirror_lead_stage();

create or replace function public.admin_set_profile_phone(p_email text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone text;
  updated uuid;
begin
  if not public.is_admin() then
    raise exception 'only admin can set a mobile';
  end if;
  if v_email = '' then
    raise exception 'enter a valid email';
  end if;
  if v_digits = '' then
    v_phone := null;
  elsif length(v_digits) = 10 then
    v_phone := '+1' || v_digits;
  elsif length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_phone := '+' || v_digits;
  else
    raise exception 'Enter a US mobile number';
  end if;
  update public.profiles
    set phone = v_phone
    where lower(email) = v_email
    returning id into updated;
  if updated is null then
    raise exception 'This person has not signed in yet';
  end if;
  return jsonb_build_object('ok', true, 'email', v_email, 'phone', v_phone);
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
      p.phone,
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
      p.phone,
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
        'id', p.id, 'email', p.email, 'full_name', p.full_name, 'role', p.role,
        'hubspot_owner_id', p.hubspot_owner_id, 'phone', p.phone
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

alter table public.leads enable row level security;

drop policy if exists leads_sel on public.leads;
create policy leads_sel on public.leads
  for select using (
    public.is_allowed()
    and deleted_at is null
    and (public.is_admin() or owner_id = auth.uid())
  );

revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
grant select, insert, update on public.leads to service_role;

revoke all on function public.lead_call_plan(timestamptz) from public, anon, authenticated;
grant execute on function public.lead_call_plan(timestamptz) to service_role;

revoke all on function public.lead_visible(uuid) from public, anon, authenticated;
revoke all on function public.block_lead_delete() from public, anon, authenticated;
revoke all on function public.mirror_lead_stage() from public, anon, authenticated;

revoke all on function public.lead_mark_called(uuid) from public, anon;
grant execute on function public.lead_mark_called(uuid) to authenticated;

revoke all on function public.lead_set_appointment(uuid, timestamptz) from public, anon;
grant execute on function public.lead_set_appointment(uuid, timestamptz) to authenticated;

revoke all on function public.lead_link_estimate(uuid, uuid) from public, anon;
grant execute on function public.lead_link_estimate(uuid, uuid) to authenticated;

revoke all on function public.lead_mark_lost(uuid) from public, anon;
grant execute on function public.lead_mark_lost(uuid) to authenticated;

revoke all on function public.admin_set_profile_phone(text, text) from public, anon;
grant execute on function public.admin_set_profile_phone(text, text) to authenticated;
