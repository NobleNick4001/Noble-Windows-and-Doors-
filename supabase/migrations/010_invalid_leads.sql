-- Invalid leads. Run this whole file once in the Supabase SQL editor.
-- Running it again is safe. Do not put secrets in this file.
-- The app deploy does not run it.
--
-- stage 'invalid' is not a lost job. It stays out of close rate.
-- Admin, or the assigned rep, can mark one. An unassigned lead has no rep,
-- so only an admin can mark it. That is the same rule as public.lead_visible.
-- The hubspot-sync action lead-invalid checks that rule and writes HubSpot.

alter table public.leads
  add column if not exists invalid_reason text,
  add column if not exists invalid_at timestamptz,
  add column if not exists invalid_by uuid references public.profiles(id);

comment on column public.leads.invalid_reason is
  'Why the lead was marked invalid. Null means no reason was chosen.';
comment on column public.leads.invalid_at is
  'When the lead was marked invalid. Null means it is not invalid.';
comment on column public.leads.invalid_by is
  'Profile that marked the lead invalid.';

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
      and rel.relname = 'leads'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%stage%'
  loop
    execute format('alter table public.leads drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.leads
  drop constraint if exists leads_stage_check;

alter table public.leads
  add constraint leads_stage_check
  check (stage in ('new', 'called', 'appointment', 'presented', 'follow_up', 'won', 'lost', 'invalid'));

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
  if v.stage = 'invalid' then
    raise exception 'this lead is invalid';
  end if;
  if v.stage in ('won', 'lost') then
    raise exception 'this lead is already closed';
  end if;
  if v.called_at is null then
    update public.leads
      set called_at = now(),
          stage = case when stage = 'new' then 'called' else stage end
      where id = p_id
        and stage <> 'invalid';
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
  if v.stage = 'invalid' then
    raise exception 'this lead is invalid';
  end if;
  if v.stage in ('won', 'lost') then
    raise exception 'this lead is already closed';
  end if;
  update public.leads
    set appointment_at = p_at,
        called_at = coalesce(called_at, now()),
        stage = case when stage in ('won', 'lost', 'presented', 'follow_up') then stage else 'appointment' end
    where id = p_id
      and stage <> 'invalid';
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
  if v.stage = 'invalid' then
    raise exception 'this lead is invalid';
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
    where id = p_id
      and stage <> 'invalid';
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
  if v.stage = 'invalid' then
    raise exception 'this lead is invalid';
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
    where id = p_id
      and stage <> 'invalid';
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.lead_mark_invalid(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.leads%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not public.is_allowed() then
    raise exception 'not allowed';
  end if;
  if v_reason is not null and v_reason not in (
    'Spam/fake', 'Wrong number', 'Duplicate', 'Not in service area', 'Other'
  ) then
    raise exception 'choose a reason';
  end if;
  select * into v from public.leads where id = p_id and deleted_at is null;
  if not found then
    raise exception 'lead not found';
  end if;
  if not public.lead_visible(v.owner_id) then
    raise exception 'not allowed';
  end if;
  if v.stage = 'invalid' then
    return jsonb_build_object('ok', true, 'id', p_id, 'already', true);
  end if;
  update public.leads
    set stage = 'invalid',
        invalid_reason = v_reason,
        invalid_at = now(),
        invalid_by = auth.uid()
    where id = p_id
      and deleted_at is null
      and stage is distinct from 'invalid';
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
      and stage <> 'invalid'
      and stage is distinct from v_stage;
  return new;
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
        'id', a.id, 'owner_id', a.owner_id, 'estimate_id', a.estimate_id, 'lead_id', a.lead_id,
        'set_at', a.set_at, 'source', a.source
      ))
      from public.appointments a
    ), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'owner_id', l.owner_id, 'stage', l.stage, 'estimate_id', l.estimate_id,
        'hubspot_contact_id', l.hubspot_contact_id, 'hubspot_deal_id', l.hubspot_deal_id
      ))
      from public.leads l
      where l.deleted_at is null
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.lead_mark_invalid(uuid, text) from public, anon;
grant execute on function public.lead_mark_invalid(uuid, text) to authenticated;

revoke all on function public.mirror_lead_stage() from public, anon, authenticated;
revoke all on function public.admin_sales_bundle() from public, anon;
grant execute on function public.admin_sales_bundle() to authenticated;
