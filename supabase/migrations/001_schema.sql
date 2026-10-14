-- Noble W&D sales app: accounts, estimates, and signed contracts.
-- Review fixes vs the draft contract:
--   * Role and name are assigned from the signup email (Nicholas admin; Eric and George sales).
--   * Existing auth users are backfilled, and Nicholas is forced to admin.
--   * estimates.document stores the whole estimate, including signature images, so any device can reopen it.
--   * Soft-deleted rows stay in the database and drop out of the API. Hard DELETE is rejected.
--   * Only an admin can change owner_id. That reassignment also moves the contract rows.
--   * A signed estimate cannot be moved back to an earlier status except by an admin.
--   * Contract inserts must point at an estimate the caller can see, with the same owner.
--   * Sales cannot insert or edit profile rows. Admin updates are how roles change.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role text not null default 'sales' check (role in ('admin', 'sales')),
  created_at timestamptz not null default now()
);

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) default auth.uid(),
  customer_name text,
  customer_email text,
  customer_phone text,
  customer_address text,
  lines jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  document jsonb not null default '{}'::jsonb,
  total_amount numeric,
  status text not null default 'draft' check (status in ('draft', 'presented', 'signed', 'lost')),
  hubspot_contact_id text,
  hubspot_deal_id text,
  presented_at timestamptz,
  signed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.estimates add column if not exists document jsonb not null default '{}'::jsonb;

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id),
  owner_id uuid not null references public.profiles(id) default auth.uid(),
  agreement jsonb not null,
  signature_data text not null,
  signer_name text,
  signed_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists estimates_owner_updated on public.estimates (owner_id, updated_at desc);
create index if not exists estimates_status on public.estimates (status) where deleted_at is null;
create index if not exists contracts_estimate on public.contracts (estimate_id);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.account_role(email text)
returns text
language sql
immutable
as $$
  select case when lower(coalesce(email, '')) = 'mgr@noblewandd.com' then 'admin' else 'sales' end;
$$;

create or replace function public.account_name(email text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(email, ''))
    when 'mgr@noblewandd.com' then 'Nicholas Sommer'
    when 'eric@noblewandd.com' then 'Eric Havins'
    when 'mgr@noblegcllc.com' then 'George Piekarski'
    else null
  end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(public.account_name(new.email), nullif(new.raw_user_meta_data->>'full_name', '')),
    public.account_role(new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  coalesce(public.account_name(u.email), nullif(u.raw_user_meta_data->>'full_name', '')),
  public.account_role(u.email)
from auth.users u
on conflict (id) do update set
  email = excluded.email,
  full_name = coalesce(public.profiles.full_name, excluded.full_name),
  role = case
    when lower(coalesce(excluded.email, '')) = 'mgr@noblewandd.com' then 'admin'
    else public.profiles.role
  end;

create or replace function public.lock_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id and not public.is_admin() then
    raise exception 'only admin can reassign';
  end if;
  if old.status = 'signed' and not public.is_admin() and new.status is distinct from 'signed' then
    raise exception 'signed estimate locked';
  end if;
  if new.owner_id is distinct from old.owner_id then
    update public.contracts
      set owner_id = new.owner_id
      where estimate_id = new.id and deleted_at is null;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists estimates_lock on public.estimates;
create trigger estimates_lock
  before update on public.estimates
  for each row execute function public.lock_owner();

create or replace function public.block_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'hard delete is disabled; set deleted_at';
end;
$$;

drop trigger if exists estimates_no_delete on public.estimates;
create trigger estimates_no_delete
  before delete on public.estimates
  for each row execute function public.block_hard_delete();

drop trigger if exists contracts_no_delete on public.contracts;
create trigger contracts_no_delete
  before delete on public.contracts
  for each row execute function public.block_hard_delete();

alter table public.profiles enable row level security;
alter table public.estimates enable row level security;
alter table public.contracts enable row level security;

drop policy if exists p_self on public.profiles;
drop policy if exists p_admin on public.profiles;
create policy p_self on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy p_admin on public.profiles
  for update using (public.is_admin())
  with check (public.is_admin());

drop policy if exists e_sel on public.estimates;
drop policy if exists e_ins on public.estimates;
drop policy if exists e_upd on public.estimates;
create policy e_sel on public.estimates
  for select using (deleted_at is null and (owner_id = auth.uid() or public.is_admin()));
create policy e_ins on public.estimates
  for insert with check (deleted_at is null and (owner_id = auth.uid() or public.is_admin()));
create policy e_upd on public.estimates
  for update using (deleted_at is null and (owner_id = auth.uid() or public.is_admin()))
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists c_sel on public.contracts;
drop policy if exists c_ins on public.contracts;
drop policy if exists c_upd on public.contracts;
create policy c_sel on public.contracts
  for select using (deleted_at is null and (owner_id = auth.uid() or public.is_admin()));
create policy c_ins on public.contracts
  for insert with check (
    deleted_at is null
    and (owner_id = auth.uid() or public.is_admin())
    and exists (
      select 1 from public.estimates e
      where e.id = estimate_id
        and e.deleted_at is null
        and e.owner_id = owner_id
        and (e.owner_id = auth.uid() or public.is_admin())
    )
  );
create policy c_upd on public.contracts
  for update using (public.is_admin() and deleted_at is null)
  with check (public.is_admin());

-- No DELETE policies. The triggers reject hard deletes even for the service role.
revoke all on public.profiles, public.estimates, public.contracts from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.estimates to authenticated;
grant select, insert, update on public.contracts to authenticated;
revoke delete on public.profiles, public.estimates, public.contracts from authenticated, anon;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.account_role(text) to authenticated;
grant execute on function public.account_name(text) to authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin, postgres, service_role;
