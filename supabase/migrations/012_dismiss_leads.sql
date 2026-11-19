-- Dismiss a lead Nick already handled outside the app.
-- Run this whole file once in the Supabase SQL editor, after 011_presented_delete.sql.
-- Running it again is safe. Do not put secrets in this file.
-- The app deploy does not run it.
--
-- stage 'dismissed' is not Invalid and not a lost job. It stays out of
-- New Leads, the assign list, close rate, and the invalid count.
-- The row stays, with its HubSpot ids, so the next pull matches it and
-- does not insert a second copy. Nothing here writes to HubSpot or sends a text.
-- Admin is public.is_admin(), which requires profiles.role = 'admin'.

alter table public.leads
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid references public.profiles(id),
  add column if not exists dismiss_reason text;

comment on column public.leads.dismissed_at is
  'When an admin dismissed the lead. Null means it is not dismissed.';
comment on column public.leads.dismissed_by is
  'Admin profile that dismissed the lead.';
comment on column public.leads.dismiss_reason is
  'Optional reason. Null or blank means no reason was chosen.';

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
  check (stage in ('new', 'called', 'appointment', 'presented', 'follow_up', 'won', 'lost', 'invalid', 'dismissed'));

create or replace function public.guard_dismissed_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.stage = 'dismissed' and new.stage is distinct from 'dismissed' then
    raise exception 'a dismissed lead stays dismissed';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_dismissed_guard on public.leads;
create trigger leads_dismissed_guard
  before update on public.leads
  for each row execute function public.guard_dismissed_lead();

create or replace function public.lead_dismiss(p_id uuid, p_reason text)
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
  if not public.is_admin() then
    raise exception 'only an admin can dismiss a lead';
  end if;
  if v_reason is not null and v_reason not in (
    'Already assigned in HubSpot', 'Already handled', 'Other'
  ) then
    raise exception 'choose a reason';
  end if;
  select * into v from public.leads where id = p_id and deleted_at is null;
  if not found then
    raise exception 'lead not found';
  end if;
  if v.stage = 'dismissed' then
    return jsonb_build_object('ok', true, 'id', p_id, 'already', true);
  end if;
  if v.stage = 'invalid' then
    raise exception 'this lead is invalid';
  end if;
  if v.owner_id is not null then
    raise exception 'only an unassigned lead can be dismissed';
  end if;
  update public.leads
    set stage = 'dismissed',
        dismiss_reason = v_reason,
        dismissed_at = now(),
        dismissed_by = auth.uid()
    where id = p_id
      and deleted_at is null
      and owner_id is null
      and stage is distinct from 'dismissed'
      and stage is distinct from 'invalid';
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

-- A presented/won/lost estimate must not move a dismissed lead back onto a list.
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
      and stage <> 'dismissed'
      and stage is distinct from v_stage;
  return new;
end;
$$;

revoke all on function public.guard_dismissed_lead() from public, anon, authenticated;
revoke all on function public.lead_dismiss(uuid, text) from public, anon;
grant execute on function public.lead_dismiss(uuid, text) to authenticated;
revoke all on function public.mirror_lead_stage() from public, anon, authenticated;
