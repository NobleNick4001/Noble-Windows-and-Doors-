-- Who may use the sales app.
-- Run this whole file once in the Supabase SQL editor. Running it again is safe.
-- Then turn on the two Auth hooks named at the bottom (see the README).
--
-- Nicholas, Eric, George, and Daniel are already on the list.
-- A person who is not on this list cannot create an account or get a new sign-in token.
-- Revoking sets revoked_at, hides every estimate and profile from that login (row level
-- security), and deletes their Supabase sessions so the next token refresh fails.
-- see_all starts off. Running this file again does not turn that flag off.
-- An admin always sees every estimate. A salesperson sees other reps' estimates
-- and contracts only after Nick turns the flag on. They still cannot edit those jobs.

create table if not exists public.allowed_users (
  email text primary key,
  full_name text not null,
  role text not null check (role in ('admin', 'sales')),
  -- Sales only. Off until Nick turns it on. Admins always see every estimate.
  see_all boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing databases already have the table. Adding the column again is safe,
-- and the default leaves every current rep seeing only their own estimates.
alter table public.allowed_users
  add column if not exists see_all boolean not null default false;

create or replace function public.allowed_users_normalize()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(trim(coalesce(new.email, '')));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists allowed_users_normalize on public.allowed_users;
create trigger allowed_users_normalize
  before insert or update on public.allowed_users
  for each row execute function public.allowed_users_normalize();

insert into public.allowed_users (email, full_name, role)
values
  ('mgr@noblewandd.com', 'Nicholas Sommer', 'admin'),
  ('eric@noblewandd.com', 'Eric Havins', 'sales'),
  ('mgr@noblegcllc.com', 'George Piekarski', 'sales'),
  ('dan@noblewandd.com', 'Daniel Smalley', 'sales')
on conflict (email) do nothing;

-- Nicholas stays the admin even if this file is run again after other edits.
update public.allowed_users
set role = 'admin',
    full_name = 'Nicholas Sommer'
where email = 'mgr@noblewandd.com';

create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.allowed_users a on a.email = lower(p.email)
    where p.id = auth.uid()
      and a.revoked_at is null
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.allowed_users a on a.email = lower(p.email)
    where p.id = auth.uid()
      and p.role = 'admin'
      and a.role = 'admin'
      and a.revoked_at is null
  );
$$;

-- Admin always. A salesperson only when Nick has turned their flag on.
create or replace function public.can_see_all_estimates()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.profiles p
      join public.allowed_users a on a.email = lower(p.email)
      where p.id = auth.uid()
        and a.revoked_at is null
        and a.role = 'sales'
        and a.see_all
    );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed public.allowed_users%rowtype;
begin
  select * into allowed
  from public.allowed_users
  where email = lower(coalesce(new.email, ''))
    and revoked_at is null;
  if not found then
    raise exception 'This email is not allowed to create an account';
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(allowed.full_name, ''), nullif(new.raw_user_meta_data->>'full_name', '')),
    allowed.role
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    role = excluded.role;
  return new;
end;
$$;

drop function if exists public.account_role(text);
create or replace function public.account_role(email text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.role
  from public.allowed_users a
  where a.email = lower(coalesce($1, ''))
    and a.revoked_at is null;
$$;

drop function if exists public.account_name(text);
create or replace function public.account_name(email text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.full_name
  from public.allowed_users a
  where a.email = lower(coalesce($1, ''))
    and a.revoked_at is null;
$$;

update public.profiles p
set role = a.role,
    full_name = coalesce(nullif(p.full_name, ''), a.full_name)
from public.allowed_users a
where lower(p.email) = a.email
  and a.revoked_at is null
  and (p.role is distinct from a.role or p.full_name is null);

-- The signed-in person asks "am I still allowed?" without seeing the rest of the list.
create or replace function public.current_access()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'allowed', (a.revoked_at is null),
        'email', a.email,
        'full_name', a.full_name,
        'role', a.role,
        'see_all', (a.role = 'admin' or a.see_all)
      )
      from public.allowed_users a
      where a.email = lower(coalesce(
        nullif(auth.jwt()->>'email', ''),
        (select pr.email from public.profiles pr where pr.id = auth.uid()),
        ''
      ))
    ),
    jsonb_build_object(
      'allowed', false,
      'email', lower(coalesce(auth.jwt()->>'email', '')),
      'full_name', '',
      'role', null,
      'see_all', false
    )
  );
$$;

create or replace function public.drop_user_sessions(target uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if target is null then
    return;
  end if;
  begin
    delete from auth.mfa_amr_claims
    where session_id in (select s.id from auth.sessions s where s.user_id = target);
  exception
    when others then null;
  end;
  begin
    delete from auth.refresh_tokens where user_id = target;
  exception
    when others then null;
  end;
  begin
    delete from auth.sessions where user_id = target;
  exception
    when others then null;
  end;
end;
$$;

-- Service role only. The revoke-sessions edge function calls this after it marks the email revoked.
create or replace function public.drop_sessions_for_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid;
begin
  for uid in
    select u.id from auth.users u where lower(u.email) = lower(coalesce(p_email, ''))
  loop
    perform public.drop_user_sessions(uid);
  end loop;
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

create or replace function public.admin_add_user(p_email text, p_name text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_role text := lower(trim(coalesce(p_role, '')));
  existing public.allowed_users%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only admin can add a rep';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'enter a valid email';
  end if;
  if v_name = '' then
    raise exception 'name is required';
  end if;
  if v_role not in ('admin', 'sales') then
    raise exception 'role must be admin or sales';
  end if;
  select * into existing from public.allowed_users where email = v_email;
  if found and existing.revoked_at is not null then
    raise exception 'This person is revoked. Restore access instead of adding them again.';
  end if;
  insert into public.allowed_users (email, full_name, role)
  values (v_email, v_name, v_role)
  on conflict (email) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        updated_at = now();
  update public.profiles
  set full_name = v_name,
      role = v_role
  where lower(email) = v_email;
  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

create or replace function public.admin_set_role(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_role text := lower(trim(coalesce(p_role, '')));
  mine text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if not public.is_admin() then
    raise exception 'only admin can change roles';
  end if;
  if v_role not in ('admin', 'sales') then
    raise exception 'role must be admin or sales';
  end if;
  if v_email = mine and v_role <> 'admin' then
    raise exception 'you cannot remove your own admin access';
  end if;
  update public.allowed_users
  set role = v_role,
      updated_at = now()
  where email = v_email;
  if not found then
    raise exception 'Add this rep before changing the role';
  end if;
  update public.profiles
  set role = v_role
  where lower(email) = v_email;
  return jsonb_build_object('ok', true, 'email', v_email, 'role', v_role);
end;
$$;

create or replace function public.admin_set_see_all(p_email text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_role text;
  v_on boolean := coalesce(p_on, false);
begin
  if not public.is_admin() then
    raise exception 'only admin can change who sees estimates';
  end if;
  select role into v_role from public.allowed_users where email = v_email;
  if v_role is null then
    raise exception 'Add this rep before changing what they can see';
  end if;
  if v_role = 'admin' then
    raise exception 'admins already see every estimate';
  end if;
  update public.allowed_users
  set see_all = v_on,
      updated_at = now()
  where email = v_email;
  return jsonb_build_object('ok', true, 'email', v_email, 'see_all', v_on);
end;
$$;

create or replace function public.admin_revoke_user(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  mine text := lower(coalesce(auth.jwt()->>'email', ''));
  updated text;
  uid uuid;
begin
  if not public.is_admin() then
    raise exception 'only admin can revoke access';
  end if;
  if v_email = '' then
    raise exception 'enter a valid email';
  end if;
  if v_email = mine then
    raise exception 'you cannot revoke your own access';
  end if;
  update public.allowed_users
  set revoked_at = coalesce(revoked_at, now()),
      updated_at = now()
  where email = v_email
  returning email into updated;
  if updated is null then
    raise exception 'That email is not on the allowlist';
  end if;
  for uid in select p.id from public.profiles p where lower(p.email) = v_email loop
    perform public.drop_user_sessions(uid);
  end loop;
  begin
    for uid in select u.id from auth.users u where lower(u.email) = v_email loop
      perform public.drop_user_sessions(uid);
    end loop;
  exception
    when others then null;
  end;
  return jsonb_build_object('ok', true, 'email', v_email, 'revoked', true);
end;
$$;

create or replace function public.admin_restore_user(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  updated text;
begin
  if not public.is_admin() then
    raise exception 'only admin can restore access';
  end if;
  update public.allowed_users
  set revoked_at = null,
      updated_at = now()
  where email = v_email
  returning email into updated;
  if updated is null then
    raise exception 'That email is not on the allowlist';
  end if;
  return jsonb_build_object('ok', true, 'email', v_email, 'revoked', false);
end;
$$;

-- Service role only. The revoke-sessions edge function uses this to find the auth user.
create or replace function public.auth_user_id(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select u.id from auth.users u where lower(u.email) = lower(coalesce(p_email, '')) limit 1;
$$;

-- Reject a new auth user before the row is inserted, once Nick enables the hook.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text := lower(coalesce(event->'user'->>'email', ''));
  allowed boolean;
begin
  select exists (
    select 1 from public.allowed_users
    where email = user_email and revoked_at is null
  ) into allowed;
  if allowed then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email is not allowed to create an account.'
    )
  );
end;
$$;

-- Reject sign-in and token refresh for anyone revoked or not on the list,
-- once Nick enables the custom access token hook.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb := event->'claims';
  user_email text := lower(coalesce(claims->>'email', ''));
  allowed boolean;
begin
  select exists (
    select 1 from public.allowed_users
    where email = user_email and revoked_at is null
  ) into allowed;
  if not allowed then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This email is not allowed to sign in.'
      )
    );
  end if;
  return jsonb_build_object('claims', claims);
end;
$$;

alter table public.allowed_users enable row level security;

-- No policies: the browser cannot read or edit the allowlist directly.
-- Admins go through the functions above. A revoked JWT fails is_allowed()
-- on profiles, estimates, and contracts even if the access token has not expired yet.

drop policy if exists p_self on public.profiles;
drop policy if exists p_admin on public.profiles;
create policy p_self on public.profiles
  for select using (public.is_allowed() and (id = auth.uid() or public.can_see_all_estimates()));
create policy p_admin on public.profiles
  for update using (public.is_admin())
  with check (public.is_admin());

drop policy if exists e_sel on public.estimates;
drop policy if exists e_ins on public.estimates;
drop policy if exists e_upd on public.estimates;
create policy e_sel on public.estimates
  for select using (public.is_allowed() and deleted_at is null and (owner_id = auth.uid() or public.can_see_all_estimates()));
create policy e_ins on public.estimates
  for insert with check (public.is_allowed() and deleted_at is null and (owner_id = auth.uid() or public.is_admin()));
create policy e_upd on public.estimates
  for update using (public.is_allowed() and deleted_at is null and (owner_id = auth.uid() or public.is_admin()))
  with check (public.is_allowed() and (owner_id = auth.uid() or public.is_admin()));

drop policy if exists c_sel on public.contracts;
drop policy if exists c_ins on public.contracts;
drop policy if exists c_upd on public.contracts;
create policy c_sel on public.contracts
  for select using (public.is_allowed() and deleted_at is null and (owner_id = auth.uid() or public.can_see_all_estimates()));
create policy c_ins on public.contracts
  for insert with check (
    public.is_allowed()
    and deleted_at is null
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
  for update using (public.is_admin() and public.is_allowed() and deleted_at is null)
  with check (public.is_admin() and public.is_allowed());

revoke all on public.allowed_users from anon, authenticated;
grant select, insert, update on public.allowed_users to service_role;

revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.can_see_all_estimates() from public, anon;
grant execute on function public.can_see_all_estimates() to authenticated;

revoke all on function public.current_access() from public, anon;
grant execute on function public.current_access() to authenticated;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

revoke all on function public.admin_add_user(text, text, text) from public, anon;
grant execute on function public.admin_add_user(text, text, text) to authenticated;

revoke all on function public.admin_set_role(text, text) from public, anon;
grant execute on function public.admin_set_role(text, text) to authenticated;

revoke all on function public.admin_set_see_all(text, boolean) from public, anon;
grant execute on function public.admin_set_see_all(text, boolean) to authenticated;

revoke all on function public.admin_revoke_user(text) from public, anon;
grant execute on function public.admin_revoke_user(text) to authenticated;

revoke all on function public.admin_restore_user(text) from public, anon;
grant execute on function public.admin_restore_user(text) to authenticated;

revoke all on function public.drop_user_sessions(uuid) from public, anon, authenticated;
revoke all on function public.drop_sessions_for_email(text) from public, anon, authenticated;
grant execute on function public.drop_sessions_for_email(text) to service_role;
revoke all on function public.auth_user_id(text) from public, anon, authenticated;
grant execute on function public.auth_user_id(text) to service_role;

revoke all on function public.account_role(text) from public, anon;
grant execute on function public.account_role(text) to authenticated;
revoke all on function public.account_name(text) from public, anon;
grant execute on function public.account_name(text) to authenticated;

grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

grant usage on schema public to supabase_auth_admin;
grant select on table public.allowed_users to supabase_auth_admin;

-- Hooks Nick turns on in Authentication → Hooks (they do nothing until enabled):
--   Before user created  → public.hook_before_user_created
--   Custom access token  → public.custom_access_token_hook
